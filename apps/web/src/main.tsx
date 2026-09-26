import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { httpStatus } from './api'
import { router } from './router'
import './index.css'

// Refetching after an HTTP error only repeats it, and every repeated 401 reopens the browser's Basic auth dialog
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => httpStatus(error) === undefined && failureCount < 3,
      refetchOnWindowFocus: (query) => httpStatus(query.state.error) !== 401,
    },
  },
})

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  )
}
