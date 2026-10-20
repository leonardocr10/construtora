import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Gerador local de GLB das torres com o Blender em modo headless (sem serviço pago nem rede).
 * Funções puras, sem Nest/Prisma, para serem testadas direto com `node --test`.
 */

export type BlenderErrorCode = 'BLENDER_MISSING' | 'SCRIPT_MISSING' | 'INVALID_PARAMS' | 'TIMEOUT' | 'FAILED' | 'INVALID_OUTPUT';
export class BlenderError extends Error {
  constructor(readonly code: BlenderErrorCode, message: string, readonly stderr = '') { super(message); }
}

export interface TowerSource {
  code: string; name: string; floorCount: number | null; unitsPerFloor: number | null;
  floorHeight: number | string | { toString(): string } | null; model3d: unknown;
}

/** Monta o JSON de entrada do build_tower.py a partir do registro da torre (mesmos parâmetros do visualizador). */
export function towerInput(building: TowerSource, floorNumbers: number[] = []) {
  const floors = [...floorNumbers].sort((a, b) => a - b);
  const floorCount = building.floorCount ?? (floors.length || 1);
  const height = building.floorHeight == null ? NaN : Number(building.floorHeight.toString());
  return {
    code: building.code, name: building.name, floorCount,
    floorHeight: Number.isFinite(height) && height > 0 ? height : 2.9,
    unitsPerFloor: building.unitsPerFloor ?? undefined,
    // Só envia a numeração real quando ela cobre exatamente os pavimentos do gerador.
    floors: floors.length === floorCount ? floors : undefined,
    model3d: building.model3d && typeof building.model3d === 'object' ? building.model3d : undefined,
  };
}

/** Caminho do blender.exe vindo de BLENDER_PATH; falha com mensagem clara quando ausente. */
export function resolveBlenderPath(env: NodeJS.ProcessEnv = process.env) {
  const path = env.BLENDER_PATH?.trim().replace(/^"|"$/g, '');
  if (!path) throw new BlenderError('BLENDER_MISSING', 'BLENDER_PATH não está definido no .env. Instale o Blender 4.2+ (a versão portátil serve) e aponte BLENDER_PATH para o executável, ex.: D:/construtora/tools/blender-5.2.2-windows-x64/blender.exe');
  if (!existsSync(path)) throw new BlenderError('BLENDER_MISSING', `Blender não encontrado em BLENDER_PATH (${path}). Confira o caminho no .env.`);
  return path;
}

/** Script build_tower.py: BLENDER_SCRIPT ou scripts/blender na raiz do repositório (mesma profundidade em src e dist). */
export function resolveTowerScript(env: NodeJS.ProcessEnv = process.env) {
  const path = env.BLENDER_SCRIPT?.trim() || resolve(__dirname, '..', '..', '..', '..', 'scripts', 'blender', 'build_tower.py');
  if (!existsSync(path)) throw new BlenderError('SCRIPT_MISSING', `Script do gerador não encontrado: ${path}`);
  return path;
}

export interface BlenderRun { durationMs: number; result: Record<string, unknown> | null; stdout: string; stderr: string }

const keepTail = (text: string, max = 64 * 1024) => (text.length > max ? text.slice(-max) : text);

/** Roda `blender -b --factory-startup --python build_tower.py -- input.json output.glb` com tempo limite. */
export function runBlender(options: { blender: string; script: string; input: string; output: string; timeoutMs?: number; env?: Record<string, string> }): Promise<BlenderRun> {
  const timeoutMs = options.timeoutMs ?? 180_000;
  const started = Date.now();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(options.blender, ['-b', '--factory-startup', '--python-exit-code', '1', '--python', options.script, '--', options.input, options.output], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...(options.env ?? {}) } });
    let stdout = ''; let stderr = ''; let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout = keepTail(stdout + chunk); });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr = keepTail(stderr + chunk); });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.on('error', (error) => { clearTimeout(timer); reject(new BlenderError('FAILED', `Não foi possível iniciar o Blender: ${error.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new BlenderError('TIMEOUT', `O Blender excedeu o tempo limite de ${Math.round(timeoutMs / 1000)} s`, stderr));
      const vhError = [...stderr.matchAll(/^VH_ERROR (.+)$/gm)].map((m) => m[1].trim()).pop();
      if (code === 2) return reject(new BlenderError('INVALID_PARAMS', vhError ?? 'Parâmetros da torre inválidos', stderr));
      if (code !== 0) return reject(new BlenderError('FAILED', vhError ?? `O Blender terminou com código ${code}: ${stderr.trim().split(/\r?\n/).slice(-3).join(' | ')}`, stderr));
      const line = stdout.match(/^VH_RESULT (.+)$/m);
      let result: Record<string, unknown> | null = null;
      try { result = line ? JSON.parse(line[1]) : null; } catch { result = null; }
      resolvePromise({ durationMs: Date.now() - started, result, stdout, stderr });
    });
  });
}

export interface GlbInfo { version: number; byteLength: number; json: { asset?: { generator?: string }; nodes?: { name?: string; extras?: Record<string, unknown> }[]; materials?: { name?: string }[] } }

/** Lê o cabeçalho GLB (magic, versão 2, tamanho) e o chunk JSON. Lança BlenderError se o arquivo não for um GLB válido. */
export function parseGlb(buffer: Buffer): GlbInfo {
  if (buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'glTF') throw new BlenderError('INVALID_OUTPUT', 'Arquivo gerado não é um GLB (magic glTF ausente)');
  const version = buffer.readUInt32LE(4);
  const byteLength = buffer.readUInt32LE(8);
  if (version !== 2) throw new BlenderError('INVALID_OUTPUT', `GLB com versão ${version}; esperado glTF 2.0`);
  if (byteLength !== buffer.length) throw new BlenderError('INVALID_OUTPUT', `Tamanho do GLB inconsistente (${byteLength} declarado, ${buffer.length} no arquivo)`);
  const chunkLength = buffer.readUInt32LE(12);
  if (buffer.readUInt32LE(16) !== 0x4e4f534a || 20 + chunkLength > buffer.length) throw new BlenderError('INVALID_OUTPUT', 'GLB sem chunk JSON válido');
  return { version, byteLength, json: JSON.parse(buffer.toString('utf8', 20, 20 + chunkLength)) };
}

/** Código da torre como o build_tower.py o usa nos nomes de nós. */
export const towerNodeCode = (code: string) => code.replace(/[^A-Za-z0-9_.]/g, '_').slice(0, 40) || 'A';

/** Nome determinístico do volume comercial de um apartamento (igual ao do build_tower.py). */
export const unitNodeName = (code: string, floor: number, final: string) => `T${towerNodeCode(code)}-F${floor}-U${final.replace(/[^A-Za-z0-9]/g, '').slice(0, 8)}`;

/** Compressão KTX2 dos GLB (scripts/blender/ktx2-glb-lib.mjs): null quando KTX_PATH não aponta para o KTX-Software. */
export async function loadKtx2(env: NodeJS.ProcessEnv = process.env) {
  const path = resolve(__dirname, '..', '..', '..', '..', 'scripts', 'blender', 'ktx2-glb-lib.mjs');
  if (!existsSync(path)) return null;
  const lib = (await import(path)) /* commonjs: vira require() do .mjs, suportado no Node 22.12+ */ as { resolveKtxBin: (env: NodeJS.ProcessEnv) => string | null; compressGlbTextures: (buffer: Buffer, bin: string) => Promise<Buffer> };
  const bin = lib.resolveKtxBin(env);
  return bin ? { compress: (buffer: Buffer) => lib.compressGlbTextures(buffer, bin) } : null;
}
