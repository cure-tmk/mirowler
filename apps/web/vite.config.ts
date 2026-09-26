import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  // Keeps the browser's Host header: the Worker's CSRF check matches the Origin of a non-JSON POST against it unless Sec-Fetch-Site is same-origin
  server: { proxy: { '/api': 'http://localhost:8787' } },
})
