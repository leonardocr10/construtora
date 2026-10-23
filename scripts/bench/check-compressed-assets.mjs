import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {precompress} from '../viewer/precompress.mjs';
import {compressedAssetMiddleware} from '../viewer/compressed-assets.mjs';
const temporary=await mkdtemp(join(tmpdir(),'vistahub-compressed-'));
const root=join(temporary,'dist');await mkdir(join(root,'assets'),{recursive:true});
const source='const text="'+ 'conteudo-estatico-'.repeat(2000)+'";';
await writeFile(join(root,'assets','app-test.js'),source);
await writeFile(join(temporary,'secret.js'),'nao publico');
await precompress(root);
const handler=compressedAssetMiddleware(root);
const server=createServer((req,res)=>handler(req,res,error=>{res.statusCode=error?500:404;res.end();}));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
try{
  const br=await fetch(`${base}/assets/app-test.js`,{headers:{'accept-encoding':'br, gzip'}});
  assert.equal(br.headers.get('content-encoding'),'br');assert.equal(await br.text(),source);
  assert.ok(br.headers.get('cache-control').includes('immutable'));
  const gzip=await fetch(`${base}/assets/app-test.js`,{headers:{'accept-encoding':'br;q=0,gzip;q=1'}});
  assert.equal(gzip.headers.get('content-encoding'),'gzip');assert.equal(await gzip.text(),source);
  assert.notEqual(br.headers.get('etag'),gzip.headers.get('etag'));
  const head=await fetch(`${base}/assets/app-test.js`,{method:'HEAD',headers:{'accept-encoding':'gzip'}});
  assert.equal(await head.text(),'');assert.ok(Number(head.headers.get('content-length'))<source.length);
  const unchanged=await fetch(`${base}/assets/app-test.js`,{headers:{'accept-encoding':'br','if-none-match':br.headers.get('etag')}});
  assert.equal(unchanged.status,304);
  for(const path of ['/api/v1/public/assets/example','/%2e%2e%2fsecret.js','/%invalid.js']){
    const response=await fetch(base+path);assert.equal(response.status,404,'Nao servir API/arquivos fora do dist.');
  }
  const identity=await fetch(`${base}/assets/app-test.js`,{headers:{'accept-encoding':'br;q=0,gzip;q=0'}});
  assert.equal(identity.status,404,'Identity deve seguir para o servidor estatico normal.');
  console.log('OK: Brotli/gzip, conteudo identico, HEAD, ETag/304, q=0, cache e limites de caminho.');
}finally{await new Promise(resolve=>server.close(resolve));await rm(temporary,{recursive:true,force:true});}
