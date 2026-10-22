// Derivada web: preserva nos, materiais, interiores, atributos e orientacao das faces.
// Nao simplifica a geometria, nao quantiza coordenadas e nunca regrava o original.
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS, EXTMeshoptCompression} from '@gltf-transform/extensions';
import {MeshoptEncoder, MeshoptDecoder} from 'meshoptimizer';
import {parentPort, workerData} from 'node:worker_threads';
import {readFile, writeFile, rename, rm} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {randomUUID} from 'node:crypto';

export async function encodeWebGlb(buffer) {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
  });
  const document = await io.readBinary(buffer);
  // Sem o transform quantize(): QUANTIZE aqui escolhe o codec de bytes sem filtros lossy.
  document.createExtension(EXTMeshoptCompression).setRequired(true)
    .setEncoderOptions({method: EXTMeshoptCompression.EncoderMethod.QUANTIZE});
  return Buffer.from(await io.writeBinary(document));
}

if (parentPort && workerData) {
  const {input, output} = workerData;
  const temporary = `${output}.${randomUUID()}.tmp`;
  try {
    const buffer = await encodeWebGlb(await readFile(input));
    const gzip = gzipSync(buffer, {level: 9});
    await writeFile(temporary, buffer);
    await writeFile(`${temporary}.gz`, gzip);
    await rename(temporary, output);
    await rename(`${temporary}.gz`, `${output}.gz`);
    parentPort.postMessage({ok: true, bytes: buffer.length, gzipBytes: gzip.length});
  } catch (error) {
    parentPort.postMessage({ok: false, message: error.message});
  } finally {
    await rm(temporary, {force: true});
    await rm(`${temporary}.gz`, {force: true});
  }
}
