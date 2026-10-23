import {createReadStream} from 'node:fs';
import {stat,realpath} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';

const mime={'.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.wasm':'application/wasm','.glb':'model/gltf-binary','.html':'text/html'};
function encodings(header=''){
  const weights=new Map(header.toLowerCase().split(',').map(part=>{
    const [name,...parameters]=part.trim().split(';');
    const quality=parameters.find(p=>p.trim().startsWith('q='));
    return [name,quality?Number(quality.trim().slice(2)):1];
  }));
  return ['br','gzip'].filter(name=>(weights.get(name)??weights.get('*')??0)>0)
    .sort((a,b)=>(weights.get(b)??weights.get('*')??0)-(weights.get(a)??weights.get('*')??0));
}

/** Somente artefatos estaticos dentro do dist; API, uploads e originais nao passam por aqui. */
export function compressedAssetMiddleware(directory){
  const root=resolve(directory);
  return (req,res,next)=>{void (async()=>{
    if(!['GET','HEAD'].includes(req.method??''))return next();
    let pathname;
    try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{return next();}
    const type=mime[extname(pathname).toLowerCase()];if(!type)return next();
    const file=resolve(root,`.${pathname}`);
    if(!file.startsWith(root+sep))return next();
    const original=await stat(file).catch(()=>null);if(!original?.isFile())return next();
    const canonicalRoot=await realpath(root),canonicalFile=await realpath(file);
    if(!canonicalFile.startsWith(canonicalRoot+sep))return next();
    const previous=res.getHeader('Vary');
    res.setHeader('Vary',previous?`${previous}, Accept-Encoding`:'Accept-Encoding');
    for(const encoding of encodings(req.headers['accept-encoding'])){
      const compressed=`${file}.${encoding==='gzip'?'gz':'br'}`;
      const info=await stat(compressed).catch(()=>null);
      if(!info?.isFile()||info.size>=original.size)continue;
      if(!(await realpath(compressed)).startsWith(canonicalRoot+sep))continue;
      const etag=`W/"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}-${encoding}"`;
      res.setHeader('Content-Type',type);res.setHeader('Content-Encoding',encoding);
      res.setHeader('ETag',etag);
      res.setHeader('Cache-Control',pathname.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache');
      if(req.headers['if-none-match']===etag){res.statusCode=304;return res.end();}
      res.setHeader('Content-Length',String(info.size));
      if(req.method==='HEAD')return res.end();
      createReadStream(compressed).on('error',()=>res.destroy()).pipe(res);return;
    }
    next();
  })().catch(next);};
}

export function compressedAssetsPlugin(){
  return {name:'vistahub-compressed-assets',configurePreviewServer(server){
    server.middlewares.use(compressedAssetMiddleware(resolve(server.config.root,server.config.build.outDir)));
  }};
}
