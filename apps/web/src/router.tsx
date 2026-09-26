import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { MonitorList } from './MonitorList'
import { Shell } from './Shell'

const rootRoute = createRootRoute({
  component: Shell,
  notFoundComponent: () => <p>Page not found</p>,
})

const monitorsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: MonitorList })

export const router = createRouter({ routeTree: rootRoute.addChildren([monitorsRoute]) })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
