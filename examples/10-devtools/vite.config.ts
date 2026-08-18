import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // elkjs (the layout engine) is a 1.4 MB chunk by nature; the devtools load it lazily.
  build: { chunkSizeWarningLimit: 1_600 },
})
