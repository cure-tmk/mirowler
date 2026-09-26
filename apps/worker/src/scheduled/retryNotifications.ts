import type { MonitorEvent, NotifyResult } from '@mirowler/core'
import { slackNotifier } from '../adapters/slackNotifier'
import { type Channel, getChannel } from '../db/channels'
import { listPending, markFailed, markSent } from '../db/notifications'
import { type Bindings, readSecret } from '../env'

export const notifyChannel = async (env: Bindings, event: MonitorEvent, channel: Channel): Promise<NotifyResult> => {
  const webhookUrl = readSecret(env, channel.secretName)
  return webhookUrl
    ? slackNotifier(event, { kind: 'slack_webhook', webhookUrl })
    : { ok: false, error: `secret ${channel.secretName} is not set` }
}

/** Sends a fixed test message to a channel. Returns null when the channel does not exist. */
export const sendTestMessage = async (env: Bindings, channelId: string): Promise<NotifyResult | null> => {
  const channel = await getChannel(env.DB, channelId)
  if (!channel) {
    return null
  }
  const now = new Date().toISOString()
  return notifyChannel(
    env,
    {
      id: `test:${now}`,
      runId: 'test',
      monitorId: 'test',
      kind: 'entered',
      summary: 'mirowler test message',
      occurredAt: now,
    },
    channel,
  )
}

export const deliver = async (env: Bindings, event: MonitorEvent, channelId: string) => {
  const channel = await getChannel(env.DB, channelId)
  const result: NotifyResult = channel
    ? await notifyChannel(env, event, channel)
    : { ok: false, error: 'channel not found' }
  if (result.ok) {
    await markSent(env.DB, event.id, channelId, new Date().toISOString())
  } else {
    await markFailed(env.DB, event.id, channelId, result.error)
  }
}

export const retryNotifications = async (env: Bindings) => {
  for (const { event, channelId } of await listPending(env.DB)) {
    await deliver(env, event, channelId)
  }
}
