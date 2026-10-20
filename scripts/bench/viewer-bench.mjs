// Comparativo do visualizador: mesmas câmeras, capturas, carregamento, FPS e memória.
// Comparativo da maquete: mesmas câmeras, capturas, carregamento, FPS, chamadas de desenho e memória.
//   node scripts/bench/viewer-bench.mjs <rótulo> [url] [qualidade: eco|balanced|high|ultra]
// Saída: $BENCH_DIR/<rótulo>/{v1..v5}.png e metrics.json (padrão: ./bench-out). Em produção use a URL com ?medir.
// CHROME_PATH aponta o Chrome (padrão do Windows). O Chrome roda headless com WebGPU.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const [label = 'run', url = 'http://localhost:4300/union-vista', quality = 'ultra'] = process.argv.slice(2);
const root = process.env.BENCH_DIR ?? 'bench-out';
const dir = `${root}/${label}`; mkdirSync(dir, { recursive: true });
const chrome = spawn(process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=9334', '--enable-unsafe-webgpu', '--enable-precise-memory-info', '--window-size=1600,900', '--hide-scrollbars', `--user-data-dir=${root}/chrome-profile`, 'about:blank'], { stdio: 'ignore', env: { ...process.env, TEMP: process.env.TEMP, TMP: process.env.TMP } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 60; i++) { try { targets = await (await fetch('http://127.0.0.1:9334/json')).json(); break; } catch { await sleep(200); } }
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const msg = JSON.parse(e.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
process.on('unhandledRejection', (e) => { console.error('ERRO', e?.message ?? e); chrome.kill(); process.exit(1); });
const log = (...a) => console.error('[bench]', ...a);
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600)); return r.result?.result?.value; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${dir}/${name}.png`, Buffer.from(r.result.data, 'base64')); };

log('conectado'); await send('Page.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
// Qualidade fixa (Ultra) para comparar o mesmo nível nas duas versões.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('vistahub.quality','${quality}')}catch{}` });
await send('Page.navigate', { url }); log('navegando'); await sleep(4000);
// Pronto: a versão nova marca __vista.readyAt; a anterior, quando os carros existem e a cena está pronta.
const ready = await evaluate(`new Promise((resolve) => { const t0 = performance.now(); const tick = () => {
  const v = window.__vista; const s = v?.world?.scene;
  const done = v?.readyAt ?? ((s && s.getMeshByName && [...s.meshes].some((m) => /^car-/.test(m.name))) ? performance.now() : null);
  if (done) resolve(done); else if (performance.now() - t0 > 90000) resolve(-1); else setTimeout(tick, 100); }; tick(); })`);
log('ready', ready); await sleep(1500);
const info = await evaluate(`(() => { const w = __vista.world; w.setQuality && w.setQuality('${quality}', false); return { engine: w.webgpu ? 'WebGPU' : 'WebGL2', quality: w.quality, gpu: (w.engine.getGlInfo?.().renderer) ?? '' }; })()`);

// Câmeras fixas: alvo e ângulos absolutos (iguais nas duas versões).
const views = {
  v1_aerea: '{ t: [5, 0, 0], alpha: 2.35, beta: 0.95, radius: 260 }',
  v2_fachada: '{ t: [-31.7, 16, -28.5], alpha: 1.9, beta: 1.38, radius: 62 }',
  v3_estacionamento: '{ t: [-31.7, 0, -3.8], alpha: 2.6, beta: 0.78, radius: 62 }',
  v4_rua: '{ t: [22.4, 12, -6.2], alpha: 0.6, beta: 1.47, radius: 120 }',
  v5_torre3_topo: '{ t: [22.4, 34, -6.2], alpha: 2.9, beta: 1.15, radius: 70 }',
};
const results = {};
for (const [name, spec] of Object.entries(views)) {
  await evaluate(`(() => { const s = ${spec}; const c = __vista.world.camera; c.inertialAlphaOffset = c.inertialBetaOffset = c.inertialRadiusOffset = 0; c.target.set(...s.t); c.alpha = s.alpha; c.beta = s.beta; c.radius = s.radius; return 1; })()`);
  await sleep(2500);
  await shot(name);
  const fps = await evaluate(`new Promise((resolve) => { const e = __vista.world.engine; const xs = []; const t = setInterval(() => { xs.push(e.getFps()); if (xs.length >= 16) { clearInterval(t); xs.sort((a, b) => a - b); resolve({ median: Math.round(xs[8]), min: Math.round(xs[0]) }); } }, 250); })`);
  const draw = await evaluate(`new Promise((resolve) => { const s = __vista.world.scene; const e = s.getEngine(); const c0 = e._drawCalls?.current ?? 0; let frames = 0; const o = s.onAfterRenderObservable.add(() => frames++); setTimeout(() => { s.onAfterRenderObservable.remove(o); resolve({ activeMeshes: s.getActiveMeshes().length, trianglesPerFrame: Math.round(s.getActiveIndices() / 3), drawCallsPerFrame: frames ? Math.round(((e._drawCalls?.current ?? 0) - c0) / frames) : null }); }, 1000); })`);
  results[name] = { fps, ...draw }; log(name, JSON.stringify(results[name]));
}
const memory = await evaluate(`(() => { const s = __vista.world.scene; const e = s.getEngine();
  /* bytes por pixel: RGBA 8 bits = 4; BC7/ASTC 4x4/DXT5/ETC2 RGBA = 1; DXT1/ETC1/ETC2 RGB = 0,5; HDR float = 8-16 */ const bpp = (f) => ({ 36492: 1, 33779: 1, 37496: 1, 37808: 1, 33776: 0.5, 33777: 0.5, 36196: 0.5, 37492: 0.5 })[f] ?? 4; let tex = 0, compressed = 0; for (const t of e.getLoadedTexturesCache()) { const w = t.width || t.baseWidth || 0, h = t.height || t.baseHeight || 0; const b = w * h * bpp(t.format) * ((t.generateMipMaps || t.mipLevelCount > 1) ? 1.33 : 1) * (t.isCube ? 6 : 1); tex += b; if (bpp(t.format) < 4) compressed++; }
  let verts = 0, idx = 0; for (const m of s.meshes) { verts += m.getTotalVertices?.() ?? 0; idx += m.getTotalIndices?.() ?? 0; }
  const res = performance.getEntriesByType('resource'); const transfer = res.reduce((a, r) => a + (r.transferSize || 0), 0); const decoded = res.reduce((a, r) => a + (r.decodedBodySize || 0), 0);
  return { jsHeapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1), textureMB: +(tex / 1048576).toFixed(1), textures: e.getLoadedTexturesCache().length, compressedTextures: compressed, meshes: s.meshes.length, materials: s.materials.length, vertices: verts, triangles: Math.round(idx / 3), downloadMB: +(transfer / 1048576).toFixed(2), decodedMB: +(decoded / 1048576).toFixed(2) }; })()`);
const out = { label, date: new Date().toISOString(), readyMs: Math.round(ready), ...info, memory, views: results };
writeFileSync(`${dir}/metrics.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out));
ws.close(); chrome.kill(); process.exit(0);









