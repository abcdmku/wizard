import { withNitro } from '@openwizard/webhooks/nitro'
import { defineConfig } from 'nitro'
import { http } from './server/http'

export default defineConfig(
  withNitro(
    {
      compatibilityDate: '2026-08-19',
      serverDir: './server',
    },
    {
      http,
      source: new URL('./server/http.ts', import.meta.url),
      openAPI: {
        production: 'prerender',
        route: '/openapi.json',
        ui: { scalar: false, swagger: false },
      },
    },
  ),
)
