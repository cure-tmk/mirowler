import type { Bindings } from './env'
import { app } from './http/app'
import { scheduled } from './scheduled'

export default { fetch: app.fetch, scheduled } satisfies ExportedHandler<Bindings>
