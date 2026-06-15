import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Custom plugin to ensure COOP and COEP headers are applied to ALL files (including workers/modules)
const coepCoopPlugin = () => ({
  name: 'coep-coop-plugin',
  configureServer(server: any) {
    server.middlewares.use((_req: any, res: any, next: any) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      next();
    });
  },
  configurePreviewServer(server: any) {
    server.middlewares.use((_req: any, res: any, next: any) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      next();
    });
  }
});

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    coepCoopPlugin(),
  ],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: {
    exclude: ['libraw-wasm'],
  },
  build: {
    target: 'esnext',
  },
})
