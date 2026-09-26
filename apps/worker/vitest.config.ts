import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      // The workerd bundled with vitest-pool-workers does not yet support the compatibility_date in wrangler.jsonc
      miniflare: { compatibilityDate: '2026-08-22' },
    }),
  ],
})
