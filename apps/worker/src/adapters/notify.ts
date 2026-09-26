import type { MonitorEvent, NotifyResult } from '@mirowler/core'
import { type Channel, getChannel } from '../db/channels'
import { type Bindings, readSecret } from '../env'
import { slackNotifier } from './slackNotifier'

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
