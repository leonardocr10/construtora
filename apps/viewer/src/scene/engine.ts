import { Engine, WebGPUEngine, type AbstractEngine } from './babylon';

export interface EngineResult { engine: AbstractEngine; canvas: HTMLCanvasElement; webgpu: boolean }

/**
 * Motor de renderização: WebGPU quando o navegador oferece (Chrome/Edge recentes, Safari 26+) e WebGL2
 * nos demais. `?motor=webgl` na URL força o WebGL2 (útil para comparar ou contornar drivers ruins).
 * O canvas é criado aqui porque um canvas que tentou WebGPU não aceita mais um contexto WebGL.
 */
export async function createEngine(host: HTMLElement): Promise<EngineResult> {
  const forced = new URLSearchParams(location.search).get('motor');
  const make = () => { const canvas = document.createElement('canvas'); canvas.style.width = '100%'; canvas.style.height = '100%'; host.appendChild(canvas); return canvas; };
  if (forced !== 'webgl' && (await WebGPUEngine.IsSupportedAsync)) {
    const canvas = make();
    try {
      // enableAllFeatures: pede ao dispositivo tudo o que o adaptador oferece, inclusive a compressão de textura
      // (BC no desktop, ASTC/ETC2 no celular) que o KTX2 usa; sem isso a textura é descompactada para RGBA.
      const engine = new WebGPUEngine(canvas, { antialias: false, powerPreference: 'high-performance', adaptToDeviceRatio: false, enableAllFeatures: true });
      await engine.initAsync();
      return { engine, canvas, webgpu: true };
    } catch (error) {
      console.warn('WebGPU indisponível, usando WebGL2', error);
      canvas.remove();
    }
  }
  const canvas = make();
  const engine = new Engine(canvas, false, { powerPreference: 'high-performance', stencil: true, premultipliedAlpha: false }, false);
  return { engine, canvas, webgpu: false };
}

/** Nome do adaptador/renderizador de vídeo (para reconhecer GPUs por software e baixar a qualidade). */
export function gpuName(engine: AbstractEngine) {
  try {
    const info = (engine as AbstractEngine & { getGlInfo(): { vendor: string; renderer: string } }).getGlInfo();
    return `${info.vendor} ${info.renderer}`.toLowerCase();
  } catch { return ''; }
}
