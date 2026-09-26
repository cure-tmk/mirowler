import { Hono } from 'hono'
import { listNotificationsByMonitor } from '../../db/notifications'
import { listRunsByMonitor } from '../../db/runs'
import type { AppEnv } from '../../env'

export const runsApi = new Hono<AppEnv>()
  .get('/:id/runs', async (c) => c.json(await listRunsByMonitor(c.env.DB, c.req.param('id'))))
  .get('/:id/notifications', async (c) => c.json(await listNotificationsByMonitor(c.env.DB, c.req.param('id'))))
