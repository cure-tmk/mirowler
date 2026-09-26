import { createScheduledController } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import type { MonitorConfig } from '@mirowler/core'
import { scheduled } from '../src/scheduled'

export const TEST_ADMIN = 'admin:s3cret'

/** Returns `init` with the test admin's Basic auth header added. */
export const authedInit = (init: RequestInit = {}): RequestInit => {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Basic ${btoa(TEST_ADMIN)}`)
  return { ...init, headers }
}

export const baseConfig: MonitorConfig = {
  name: 'stock',
  schedule: { type: 'interval', minutes: 60 },
  source: { type: 'http', url: 'https://example.com/item' },
  extractor: { type: 'css_text', selector: '#stock', parse: 'text' },
  evaluator: { type: 'rule', field: 'text', op: 'contains', value: 'In stock' },
  trigger: { type: 'on_enter' },
  channelIds: ['ch-a', 'ch-b'],
}

export const tick = () => scheduled(createScheduledController(), env, {} as ExecutionContext)

export const resetTables = () =>
  env.DB.batch(['notifications', 'events', 'runs', 'monitors'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)))

export const monitorRow = (id: string) =>
  env.DB.prepare('SELECT * FROM monitors WHERE id = ?').bind(id).first<{
    config_json: string
    config_version: number
    next_run_at: string
    running_since: string | null
    last_valid_run_id: string | null
    failure_count: number
  }>()
