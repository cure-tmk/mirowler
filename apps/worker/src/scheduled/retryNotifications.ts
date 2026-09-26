import type { MonitorEvent, NotifyResult } from '@mirowler/core'
import { notifyChannel } from '../adapters/notify'
import { getChannel } from '../db/channels'
import { listPending, markFailed, markSent } from '../db/notifications'
import type { Bindings } from '../env'

export { sendTestMessage } from '../adapters/notify'

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
