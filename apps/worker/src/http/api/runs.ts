import { Hono } from 'hono'
import { listRunsByMonitor } from '../../db/runs'
import type { AppEnv } from '../../env'

export const runsApi = new Hono<AppEnv>().get('/:id/runs', async (c) =>
  c.json(await listRunsByMonitor(c.env.DB, c.req.param('id'))),
)
