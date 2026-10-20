// Comprime as texturas de GLB para KTX2 (BasisLZ/ETC1S) com o gltf-transform chamando o KTX-Software.
//   node scripts/blender/ktx2-glb.mjs <arquivo.glb> [...]      (substitui cada arquivo)
// KTX_PATH (no .env ou no ambiente) aponta a pasta bin do KTX-Software (ex.: D:/construtora/tools/ktx/bin).
// As imagens dentro do GLB precisam estar em PNG ou JPEG: gere com VH_GLB_IMAGES=PNG no Blender.
import 'dotenv/config';
import { compressGlbTextures, resolveKtxBin } from './ktx2-glb-lib.mjs';
import { readFile, stat, writeFile } from 'node:fs/promises';

const files = process.argv.slice(2);
if (!files.length) { console.error('Uso: node scripts/blender/ktx2-glb.mjs <arquivo.glb> [...]'); process.exit(1); }
const ktx = resolveKtxBin();
if (!ktx) { console.error('KTX_PATH não aponta para o KTX-Software (pasta com ktx.exe)'); process.exit(1); }
for (const file of files) {
  const before = (await stat(file)).size;
  const output = await compressGlbTextures(await readFile(file), ktx);
  await writeFile(file, output);
  console.log(`${file}: ${(before / 1024).toFixed(0)} KB → ${(output.length / 1024).toFixed(0)} KB`);
}
