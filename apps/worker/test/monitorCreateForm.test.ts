import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import type { MonitorConfig } from '@mirowler/core'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { insertChannel } from '../src/db/channels'
import { app } from '../src/http/app'

const testEnv = { ...env, ADMIN_BASIC_AUTH: 'admin:s3cret' }
const authorization = `Basic ${btoa('admin:s3cret')}`

let channelId: string

const submit = (fields: [string, string][]) =>
  app.request(
    '/monitors',
    { method: 'POST', headers: { Authorization: authorization }, body: new URLSearchParams(fields) },
    testEnv,
  )

const monitorCount = async () => (await env.DB.prepare('SELECT COUNT(*) AS n FROM monitors').first<number>('n')) ?? 0

const storedConfig = async (location: string | null) => {
  const id = location?.replace('/monitors/', '')
  const row = await env.DB.prepare('SELECT config_json FROM monitors WHERE id = ?')
    .bind(id)
    .first<{ config_json: string }>()
  return JSON.parse(row!.config_json)
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const errorNextTo = (field: string, message: string) =>
  new RegExp(
    `name="${escapeRegExp(field)}"(?:(?!</p>|</fieldset>)[^])*id="${escapeRegExp(field)}-error"[^>]*>[^<]*${message}`,
  )

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
  channelId = await insertChannel(
    env.DB,
    { displayName: 'Form test', secretName: 'SLACK_FORM' },
    '2026-01-01T00:00:00Z',
  )
})

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM monitors').run()
})

describe('monitor create form', () => {
  it('creates a css_attr + daily + change monitor', async () => {
    const res = await submit([
      ['name', 'Price drop'],
      ['schedule.type', 'daily'],
      ['schedule.minutes', '60'],
      ['schedule.time', '09:30'],
      ['schedule.timezone', 'Asia/Tokyo'],
      ['source.url', 'https://example.com/item'],
      ['extractor.type', 'css_attr'],
      ['extractor.selector', 'meta[itemprop=price]'],
      ['extractor.attribute', 'content'],
      ['extractor.parse', 'jpy'],
      ['evaluator.type', 'change'],
      ['evaluator.field', 'jpy'],
      ['evaluator.op', 'decreased_by_percent'],
      ['evaluator.value', '10'],
      ['trigger.type', 'on_value_change'],
      ['channelIds', channelId],
    ])

    expect(res.status).toBe(302)
    expect(await storedConfig(res.headers.get('location'))).toEqual({
      name: 'Price drop',
      schedule: { type: 'daily', time: '09:30', timezone: 'Asia/Tokyo' },
      source: { type: 'http', url: 'https://example.com/item' },
      extractor: { type: 'css_attr', selector: 'meta[itemprop=price]', attribute: 'content', parse: 'jpy' },
      evaluator: { type: 'change', field: 'jpy', op: 'decreased_by_percent', value: 10 },
      trigger: { type: 'on_value_change' },
      channelIds: [channelId],
    } satisfies MonitorConfig)
  })

  it('creates a css_text + interval + rule monitor', async () => {
    const res = await submit([
      ['name', 'Stock'],
      ['schedule.type', 'interval'],
      ['schedule.minutes', '30'],
      ['schedule.time', ''],
      ['schedule.timezone', 'Asia/Tokyo'],
      ['source.url', 'https://example.com/item'],
      ['extractor.type', 'css_text'],
      ['extractor.selector', '#stock'],
      ['extractor.attribute', 'ignored'],
      ['extractor.parse', 'text'],
      ['evaluator.type', 'rule'],
      ['evaluator.field', 'text'],
      ['evaluator.op', 'contains'],
      ['evaluator.value', 'In stock'],
      ['trigger.type', 'on_enter'],
      ['channelIds', channelId],
    ])

    expect(res.status).toBe(302)
    expect(await storedConfig(res.headers.get('location'))).toEqual({
      name: 'Stock',
      schedule: { type: 'interval', minutes: 30 },
      source: { type: 'http', url: 'https://example.com/item' },
      extractor: { type: 'css_text', selector: '#stock', parse: 'text' },
      evaluator: { type: 'rule', field: 'text', op: 'contains', value: 'In stock' },
      trigger: { type: 'on_enter' },
      channelIds: [channelId],
    } satisfies MonitorConfig)
  })

  it('shows each error next to its field, keeps the input and inserts nothing', async () => {
    const res = await submit([
      ['name', 'Broken'],
      ['schedule.type', 'daily'],
      ['schedule.time', '09:30'],
      ['schedule.timezone', 'Mars/Olympus'],
      ['source.url', 'https://example.com/item'],
      ['extractor.type', 'css_text'],
      ['extractor.selector', ''],
      ['extractor.parse', 'text'],
      ['evaluator.type', 'rule'],
      ['evaluator.field', 'text'],
      ['evaluator.op', 'contains'],
      ['evaluator.value', 'x'],
      ['trigger.type', 'on_enter'],
    ])
    const html = await res.text()

    expect(res.status).toBe(400)
    expect(html).toMatch(errorNextTo('schedule.timezone', 'must be a valid IANA time zone name'))
    expect(html).toMatch(errorNextTo('extractor.selector', 'Too small'))
    expect(html).toMatch(errorNextTo('channelIds', 'Too small'))
    expect(html).toContain('value="Mars/Olympus"')
    expect(await monitorCount()).toBe(0)
  })
})
