// Teste em build de producao: telefone emulado e rede de ~2 Mbit/s.
// Chrome isolado com WebGL por software; nao e um ensaio em aparelho fisico.
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const output=resolve('bench-out/mobile');await mkdir(output,{recursive:true});
const browser=spawn(process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless=new','--remote-debugging-port=9336','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader',
  `--user-data-dir=${output}/profile`,'about:blank'],{stdio:'ignore',windowsHide:true});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let socket;
try{
  let pages;
  for(let i=0;i<60;i++){try{pages=await(await fetch('http://127.0.0.1:9336/json')).json();break;}catch{await sleep(150);}}
  const page=pages?.find(p=>p.type==='page');if(!page)throw Error('Chrome de teste nao iniciou');
  socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise(resolve=>socket.onopen=resolve);
  let id=0;const pending=new Map(),errors=[];
  socket.onmessage=event=>{const message=JSON.parse(event.data);
    if(message.id){pending.get(message.id)?.(message);pending.delete(message.id);}
    else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);
    else if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')errors.push(message.params.args.map(a=>a.description??a.value).join(' '));
  };
  const send=(method,params={})=>new Promise((resolve,reject)=>{
    const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error(`Timeout CDP: ${method}`));},30000);
    pending.set(n,message=>{clearTimeout(timer);message.error?reject(Error(JSON.stringify(message.error))):resolve(message.result);});
    socket.send(JSON.stringify({id:n,method,params}));
  });
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  const until=async expression=>{for(let i=0;i<100;i++){const result=await evaluate(expression);if(result)return result;await sleep(1000);}throw Error('Pagina nao ficou pronta');};
  await send('Runtime.enable');await send('Page.enable');await send('Network.enable');
  await send('Network.setCacheDisabled',{cacheDisabled:true});
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
  await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await send('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36',platform:'Linux armv8l',userAgentMetadata:{brands:[{brand:'Chromium',version:'155'}],platform:'Android',platformVersion:'14',architecture:'arm',model:'Pixel 7',mobile:true}});
  await send('Emulation.setCPUThrottlingRate',{rate:Number(process.env.BENCH_CPU_RATE??1)});
  await send('Network.emulateNetworkConditions',{offline:false,latency:80,downloadThroughput:250000,uploadThroughput:100000,connectionType:'cellular4g'});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:'try{localStorage.removeItem("vistahub.quality")}catch{}'});
  const url=new URL(process.argv[2]??'http://127.0.0.1:4301/union-vista');url.searchParams.set('medir','1');url.searchParams.set('motor','webgl');
  await send('Page.navigate',{url:url.href});
  await until('window.__vista?.readyAt>0');
  const initial=await evaluate(`(()=>{const v=__vista,r=performance.getEntriesByType('resource');if(!v.world.mobile)throw Error('Nao detectou celular');if(v.world.quality!=='high'||v.world.compatibilityMode)throw Error('Celular nao iniciou em Alta');if(r.some(r=>r.name.includes('optimized=1')))throw Error('GLB de torre baixado antes do clique');return {mobile:true,quality:v.world.quality,interactiveMs:Math.round(v.interactiveAt),completeMs:Math.round(v.readyAt),transferBytes:r.reduce((s,r)=>s+r.transferSize,0),towerRequests:0,details:v.site.towers.map(t=>t.group.metadata.detailState),interiorEager:r.some(r=>/interior[-.]/.test(r.name)),buffer:[v.world.engine.getRenderWidth(),v.world.engine.getRenderHeight()]};})()`);
  const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(`${output}/initial.png`,Buffer.from(shot.data,'base64'));
  await evaluate('document.querySelector("#tower-bar button:nth-child(3)").click();true');
  await until('__vista.site.towers[2].group.metadata.detailState==="ready"');
  const selected=await evaluate(`(()=>{const r=performance.getEntriesByType('resource').filter(r=>r.name.includes('optimized=1'));if(r.length!==1)throw Error('Carregou torres nao selecionadas');return {towerRequests:r.length,towerTransferBytes:r[0].encodedBodySize,states:__vista.site.towers.map(t=>t.group.metadata.detailState)};})()`);
  await evaluate(`document.querySelector('#see-units').click();document.querySelector('#mirror-panel .row[data-floor="5"] .cell').click();true`);
  await evaluate('(()=>{if(document.querySelector("#unit-panel").classList.contains("hidden"))throw Error("Card nao abriu");if(![...__vista.site.towers[2].unitMeshes.values()].some(m=>m.isEnabled()&&m.material.alpha===1))throw Error("Selecao nao solida");return true;})()');
  if(errors.length)throw Error(errors.join('\n'));
  const result={initial,selected,errors};await writeFile(`${output}/metrics.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{socket?.close();browser.kill();}
