import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { beforeAll } from 'vitest'

beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS))
