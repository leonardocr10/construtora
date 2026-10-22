import {Vector3, type Mesh, type Scene, type TransformNode} from './babylon';
import {box, merge, meshFrom, pbr, translate, type Geo} from './geometry';

/** Peitoris derivados dos vaos reais do GLB, nao de uma segunda grade de janelas. */
export function windowOpenings(mesh: Mesh, parent: TransformNode) {
  const positions = mesh.getVerticesData('position'), indices = mesh.getIndices();
  if (!positions || !indices) return [];
  const transform = mesh.computeWorldMatrix(true).multiply(parent.computeWorldMatrix(true).clone().invert());
  const points = Array.from({length: positions.length / 3}, (_, i) => Vector3.TransformCoordinates(Vector3.FromArray(positions, i * 3), transform));
  const ids = points.map((_, i) => i);
  const find = (i: number): number => ids[i] === i ? i : (ids[i] = find(ids[i]));
  const join = (a: number, b: number) => { ids[find(a)] = find(b); };
  const coincident = new Map<string, number>();
  points.forEach((p, i) => {
    const key = [p.x, p.y, p.z].map(v => Math.round(v * 10000)).join(',');
    const previous = coincident.get(key);
    if (previous != null) join(i, previous); else coincident.set(key, i);
  });
  for (let i = 0; i < indices.length; i += 3) { join(indices[i], indices[i + 1]); join(indices[i], indices[i + 2]); }
  const parts = new Map<number, Vector3[]>();
  points.forEach((p, i) => { const key = find(i); if (!parts.has(key)) parts.set(key, []); parts.get(key)!.push(p); });
  const result: {center: Vector3; width: number; alongX: boolean; normal: Vector3}[] = [];
  for (const [id, part] of parts) {
    const min = part.reduce((a, p) => Vector3.Minimize(a, p), part[0].clone());
    const max = part.reduce((a, p) => Vector3.Maximize(a, p), part[0].clone());
    const size = max.subtract(min), alongX = size.x > size.z, width = Math.max(size.x, size.z);
    // Portas de varanda e vidros nao planares nao recebem peitoril atravessando a passagem.
    if (size.y < .3 || size.y > 1.65 || width < .3 || width > 3.2 || Math.min(size.x, size.z) > .025) continue;
    let normal: Vector3 | null = null;
    for (let i = 0; i < indices.length; i += 3) if (find(indices[i]) === id) {
      normal = Vector3.Cross(points[indices[i + 1]].subtract(points[indices[i]]), points[indices[i + 2]].subtract(points[indices[i]])).normalize();
      break;
    }
    if (!normal || Math.abs(normal.y) > .02) continue;
    result.push({center: new Vector3((min.x + max.x) / 2, min.y - .08, (min.z + max.z) / 2), width, alongX, normal});
  }
  return result;
}

/** Duas malhas por torre, com LOD; acompanham o recorte comercial junto ao restante do corpo. */
export function buildFacadeDetails(scene: Scene, visual: Mesh[], parent: TransformNode, lodScale: number) {
  const stone: Geo[] = [], drip: Geo[] = [];
  const seen = new Set<string>();
  for (const mesh of visual) {
    if (!/^VH_Glass/.test(mesh.material?.name ?? '')) continue;
    for (const pane of windowOpenings(mesh, parent)) {
      const {center: c, width: w, alongX, normal: n} = pane;
      const key = [c.x, c.y, c.z].map(v => v.toFixed(3)).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      // Capa clara avanca 14 cm do vidro; borda e sulco inferior dao leitura de espessura.
      stone.push(translate(box(alongX ? w + .18 : .26, .055, alongX ? .26 : w + .18), c.x + n.x * .12, c.y, c.z + n.z * .12));
      drip.push(translate(box(alongX ? w + .1 : .012, .009, alongX ? .012 : w + .1), c.x + n.x * .23, c.y - .031, c.z + n.z * .23));
    }
  }
  if (!stone.length) return [];
  const meshes = [
    meshFrom('pilot-window-sills', merge(stone), scene, pbr(scene, 'VH_PilotSill', {color: '#c9cdc5', roughness: .78}), parent),
    meshFrom('pilot-window-drips', merge(drip), scene, pbr(scene, 'VH_PilotDrip', {color: '#717974', roughness: .9}), parent),
  ];
  for (const mesh of meshes) {
    mesh.isPickable = false;
    mesh.metadata = {...mesh.metadata, facadeDetail: true, openings: stone.length};
    mesh.addLODLevel(140 * lodScale, null);
  }
  return meshes;
}
