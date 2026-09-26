import type { MonitorEvent, NotifyResult } from '@mirowler/core'
import { notifyChannel } from '../adapters/notify'
import { getChannel } from '../db/channels'
import { claimNotification, listPending, markFailed, markSent } from '../db/notifications'
import type { Bindings } from '../env'

/** Sends one notification only if this call wins the claim; otherwise does nothing. */
export const deliver = async (env: Bindings, event: MonitorEvent, channelId: string, now = new Date()) => {
  const claim = await claimNotification(env.DB, event.id, channelId, now)
  if (!claim) {
    return
  }
  const channel = await getChannel(env.DB, channelId)
  const result: NotifyResult = channel
    ? await notifyChannel(env, event, channel)
    : { ok: false, error: 'channel not found' }
  if (result.ok) {
    await markSent(env.DB, event.id, channelId, claim, now)
  } else {
    await markFailed(env.DB, event.id, channelId, claim, result.error, now)
  }
}

/** `now` pins the clock for tests; otherwise each row is claimed at its own send time so a long loop does not backdate claims. */
export const retryNotifications = async (env: Bindings, now?: Date) => {
  for (const { event, channelId } of await listPending(env.DB, now ?? new Date())) {
    await deliver(env, event, channelId, now ?? new Date())
  }
}
