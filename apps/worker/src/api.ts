import type { Hono } from 'hono'
import type { HonoBase } from 'hono/hono-base'
import type { BlankEnv, Schema } from 'hono/types'
import type { AppEnv } from './env'
import { app } from './http/app'

// Emitted as a declaration for apps/web. Dropping the Bindings makes the declaration inline the route schema
// instead of referencing `Env`, which only resolves with the Workers types the browser build must not load.
const withoutBindings = <S extends Schema, B extends string>(hono: HonoBase<AppEnv, S, B>) =>
  hono as unknown as Hono<BlankEnv, S, B>

const api = withoutBindings(app)

/** Route types of the Worker's HTTP app, for `hc` from `hono/client`. */
export type ApiType = typeof api
