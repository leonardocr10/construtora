import type {Scene} from './babylon';

/** WebGL usa o caminho conservador por padrao. Seguro=1 tambem forca esse caminho no motor. */
export function compatibilityMode(webgpu: boolean, search = '') {
  const safe = new URLSearchParams(search).get('seguro');
  return safe === '1' || (!webgpu && safe !== '0');
}

/** Limita o buffer REAL, nao so o tamanho CSS. Monitores 4K/retina nao multiplicam os alvos de render. */
export function renderScaling(width: number, height: number, dpr: number, maxDpr: number, safe: boolean) {
  const budget = safe ? 1280 * 720 : 1920 * 1080;
  return Math.max(1 / Math.max(1, Math.min(dpr || 1, maxDpr)), Math.sqrt(Math.max(1, width * height) / budget));
}

/** O terreno pronto no CPU nao significa que os shaders ja produziram um quadro visivel. */
export function waitForVisibleFrame(scene: Scene, timeoutMs = 25_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let frames = 0;
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      scene.onAfterRenderObservable.remove(rendered);
      scene.getEngine().onContextLostObservable.remove(lost);
      scene.onDisposeObservable.remove(disposed);
      error ? reject(error) : resolve();
    };
    const rendered = scene.onAfterRenderObservable.add(() => {
      const meshes = scene.getActiveMeshes();
      const visible = meshes.data.slice(0, meshes.length).some(mesh => mesh && mesh.isEnabled() && mesh.isVisible
        && !/^(sky-|sun-)/.test(mesh.name) && mesh.getTotalVertices() > 0 && mesh.isReady(true));
      frames = visible ? frames + 1 : 0;
      if (frames >= 2) finish();
    });
    const lost = scene.getEngine().onContextLostObservable.add(() => finish(new Error('O navegador perdeu o contexto grafico.')));
    const disposed = scene.onDisposeObservable.add(() => finish(new Error('Cena encerrada antes do primeiro quadro.')));
    const timer = setTimeout(() => finish(new Error('O primeiro quadro 3D nao ficou pronto no tempo esperado.')), timeoutMs);
  });
}
