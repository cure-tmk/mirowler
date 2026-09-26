import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { insertChannel } from '../src/db/channels'
import { app } from '../src/http/app'

const secretValue = 'https://hooks.slack.invalid/services/FAKE/SECRET/VALUE'
const testEnv = { ...env, ADMIN_BASIC_AUTH: 'admin:s3cret', SLACK_PAGE_TEST: secretValue }
const authorization = `Basic ${btoa('admin:s3cret')}`

const channelCount = async () => (await env.DB.prepare('SELECT COUNT(*) AS n FROM channels').first<{ n: number }>())?.n

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

describe('channels page', () => {
  it('shows the secret name but never the secret value', async () => {
    await insertChannel(env.DB, { displayName: 'Page test', secretName: 'SLACK_PAGE_TEST' }, new Date().toISOString())

    const res = await app.request('/channels', { headers: { Authorization: authorization } }, testEnv)
    const html = await res.text()

    expect(res.status).toBe(200)
    expect(html).toContain('Page test')
    expect(html).toContain('SLACK_PAGE_TEST')
    expect(html).not.toContain(secretValue)
  })

  it('shows an error and inserts nothing for an invalid secret name', async () => {
    const before = await channelCount()

    const res = await app.request(
      '/channels',
      {
        method: 'POST',
        headers: { Authorization: authorization },
        body: new URLSearchParams({ displayName: 'Invalid', secretName: 'slack-lower' }),
      },
      testEnv,
    )

    expect(res.status).toBe(400)
    expect(await res.text()).toContain('secret name may only contain')
    expect(await channelCount()).toBe(before)
  })
})
