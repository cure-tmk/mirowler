import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/http/app'

const withSecret = { ...env, ADMIN_BASIC_AUTH: 'admin:s3cret' }
const basic = (credential: string) => ({ headers: { Authorization: `Basic ${btoa(credential)}` } })

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

describe('admin auth', () => {
  it.each(['/api/monitors', '/api/channels'])('rejects %s without credentials', async (path) => {
    const res = await app.request(path, {}, withSecret)
    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toMatch(/^Basic realm=/)
  })

  it('rejects wrong credentials', async () => {
    const res = await app.request('/api/monitors', basic('admin:wrong'), withSecret)
    expect(res.status).toBe(401)
  })

  it('serves the API with correct credentials', async () => {
    const res = await app.request('/api/monitors', basic('admin:s3cret'), withSecret)
    expect(res.status).toBe(200)
  })

  it('keeps /healthz public', async () => {
    const res = await app.request('/healthz', {}, withSecret)
    expect(res.status).toBe(200)
  })

  it('returns 503 when the secret is not configured', async () => {
    const res = await app.request('/api/monitors', basic('admin:s3cret'), { ...env, ADMIN_BASIC_AUTH: '' })
    expect(res.status).toBe(503)
  })

  it('rejects a form post from a foreign origin', async () => {
    const res = await app.request(
      '/api/channels',
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa('admin:s3cret')}`,
          Origin: 'https://evil.example',
          'content-type': 'text/plain',
        },
        body: JSON.stringify({ displayName: 'x', secretName: 'SLACK_X' }),
      },
      withSecret,
    )
    expect(res.status).toBe(403)
  })

  it('lets a non-browser client post without an origin', async () => {
    const res = await app.request('/api/monitors/missing/run', { method: 'POST', ...basic('admin:s3cret') }, withSecret)
    expect(res.status).toBe(404)
  })
})
