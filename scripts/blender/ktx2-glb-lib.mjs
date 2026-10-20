// Compressão das texturas de um GLB para KTX2, usada pelo script ktx2-glb.mjs e pela API (geração das torres).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '..', '..', 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js');

/** Pasta do KTX-Software (KTX_PATH: a pasta bin ou o próprio ktx.exe); null quando não está instalado. */
export function resolveKtxBin(env = process.env) {
  const raw = env.KTX_PATH?.trim().replace(/^"|"$/g, '');
  if (!raw) return null;
  const folder = /ktx(\.exe)?$/i.test(raw) ? dirname(raw) : raw;
  return existsSync(join(folder, process.platform === 'win32' ? 'ktx.exe' : 'ktx')) && existsSync(cli) ? folder : null;
}

/**
 * Comprime todas as texturas do GLB para KTX2/BasisLZ (ETC1S). O gltf-transform escolhe o espaço de cor
 * por slot (cor em sRGB; rugosidade, metal e oclusão em linear) e gera os mipmaps.
 */
export async function compressGlbTextures(buffer, ktxBin, { quality = 192 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'vistahub-ktx2-'));
  try {
    const input = join(dir, 'in.glb'); const output = join(dir, 'out.glb');
    await writeFile(input, buffer);
    await new Promise((ok, fail) => {
      const child = spawn(process.execPath, [cli, 'etc1s', input, output, '--quality', String(quality)], {
        env: { ...process.env, PATH: `${ktxBin}${delimiter}${process.env.PATH ?? ''}` }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let log = '';
      child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
      child.on('error', fail);
      child.on('close', (code) => (code === 0 ? ok() : fail(new Error(`gltf-transform etc1s terminou com código ${code}: ${log.slice(-2000)}`))));
    });
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
