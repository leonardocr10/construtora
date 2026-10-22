import {createHash} from 'node:crypto';
import {mkdir, stat, open} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {Worker} from 'node:worker_threads';

export interface PublicFile {path: string; mimeType: string; checksum: string | null; encoding?: 'gzip'}
const pending = new Map<string, Promise<void>>();
const failures = new Map<string, number>();
let tail = Promise.resolve();
const version = 'meshopt-bytes-v1';

function encode(input: string, output: string): Promise<void> {
  return new Promise((resolveTask, reject) => {
    const worker = new Worker(resolve(__dirname, '..', '..', '..', '..', 'scripts', 'viewer', 'optimize-glb-worker.mjs'), {workerData: {input, output}});
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error('Tempo limite de compactacao')); }, 45_000);
    worker.once('message', (message: {ok: boolean; message?: string}) => {
      clearTimeout(timer);
      if (message.ok) resolveTask(); else reject(new Error(message.message ?? 'Compactacao indisponivel'));
    });
    worker.once('error', error => { clearTimeout(timer); reject(error); });
    worker.once('exit', code => { clearTimeout(timer); reject(new Error(`Compactador terminou sem resultado (codigo ${code})`)); });
  });
}

/** Chamar somente DEPOIS da verificacao de publicacao/autorizacao do arquivo original. */
export async function optimizedGlb(source: PublicFile, storage: string, acceptsGzip: boolean): Promise<PublicFile> {
  if (source.mimeType !== 'model/gltf-binary' && !source.path.toLowerCase().endsWith('.glb')) return source;
  try {
    const info = await stat(source.path);
    if (info.size > 100 * 1024 * 1024 || info.size < 20) return source;
    const signature = createHash('sha256').update(`${version}|${source.checksum}|${info.size}|${info.mtimeMs}`).digest('hex');
    const output = join(resolve(storage), '.viewer-cache', `${signature}.glb`);
    const representation = acceptsGzip ? `${output}.gz` : output;
    let cached = await stat(representation).catch(() => null);
    if (!cached) {
      if ((failures.get(signature) ?? 0) > Date.now()) return source;
      // Limite global: um worker por vez e no maximo oito derivadas na fila.
      let job = pending.get(signature);
      if (!job) {
        if (pending.size >= 8) return source;
        const header = await open(source.path, 'r');
        try { const bytes = Buffer.alloc(4); await header.read(bytes, 0, 4, 0); if (bytes.toString() !== 'glTF') return source; }
        finally { await header.close(); }
        // Uma segunda requisicao pode ter criado o job durante a leitura do cabecalho.
        job = pending.get(signature);
        if (!job) {
          if (pending.size >= 8) return source;
          job = tail.then(async () => {
            await mkdir(join(resolve(storage), '.viewer-cache'), {recursive: true});
            await encode(source.path, output);
          });
          pending.set(signature, job);
          tail = job.catch(() => undefined);
          void job.then(() => pending.delete(signature), () => {
            pending.delete(signature);
            if (failures.size > 1000) failures.clear();
            failures.set(signature, Date.now() + 300_000);
          });
        }
      }
      await job;
      cached = await stat(representation);
    }
    if (cached.size >= info.size) return source;
    return {...source, path: representation, checksum: `${signature}${acceptsGzip ? '-gzip' : ''}`, encoding: acceptsGzip ? 'gzip' : undefined};
  } catch {
    // Dependencia/codec ausente ou GLB nao suportado: entrega o original publicado.
    return source;
  }
}
