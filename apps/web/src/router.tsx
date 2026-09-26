import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { Channels } from './Channels'
import { MonitorDetail } from './MonitorDetail'
import { EditMonitor, NewMonitor } from './MonitorForm'
import { MonitorList } from './MonitorList'
import { Shell } from './Shell'

const rootRoute = createRootRoute({
  component: Shell,
  notFoundComponent: () => <p>Page not found</p>,
})

const monitorsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: MonitorList })
const newMonitorRoute = createRoute({ getParentRoute: () => rootRoute, path: '/monitors/new', component: NewMonitor })
const editMonitorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/monitors/$monitorId/edit',
  component: EditMonitor,
})

const monitorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/monitors/$monitorId',
  component: MonitorDetail,
})

const channelsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/channels', component: Channels })

export const router = createRouter({
  routeTree: rootRoute.addChildren([monitorsRoute, newMonitorRoute, editMonitorRoute, monitorRoute, channelsRoute]),
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
