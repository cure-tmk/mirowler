import type { Notifier } from '@mirowler/core'

export const slackNotifier: Notifier = async (event, target) => {
  try {
    const res = await fetch(target.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: `${event.summary}\n(event: ${event.id})` }),
      signal: AbortSignal.timeout(10_000),
    })
    if (res.ok) {
      return { ok: true }
    }
    return { ok: false, error: `${res.status} ${(await res.text()).slice(0, 200)}` }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
