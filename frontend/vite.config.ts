import react from '@vitejs/plugin-react';
import { defineConfig, type ProxyOptions } from 'vite';

// The browser only talks to this app's origin; /api is forwarded to the
// backend, as the production reverse proxy will do.
const apiProxy: Record<string, ProxyOptions> = {
  '/api': {
    target: 'http://localhost:3000',
    rewrite: (path) => path.replace(/^\/api/, ''),
  },
};

export default defineConfig({
  plugins: [react()],
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
});
