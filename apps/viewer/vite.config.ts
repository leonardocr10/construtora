import { defineConfig } from 'vite';

// Em desenvolvimento a API roda na porta 3000; o proxy mantém tudo na mesma origem.
export default defineConfig({
  server: { port: 4300, proxy: { '/api': 'http://localhost:3000' } },
  preview: { port: 4300, proxy: { '/api': 'http://localhost:3000' } },
  build: { chunkSizeWarningLimit: 1200 },
});
