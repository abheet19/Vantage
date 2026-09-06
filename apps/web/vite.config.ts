/**
 * vite.config.ts — the dev server, the production build, and the /v1 proxy the SPA is built against.
 *
 * Why it exists: 03-UI §6.1 / LLD §1 say the web talks only to `/v1/*`. The SPA therefore uses relative
 * `/v1` URLs and never learns the API's origin; this proxy is the one place that origin lives, in dev
 * (`server`) and in the preview build the e2e suite drives (`preview`). `VANTAGE_API_URL` overrides the
 * target so CI and the Playwright harness can point at whatever port they booted the API on.
 *
 * What it must never do: hard-code a cross-origin API base into the app, or add a plugin the build does
 * not need — no chart library, no CSS framework (03-UI: purpose-built SVG/HTML, tokens verbatim).
 */
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = process.env['VANTAGE_API_URL'] ?? 'http://127.0.0.1:4100';
const proxy = { '/v1': { target: apiTarget, changeOrigin: true }, '/health': { target: apiTarget, changeOrigin: true } };

export default defineConfig({
  plugins: [react()],
  // Bind loopback as 127.0.0.1 (IPv4), not the default `localhost` (which resolves to ::1 on this OS):
  // the e2e baseURL and the API both use 127.0.0.1, and a preview on ::1 would be unreachable to them.
  server: { host: '127.0.0.1', port: 5174, strictPort: true, proxy },
  preview: { host: '127.0.0.1', port: 5175, strictPort: true, proxy },
  build: { outDir: 'dist', sourcemap: true },
});
