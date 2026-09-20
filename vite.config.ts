import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// base stays '/' — the app is served from localhost for now. Switching to
// GitHub Pages later means setting base to '/spark-web/' and nothing else.
export default defineConfig({
  base: '/',
  plugins: [react()],
  server: { port: 5173 },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
