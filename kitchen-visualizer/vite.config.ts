import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API listens on 8790 by default (server/config.mjs). Never 8787: another app owns it on
// Gabe's PC. MISE_API_PORT points the dev proxy at a server started on another port.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': `http://127.0.0.1:${process.env.MISE_API_PORT ?? 8790}`, '/files': `http://127.0.0.1:${process.env.MISE_API_PORT ?? 8790}` },
  },
});
