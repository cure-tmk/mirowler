import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { channelsApi } from './api/channels'
import { monitorsApi } from './api/monitors'
import { runsApi } from './api/runs'
import { auth } from './auth'
import { pages } from './ui/pages'

export const app = new Hono<AppEnv>()
  .get('/healthz', (c) => c.text('ok'))
  .use('*', auth)
  .route('/api/monitors', monitorsApi)
  .route('/api/monitors', runsApi)
  .route('/api/channels', channelsApi)
  .route('/', pages)
