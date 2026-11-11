import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@openwizard/fleet-shared': fileURLToPath(
          new URL('../../packages/shared/src/index.ts', import.meta.url),
        ),
        '@openwizard/http/client': fileURLToPath(
          new URL('../../../../packages/http/src/client.ts', import.meta.url),
        ),
      },
    },
    server: {
      port: 4172,
      strictPort: true,
      proxy: {
        '/api': {
          target: env.FLEET_API_PROXY ?? 'http://localhost:8082',
          changeOrigin: true,
        },
      },
    },
    preview: {
      port: 4172,
      strictPort: true,
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  }
})
