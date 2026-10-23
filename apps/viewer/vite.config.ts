import { defineConfig, loadEnv } from 'vite';
import {compressedAssetsPlugin} from '../../scripts/viewer/compressed-assets.mjs';

// Em desenvolvimento a API roda na porta 3000; o proxy mantém tudo na mesma origem.
// host: true escuta em todas as interfaces (sem isso só localhost responde e o acesso de fora falha mesmo com o
// firewall liberado). Acesso por IP sempre funciona; por domínio, o Vite exige o nome em VIEWER_ALLOWED_HOSTS
// no .env da raiz (separados por vírgula).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../..', '');
  const allowedHosts = (env.VIEWER_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean);
  const server = { port: 4300, host: true, allowedHosts, proxy: { '/api': 'http://localhost:3000' } };
  return { plugins:[compressedAssetsPlugin()], server, preview: server, build: { chunkSizeWarningLimit: 1200 } };
});
