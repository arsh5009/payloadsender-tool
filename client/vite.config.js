import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const serverEnvPath = fileURLToPath(new URL('../server/.env', import.meta.url));
const serverEnv = fs.existsSync(serverEnvPath) ? fs.readFileSync(serverEnvPath, 'utf8') : '';
const serverPort = process.env.PORT || serverEnv.match(/^\s*PORT\s*=\s*['"]?([^\s'"]+)/m)?.[1] || '5000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // Follow the API's configured port so the dev proxy stays aligned with server/.env.
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${serverPort}`,
        changeOrigin: true,
        // The server rejects cross-origin browser requests; in dev the proxy makes requests look same-origin.
        configure: (proxy) => proxy.on('proxyReq', (proxyReq) => proxyReq.removeHeader('origin')),
      },
    },
  },
  test: { environment: 'node' },
});
