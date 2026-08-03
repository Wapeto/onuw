import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // `sw.ts` is a second, self-contained entry (no imports, no shared
      // chunks) so it can be emitted as a single stable-named file at the
      // dist root instead of a hashed asset — the browser needs a fixed
      // URL to register it.
      input: {
        main: 'index.html',
        sw: 'src/sw.ts',
      },
      output: {
        entryFileNames: (chunkInfo) => (chunkInfo.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
})
