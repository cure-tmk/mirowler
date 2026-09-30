import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { main } from './cli.ts'
import { createClient } from './client.ts'
import { createServer } from './mcp.ts'

const env = { MIROWLER_URL: 'http://worker.test', MIROWLER_AUTH: 'admin:pass' }
const body = { any: 'shape' }
let file: string
let fetchMock: ReturnType<typeof vi.fn<(req: Request) => Promise<Response>>>
let stdout: string
let stderr: string

beforeEach(async () => {
  file = join(await mkdtemp(join(tmpdir(), 'mirowler-cli-')), 'body.json')
  await writeFile(file, JSON.stringify(body))
  fetchMock = vi.fn(async () => Response.json({ ok: true }))
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => fetchMock(new Request(input, init)))
  stdout = ''
  stderr = ''
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
    stdout += s
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((s) => {
    stderr += s
    return true
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const lastRequest = async () => {
  const req = fetchMock.mock.lastCall?.[0]
  if (!req) {
    throw new Error('no request')
  }
  const url = new URL(req.url)
  const text = await req.text()
  return {
    method: req.method,
    path: url.pathname + url.search,
    body: text ? JSON.parse(text) : undefined,
    contentType: req.headers.get('content-type'),
    authorization: req.headers.get('authorization'),
  }
}

describe('cli', () => {
  it.each([
    ['monitors list', 'GET', '/api/monitors'],
    ['monitors get m1', 'GET', '/api/monitors/m1'],
    ['monitors create --file', 'POST', '/api/monitors', body],
    ['monitors update m1 --file', 'PUT', '/api/monitors/m1', body],
    ['monitors enable m1', 'POST', '/api/monitors/m1/enable'],
    ['monitors disable m1', 'POST', '/api/monitors/m1/disable'],
    ['monitors run m1', 'POST', '/api/monitors/m1/run'],
    ['monitors delete m1', 'DELETE', '/api/monitors/m1'],
    ['runs list m1', 'GET', '/api/monitors/m1/runs'],
    ['runs list m1 --cursor c1 --limit 5', 'GET', '/api/monitors/m1/runs?cursor=c1&limit=5'],
    ['notifications list m1', 'GET', '/api/monitors/m1/notifications'],
    ['channels list', 'GET', '/api/channels'],
    ['channels create --file', 'POST', '/api/channels', body],
    ['channels update c1 --file', 'PUT', '/api/channels/c1', body],
    ['channels delete c1', 'DELETE', '/api/channels/c1'],
    ['channels test c1', 'POST', '/api/channels/c1/test'],
    ['preview --file', 'POST', '/api/preview', body],
  ])('%s → %s %s', async (command, method, path, expectedBody?: object) => {
    const argv = command.split(' ').flatMap((a) => (a === '--file' ? [a, file] : [a]))
    expect(await main(argv, env)).toBe(0)
    const req = await lastRequest()
    expect(req).toMatchObject({ method, path, body: expectedBody, authorization: 'Basic YWRtaW46cGFzcw==' })
    if (expectedBody) {
      expect(req.contentType).toBe('application/json')
    }
    expect(JSON.parse(stdout)).toEqual({ ok: true })
  })

  it('prints the whole non-2xx body on stderr and exits 1', async () => {
    const failure = { error: 'channel is used by monitors', monitors: [{ id: 'm1', name: 'a' }] }
    fetchMock.mockResolvedValue(Response.json(failure, { status: 409 }))
    expect(await main(['channels', 'delete', 'c1'], env)).toBe(1)
    expect(JSON.parse(stderr)).toEqual(failure)
    expect(stdout).toBe('')
  })

  it.each(['monitors get', 'monitors list --limit 5', 'notifications list m1 --cursor c1', 'runs list m1 --limit 5x'])(
    'rejects "%s" without calling the API',
    async (command) => {
      expect(await main(command.split(' '), env)).toBe(2)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )
})

describe('credentials', () => {
  const store = (stored?: { url: string; auth: string }) => ({
    read: vi.fn(async (url?: string) => (url === undefined || url === stored?.url ? stored : undefined)),
    save: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
  })

  it('falls back to the keychain when the env does not carry both values', async () => {
    const keychain = store({ url: 'http://saved.test', auth: 'admin:pass' })
    expect(await main(['monitors', 'list'], {}, keychain)).toBe(0)
    expect(await lastRequest()).toMatchObject({ path: '/api/monitors', authorization: 'Basic YWRtaW46cGFzcw==' })
    expect(fetchMock.mock.lastCall?.[0].url).toBe('http://saved.test/api/monitors')
    expect(await main(['monitors', 'list'], { MIROWLER_URL: 'http://other.test' }, keychain)).toBe(2)
    expect(keychain.read).toHaveBeenLastCalledWith('http://other.test')
  })

  it('saves on login without asking for the credential on the command line', async () => {
    const keychain = store({ url: 'http://saved.test', auth: 'admin:pass' })
    expect(await main(['login', 'http://saved.test'], {}, keychain)).toBe(0)
    expect(keychain.save).toHaveBeenCalledWith('http://saved.test')
    expect(keychain.clear).not.toHaveBeenCalled()
  })

  it('reports the credential source and whether the Worker accepts it', async () => {
    const keychain = store({ url: 'http://saved.test', auth: 'admin:pass' })
    expect(await main(['status'], {}, keychain)).toBe(0)
    expect(JSON.parse(stdout)).toEqual({
      source: 'keychain',
      url: 'http://saved.test',
      user: 'admin',
      authenticated: true,
    })
    stdout = ''
    fetchMock.mockResolvedValue(new Response('Unauthorized', { status: 401 }))
    expect(await main(['status'], env, keychain)).toBe(1)
    expect(JSON.parse(stdout)).toMatchObject({ source: 'env', url: env.MIROWLER_URL, authenticated: false })
    expect(stdout).not.toContain('pass')
  })

  it('discards a login that saved no user:password', async () => {
    const keychain = store({ url: 'http://saved.test', auth: '' })
    expect(await main(['login', 'http://saved.test'], {}, keychain)).toBe(1)
    expect(keychain.clear).toHaveBeenCalled()
  })
})

describe('mcp', () => {
  const connect = async () => {
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair()
    await createServer(createClient(env.MIROWLER_URL, env.MIROWLER_AUTH)).connect(serverSide)
    const client = new Client({ name: 'test', version: '0' })
    await client.connect(clientSide)
    return client
  }

  it('advertises the browser source and rejects its short interval before any request', async () => {
    const client = await connect()
    const { tools } = await client.listTools()
    const create = tools.find((t) => t.name === 'monitors_create')
    expect(JSON.stringify(create?.inputSchema)).toContain('waitForSelector')

    const config = {
      name: 'booking',
      schedule: { type: 'interval', minutes: 14 },
      source: { type: 'browser', url: 'https://example.com/', waitForSelector: '.total' },
      extractor: { type: 'css_text', selector: '.total', parse: 'jpy' },
      evaluator: { type: 'rule', field: 'jpy', op: 'lt', value: 20000 },
      trigger: { type: 'on_enter' },
      channelIds: ['c1'],
    }
    const result = await client.callTool({ name: 'monitors_create', arguments: { body: config } })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('browser source')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps a non-2xx response to an error result carrying the body', async () => {
    const failure = { error: 'invalid config', issues: [{ path: 'name', message: 'Too small' }] }
    fetchMock.mockResolvedValue(Response.json(failure, { status: 400 }))
    const client = await connect()
    const result = await client.callTool({ name: 'monitors_get', arguments: { id: 'm1' } })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('Too small')
  })
})
