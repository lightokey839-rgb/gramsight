import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    // The glasses app talks to the Gramsight backend through this proxy in development, so no CORS is needed
    // and the backend can stay bound to 127.0.0.1.
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  build: { target: 'esnext' },
})
