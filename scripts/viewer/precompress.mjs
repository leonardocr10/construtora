import {readdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync,brotliCompressSync,constants} from 'node:zlib';

export async function precompress(root) {
  let count=0;
  async function walk(folder){
    for(const entry of await readdir(folder,{withFileTypes:true})){
      const file=join(folder,entry.name);
      if(entry.isDirectory()){await walk(file);continue;}
      if(!entry.isFile()||! /\.(js|css|json|svg|wasm|glb|html)$/i.test(entry.name))continue;
      const source=await readFile(file);if(source.length<1024)continue;
      await writeFile(`${file}.gz`,gzipSync(source,{level:9}));
      await writeFile(`${file}.br`,brotliCompressSync(source,{params:{[constants.BROTLI_PARAM_QUALITY]:5}}));
      count++;
    }
  }
  await walk(root);return count;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  console.log(`Arquivos pre-comprimidos: ${await precompress(fileURLToPath(new URL('../../apps/viewer/dist/',import.meta.url)))}`);
}
