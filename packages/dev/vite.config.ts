import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Builds the browser UI the dev server serves. Assets use relative URLs, so any port works.
export default defineConfig({
  root: 'src/ui',
  base: './',
  plugins: [react()],
  build: {
    // elkjs, the graph layout engine, is a 1.4 MB chunk by nature.
    chunkSizeWarningLimit: 1_600,
    outDir: '../../dist/ui',
    emptyOutDir: true,
  },
})
