import type { MonitorEvent } from '@mirowler/core'
import { slackNotifier } from '../adapters/slackNotifier'
import { getChannel } from '../db/channels'
import { listPending, markFailed, markSent } from '../db/notifications'
import { type Bindings, readSecret } from '../env'

export const deliver = async (env: Bindings, event: MonitorEvent, channelId: string) => {
  const channel = await getChannel(env.DB, channelId)
  const webhookUrl = channel && readSecret(env, channel.secretName)
  const result = webhookUrl
    ? await slackNotifier(event, { kind: 'slack_webhook', webhookUrl })
    : { ok: false as const, error: channel ? `secret ${channel.secretName} is not set` : 'channel not found' }
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
