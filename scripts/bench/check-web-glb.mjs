import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NodeIO, Document} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MeshoptDecoder} from 'meshoptimizer';
import {encodeWebGlb} from '../viewer/optimize-glb-worker.mjs';
import {gzipSync} from 'node:zlib';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
await MeshoptDecoder.ready;
const fixture = process.argv[2];
let source;
if (fixture) source = await readFile(fixture);
else {
  const document = new Document(), buffer = document.createBuffer();
  const position = document.createAccessor().setType('VEC3').setArray(new Float32Array([0,0,0, 1,0,0, 0,1,0])).setBuffer(buffer);
  const indices = document.createAccessor().setType('SCALAR').setArray(new Uint16Array([0,1,2])).setBuffer(buffer);
  const mesh = document.createMesh('tower-panels').addPrimitive(document.createPrimitive().setAttribute('POSITION',position).setIndices(indices));
  const node = document.createNode('tower-original-name').setMesh(mesh).setTranslation([3,0,7]);
  document.createScene().addChild(node);
  source = await io.writeBinary(document);
}
const encoded = await encodeWebGlb(source), before = await io.readBinary(source), after = await io.readBinary(encoded);
const a=before.getRoot(),b=after.getRoot();
assert.deepEqual(b.listNodes().map(n=>n.getName()),a.listNodes().map(n=>n.getName()),'Nomes usados pelo recorte precisam ser preservados.');
assert.deepEqual(b.listNodes().map(n=>n.getMatrix()),a.listNodes().map(n=>n.getMatrix()),'Sem deslocar ou quantizar as torres.');
assert.deepEqual(b.listMaterials().map(m=>m.getName()),a.listMaterials().map(m=>m.getName()));
assert.equal(b.listAccessors().length,a.listAccessors().length);
const indexAccessors=new Set(a.listMeshes().flatMap(m=>m.listPrimitives().map(p=>p.getIndices())));
const canonicalTriangles=array=>Array.from({length:array.length/3},(_,i)=>{
  const t=Array.from(array.slice(i*3,i*3+3));const start=t.indexOf(Math.min(...t));
  return [t[start],t[(start+1)%3],t[(start+2)%3]];
});
for(let i=0;i<a.listAccessors().length;i++){
  const aa=a.listAccessors()[i],bb=b.listAccessors()[i];
  // O codec TRIANGLES pode girar ciclicamente os tres cantos, sem mudar face ou orientacao.
  if(indexAccessors.has(aa))assert.deepEqual(canonicalTriangles(bb.getArray()),canonicalTriangles(aa.getArray()),'Mesmas faces com a mesma orientacao.');
  else assert.deepEqual(bb.getArray(),aa.getArray(),'Atributos de vertices identicos.');
}
assert.equal(b.listTextures().length,a.listTextures().length);
for(let i=0;i<a.listTextures().length;i++)assert.deepEqual(b.listTextures()[i].getImage(),a.listTextures()[i].getImage(),'Preservar texturas KTX2.');
assert.ok(b.listExtensionsUsed().some(e=>e.extensionName==='EXT_meshopt_compression'));
console.log(JSON.stringify({result:'OK',sourceBytes:source.length,meshoptBytes:encoded.length,gzipBytes:gzipSync(encoded).length,checks:['nos','transforms','materiais','atributos sem perda','texturas','codec']}));

// Cache/fallback da API compilada: sem MySQL e sem arquivos originais do usuario.
const {optimizedGlb}=await import('../../apps/api/dist/public/optimized-glb.js');
const dir=await mkdtemp(join(tmpdir(),'vistahub-web-glb-'));
try {
  const path=join(dir,'source.glb'); await writeFile(path,source);
  const original={path,mimeType:'model/gltf-binary',checksum:'fixture'};
  const [first,second]=await Promise.all([optimizedGlb(original,dir,true),optimizedGlb(original,dir,true)]);
  assert.equal(first.path,second.path,'Requests concorrentes reutilizam a derivada.');
  assert.deepEqual(await readFile(path),source,'Original intocado.');
  if(first.encoding){
    const modified=(await stat(first.path)).mtimeMs;
    const cached=await optimizedGlb(original,dir,true);
    assert.equal((await stat(cached.path)).mtimeMs,modified,'Cache sem reprocessar.');
    assert.equal(cached.encoding,'gzip');
  }
  const broken={...original,path:join(dir,'broken.glb')};await writeFile(broken.path,'glTF invalido para conferir fallback');
  assert.deepEqual(await optimizedGlb(broken,dir,true),broken,'Falha deve entregar original, nao quebrar visita.');
  assert.deepEqual(await optimizedGlb({...original,mimeType:'image/png',path:join(dir,'photo.png')},dir,true),{...original,mimeType:'image/png',path:join(dir,'photo.png')});
  console.log('OK: concorrencia, cache, fallback e originais preservados.');
} finally { await rm(dir,{recursive:true,force:true}); }
