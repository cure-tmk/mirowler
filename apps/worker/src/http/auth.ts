import type { MiddlewareHandler } from 'hono'
import { basicAuth } from 'hono/basic-auth'
import { type AppEnv, readSecret } from '../env'

export const auth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const credential = readSecret(c.env, 'ADMIN_BASIC_AUTH')
  const sep = credential?.indexOf(':') ?? -1
  if (!credential || sep < 1) {
    return c.text('ADMIN_BASIC_AUTH is not configured', 503)
  }
  return basicAuth({ username: credential.slice(0, sep), password: credential.slice(sep + 1) })(c, next)
}
