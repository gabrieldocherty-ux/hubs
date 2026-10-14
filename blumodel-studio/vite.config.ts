import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * drei's useGLTF defaults its Draco decoders to www.gstatic.com. The app always passes the
 * self-hosted /draco/ (src/components/three/gltf.tsx), so the default is never fetched, but the URL
 * would still ship in the bundle. Point the default at /draco/ too, so nothing the site serves
 * names a Google host (the fonts are self-hosted for the same reason: src/fonts.css).
 */
const DRACO_CDN = /https:\/\/www\.gstatic\.com\/draco\/versioned\/decoders\/[\d.]+\//g;
const selfHostedDraco = (): Plugin => ({
  name: 'blumodel-self-hosted-draco',
  transform(code, id) {
    if (!id.includes('@react-three') || !code.includes('www.gstatic.com/draco/')) return null;
    return { code: code.replace(DRACO_CDN, '/draco/'), map: null };
  },
});

// The API listens on 8790 by default (server/config.mjs). Never 8787: another app owns it on
// Gabe's PC. BLUMODEL_API_PORT points the dev proxy at a server started on another port.
export default defineConfig({
  plugins: [react(), selfHostedDraco()],
  server: {
    proxy: { '/api': `http://127.0.0.1:${process.env.BLUMODEL_API_PORT ?? 8790}`, '/files': `http://127.0.0.1:${process.env.BLUMODEL_API_PORT ?? 8790}` },
  },
});
