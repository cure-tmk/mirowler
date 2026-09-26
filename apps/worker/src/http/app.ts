import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import type { AppEnv } from '../env'
import { channelsApi } from './api/channels'
import { monitorsApi } from './api/monitors'
import { previewApi } from './api/preview'
import { runsApi } from './api/runs'
import { auth } from './auth'

const checkOrigin = csrf()

export const app = new Hono<AppEnv>()
  .get('/healthz', (c) => c.text('ok'))
  .use('*', auth)
  // A cross-site form can still post a JSON-looking text/plain body. Browsers send Origin or Sec-Fetch-Site on every
  // form POST; clients like curl send neither and cannot be CSRF-ed
  .use('*', (c, next) => (c.req.header('origin') || c.req.header('sec-fetch-site') ? checkOrigin(c, next) : next()))
  .route('/api/monitors', monitorsApi)
  .route('/api/monitors', runsApi)
  .route('/api/channels', channelsApi)
  .route('/api/preview', previewApi)
