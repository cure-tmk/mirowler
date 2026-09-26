import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { Channels } from './Channels'
import { MonitorDetail } from './MonitorDetail'
import { MonitorList } from './MonitorList'
import { Shell } from './Shell'

const rootRoute = createRootRoute({
  component: Shell,
  notFoundComponent: () => <p>Page not found</p>,
})

const monitorsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: MonitorList })

const monitorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/monitors/$monitorId',
  component: MonitorDetail,
})

const channelsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/channels', component: Channels })

export const router = createRouter({ routeTree: rootRoute.addChildren([monitorsRoute, monitorRoute, channelsRoute]) })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
