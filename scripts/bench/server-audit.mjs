// Diagnostico somente leitura do visualizador publicado; Chrome isolado, GPU por software.
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const url=new URL(process.argv[2]??'http://66.94.100.166:4300/union-vista');url.searchParams.set('medir','1');
const dir=resolve('bench-out/server-audit');await mkdir(dir,{recursive:true});
const browser=spawn(process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless=new','--remote-debugging-port=9337','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader',
  '--window-size=1440,900',`--user-data-dir=${dir}/profile`,'about:blank'],{stdio:'ignore',windowsHide:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let ws;
try{
  let tabs;for(let i=0;i<60;i++){try{tabs=await(await fetch('http://127.0.0.1:9337/json')).json();break;}catch{await sleep(150);}}
  const tab=tabs?.find(t=>t.type==='page');if(!tab)throw Error('Chrome nao iniciou');
  ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
  let id=0;const pending=new Map(),errors=[],failures=[];
  ws.onmessage=event=>{const m=JSON.parse(event.data);
    if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}
    else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);
    else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.description??a.value).join(' '));
    else if(m.method==='Network.responseReceived'&&m.params.response.status>=400)failures.push({url:m.params.response.url,status:m.params.response.status});
    else if(m.method==='Network.loadingFailed')failures.push({type:m.params.type,error:m.params.errorText});
  };
  const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,t=setTimeout(()=>reject(Error(`CDP timeout ${method}`)),30000);pending.set(n,m=>{clearTimeout(t);m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result);});ws.send(JSON.stringify({id:n,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});
  await send('Emulation.setDeviceMetricsOverride',{width:Number(process.env.AUDIT_WIDTH??1440),height:Number(process.env.AUDIT_HEIGHT??900),deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:url.href});
  let ready=false;for(let i=0;i<90;i++){await sleep(1000);if(await evaluate('Boolean(window.__vista?.readyAt)')){ready=true;break;}}
  const info=await evaluate(`(()=>{const v=window.__vista,w=v?.world,s=w?.scene;const r=performance.getEntriesByType('resource');return {url:location.href,secureContext:isSecureContext,navigatorGpu:!!navigator.gpu,ready:!!v?.readyAt,interactiveMs:v?.interactiveAt,completeMs:v?.readyAt,webgpu:w?.webgpu,quality:w?.quality,compatibilityMode:w?.compatibilityMode,buffer:w?[w.engine.getRenderWidth(),w.engine.getRenderHeight()]:null,shadow:!!w?.shadow,postprocess:!!w?.pipeline,ssao:!!w?.ssao,lowResTextures:w?.library?.lowRes,models:r.filter(x=>x.name.includes('optimized=1')).map(x=>({url:x.name,bytes:x.encodedBodySize,ms:Math.round(x.duration)})),meshCount:s?.meshes.length,resources:r.length,transferBytes:r.reduce((n,x)=>n+x.transferSize,0),largest:r.filter(x=>x.transferSize>10000).sort((a,b)=>b.transferSize-a.transferSize).slice(0,12).map(x=>({url:x.name,bytes:x.transferSize,ms:Math.round(x.duration)}))};})()`);
  if(process.env.EXPECT_HIGH==='1'&&(!info.ready||info.quality!=='high'||info.compatibilityMode||!info.shadow||!info.postprocess||info.lowResTextures))throw Error('Perfil Alta nao foi aplicado: '+JSON.stringify(info));
  if(ready){const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(`${dir}/published.png`,Buffer.from(shot.data,'base64'));
    info.qualityAfterChoosingHigh=await evaluate(`(()=>{__vista.world.setQuality('high',false);return __vista.world.quality})()`);
  }
  const result={info,errors,failures,note:'GPU por software: tempos nao representam aparelho fisico nem GPU real.'};
  await writeFile(`${dir}/metrics.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{ws?.close();browser.kill();}
