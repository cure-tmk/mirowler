import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const devAuthHeaders = () => {
  try {
    const vars = readFileSync(new URL('../worker/.dev.vars', import.meta.url), 'utf8')
    const credential = vars.match(/^ADMIN_BASIC_AUTH=["']?(.*?)["']?\s*$/m)?.[1]
    return credential ? { Authorization: `Basic ${Buffer.from(credential).toString('base64')}` } : undefined
  } catch {
    return undefined
  }
}

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  server: {
    proxy: {
      // Keeps the browser's Host header (no changeOrigin): the Worker's CSRF check matches the Origin of a non-JSON POST against it unless Sec-Fetch-Site is same-origin
      '/api': { target: 'http://localhost:8787', headers: devAuthHeaders() },
    },
  },
})
