#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { z } from 'zod'
import { createClient, errorBody } from './client.ts'
import { type Credentials, type Keychain, keychain } from './keychain.ts'
import { createServer } from './mcp.ts'
import { type Operation, operations } from './operations.ts'

const isOptional = (schema: z.ZodType) => schema.safeParse(undefined).success

const usage = (op?: Operation) => {
  const arg = (key: string, schema: z.ZodType) => {
    const text = key === 'id' ? '<id>' : key === 'body' ? '--file <path.json>' : `--${key} <${key}>`
    return isOptional(schema) ? `[${text}]` : text
  }
  const args = (o: Operation) =>
    Object.entries(o.input.shape)
      .map(([key, schema]) => arg(key, schema))
      .join(' ')
  const lines = (op ? [op] : operations).map((o) => `  mirowler ${o.name.replace('.', ' ')} ${args(o)}`.trimEnd())
  const extra = op ? [] : ['  mirowler mcp', '  mirowler login <url>', '  mirowler logout', '  mirowler status']
  return [
    'Usage:',
    ...lines,
    ...extra,
    'Credentials: MIROWLER_URL and MIROWLER_AUTH (user:pass), or `mirowler login` (macOS keychain)',
  ].join('\n')
}

const print = (value: unknown) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)

const status = async (credentials: (Credentials & { source: 'env' | 'keychain' }) | undefined) => {
  if (!credentials) {
    print({ source: null, authenticated: false })
    return 1
  }
  const { source, url, auth } = credentials
  const shown = { source, url, user: auth.split(':')[0] }
  try {
    await createClient(url, auth).api.channels.$get()
    print({ ...shown, authenticated: true })
    return 0
  } catch (e) {
    print({ ...shown, authenticated: false, error: (e as Error).message })
    return 1
  }
}

const fail = (message: string, code = 2) => {
  process.stderr.write(`${message}\n`)
  return code
}

/** Runs one CLI invocation and resolves to its exit code. */
export const main = async (argv: string[], env: NodeJS.ProcessEnv, store: Keychain = keychain) => {
  let parsed: { positionals: string[]; values: { file?: string; cursor?: string; limit?: string } }
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { file: { type: 'string' }, cursor: { type: 'string' }, limit: { type: 'string' } },
    })
  } catch (e) {
    return fail(`${(e as Error).message}\n${usage()}`)
  }
  const { positionals, values } = parsed
  const [command, loginUrl, ...extra] = positionals
  if (command === 'login' && loginUrl && extra.length === 0 && URL.canParse(loginUrl)) {
    process.stderr.write('Password: <user>:<password> of the Worker admin (ADMIN_BASIC_AUTH)\n')
    try {
      await store.save(loginUrl)
    } catch (e) {
      return fail((e as Error).message, 1)
    }
    // Without a terminal, security saves whatever stdin holds, which is empty under a non-interactive shell
    if (!/^[^:]+:./.test((await store.read(loginUrl))?.auth ?? '')) {
      await store.clear()
      return fail('Nothing saved: enter <user>:<password> in an interactive terminal', 1)
    }
    process.stderr.write(`Saved the credential for ${loginUrl} to the keychain\n`)
    return 0
  }
  if (command === 'logout' && positionals.length === 1) {
    await store.clear()
    return 0
  }

  const { MIROWLER_URL: url, MIROWLER_AUTH: auth } = env
  const fromEnv = url && auth ? { url, auth } : undefined
  const credentials = fromEnv ?? (await store.read(url))
  if (command === 'status' && positionals.length === 1) {
    return status(credentials && { ...credentials, source: fromEnv ? 'env' : 'keychain' })
  }
  if (!credentials) {
    return fail(`Set MIROWLER_URL and MIROWLER_AUTH, or run \`mirowler login <url>\`\n${usage()}`)
  }
  const client = createClient(credentials.url, credentials.auth)

  if (positionals.join(' ') === 'mcp') {
    await createServer(client).connect(new StdioServerTransport())
    return 0
  }

  const op = operations.find((o) => o.name === positionals.slice(0, o.name.split('.').length).join('.'))
  if (!op) {
    return fail(usage())
  }
  const [id, ...rest] = positionals.slice(op.name.split('.').length)
  const given: Record<string, string | undefined> = {
    id,
    body: values.file,
    cursor: values.cursor,
    limit: values.limit,
  }
  const shape: Record<string, z.ZodType> = op.input.shape
  const limit = values.limit === undefined ? undefined : Number(values.limit)
  const unexpected = Object.entries(given).some(([key, value]) => value !== undefined && !shape[key])
  const missing = Object.entries(shape).some(([key, schema]) => given[key] === undefined && !isOptional(schema))
  const badLimit = limit !== undefined && !shape.limit?.safeParse(limit).success
  if (rest.length > 0 || unexpected || missing || badLimit) {
    return fail(usage(op))
  }

  try {
    const body = values.file ? JSON.parse(await readFile(values.file, 'utf8')) : undefined
    const result = await op.call(client, { id, body, cursor: values.cursor, limit })
    print(result)
    return 0
  } catch (e) {
    return fail(errorBody(e) ?? (e as Error).message, 1)
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2), process.env)
}
