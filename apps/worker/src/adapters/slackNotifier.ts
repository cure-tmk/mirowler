import type { Notifier } from '@mirowler/core'

const escapeMrkdwn = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** Errors never include the webhook URL because they are stored and shown in the admin UI. */
export const slackNotifier: Notifier = async (event, target) => {
  try {
    const res = await fetch(target.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: `${escapeMrkdwn(event.summary)}\n(event: ${event.id})` }),
      signal: AbortSignal.timeout(10_000),
    })
    if (res.ok) {
      return { ok: true }
    }
    return { ok: false, error: `${res.status} ${(await res.text()).slice(0, 200)}` }
  } catch (e) {
    return { ok: false, error: `request failed: ${e instanceof Error ? e.name : 'unknown'}` }
  }
}
