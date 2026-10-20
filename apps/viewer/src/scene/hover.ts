import type { AbstractMesh } from './babylon';
import type { TowerObject } from './tower';
import type { World } from './world';

/**
 * Realce ao passar o mouse: a torre sob o cursor fica alaranjada e uma etiqueta acompanha o mouse
 * ("Torre 1 · Clique para ver os detalhes"). Não atua durante o arraste da câmera nem na torre já aberta.
 */
export function bindTowerHover(world: World, towers: TowerObject[], selected: () => TowerObject | null) {
  const canvas = world.canvas;
  const tip = document.createElement('div');
  tip.style.cssText = 'position:fixed;z-index:20;pointer-events:none;background:rgba(32,24,38,.92);color:#fff;padding:9px 13px;border-radius:9px;font:600 13px/1.3 inherit;box-shadow:0 6px 20px rgba(0,0,0,.25);display:none;white-space:nowrap';
  document.body.appendChild(tip);
  const hits = new Map<AbstractMesh, TowerObject>(towers.map((t) => [t.pickables[0], t] as const));
  let hovered: TowerObject | null = null; let frame = 0; let last: PointerEvent | null = null;

  const set = (tower: TowerObject | null) => {
    if (tower === hovered) return;
    hovered?.setHover(false); hovered = tower; hovered?.setHover(true);
    canvas.style.cursor = tower ? 'pointer' : '';
    tip.style.display = tower ? 'block' : 'none';
    if (tower) tip.innerHTML = `${tower.building.name.replace(/[<>&]/g, '')}<br><span style="font-weight:400;opacity:.75;font-size:12px">Clique para ver os detalhes</span>`;
  };
  const update = () => {
    frame = 0; const e = last; if (!e) return;
    if (e.buttons) { set(null); return; }
    const hit = world.pick(e, (mesh) => hits.has(mesh));
    const tower = hit?.hit && hit.pickedMesh ? hits.get(hit.pickedMesh) ?? null : null;
    set(tower && tower !== selected() ? tower : null);
    tip.style.left = `${e.clientX + 16}px`; tip.style.top = `${e.clientY + 14}px`;
  };
  canvas.addEventListener('pointermove', (e) => { last = e; if (!frame) frame = requestAnimationFrame(update); });
  canvas.addEventListener('pointerleave', () => { last = null; set(null); });
  canvas.addEventListener('pointerdown', () => set(null));
  /** Limpa o realce (ex.: torre escolhida pela barra, sem passar o mouse). */
  return { clear: () => set(null) };
}
