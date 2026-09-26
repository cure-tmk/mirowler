import { Hono } from 'hono'
import { listNotificationsByMonitor } from '../../db/notifications'
import { listHistoryByMonitor, type RunPosition } from '../../db/runs'
import type { AppEnv } from '../../env'
import { badRequest } from './badRequest'

const DEFAULT_PAGE = 50
const MAX_PAGE = 100

const encodeCursor = ({ scheduledAt, runId }: RunPosition) =>
  btoa(JSON.stringify([scheduledAt, runId]))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')

const decodeCursor = (cursor: string): RunPosition | null => {
  try {
    const value: unknown = JSON.parse(atob(cursor.replaceAll('-', '+').replaceAll('_', '/')))
    if (Array.isArray(value) && value.length === 2) {
      const [scheduledAt, runId] = value
      if (typeof scheduledAt === 'string' && typeof runId === 'string') {
        return { scheduledAt, runId }
      }
    }
  } catch {}
  return null
}

const pageSize = (limit: string | undefined) => {
  const n = Number(limit)
  return Number.isInteger(n) && n > 0 ? Math.min(n, MAX_PAGE) : DEFAULT_PAGE
}

export const runsApi = new Hono<AppEnv>()
  .get('/:id/runs', async (c) => {
    const cursor = c.req.query('cursor')
    const after = cursor ? decodeCursor(cursor) : undefined
    if (after === null) {
      return badRequest(c, 'invalid cursor', [{ path: 'cursor', message: 'invalid cursor' }])
    }
    const limit = pageSize(c.req.query('limit'))
    const runs = await listHistoryByMonitor(c.env.DB, c.req.param('id'), limit + 1, after)
    const page = runs.slice(0, limit)
    const last = page.at(-1)
    return c.json({ runs: page, nextCursor: runs.length > limit && last ? encodeCursor(last) : null })
  })
  .get('/:id/notifications', async (c) => c.json(await listNotificationsByMonitor(c.env.DB, c.req.param('id'))))
