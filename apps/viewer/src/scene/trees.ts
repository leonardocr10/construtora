import { Color3, TransformNode, type Matrix, type Scene } from './babylon';
import { compose, computeNormals, cylinder, hsl, icosahedron, instanced, merge, nonIndexed, pbr, rotateY, rotateZ, shadows, translate, tube, type Geo } from './geometry';

/**
 * Copa de árvore orgânica: vários blocos poliédricos com vértices deslocados, mais escura embaixo
 * (cores por vértice) e com leve variação, numa geometria só, reaproveitada por todas as árvores.
 */
export function crownGeometry(detail = 1): Geo {
  let seed = 11; const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const blobs: [number, number, number, number][] = [[0, 0.1, 0, 0.78], [0.42, -0.08, 0.18, 0.55], [-0.38, -0.05, -0.2, 0.58], [0.1, 0.38, -0.32, 0.5], [-0.15, 0.32, 0.36, 0.48], [0.05, -0.3, 0, 0.6]];
  const parts = blobs.map(([x, y, z, r]) => {
    const g = icosahedron(r, detail); const p = g.positions;
    for (let i = 0; i < p.length; i += 3) { const k = 1 + (random() - 0.5) * 0.22; p[i] = p[i] * k + x; p[i + 1] = p[i + 1] * k * 0.9 + y; p[i + 2] = p[i + 2] * k + z; }
    g.normals = undefined;
    return g;
  });
  const geometry = nonIndexed(merge(parts.map((g) => computeNormals(g))));
  const colors: number[] = [];
  for (let i = 0; i < geometry.positions.length; i += 3) {
    const t = Math.min(1, Math.max(0, (geometry.positions[i + 1] + 0.9) / 1.6)); const shade = 0.58 + t * 0.55 + (random() - 0.5) * 0.08;
    colors.push(shade, shade, shade, 1);
  }
  geometry.colors = colors;
  geometry.normals = undefined;
  return computeNormals(geometry);
}

/** Tronco afunilado com dois galhos curtos. */
export function trunkGeometry(): Geo {
  const main = translate(cylinder(0.1, 0.2, 1, 7), 0, 0.5, 0);
  const branch = (angle: number, tilt: number) => translate(rotateY(rotateZ(translate(cylinder(0.04, 0.08, 0.45, 5), 0, 0.22, 0), tilt), angle), 0, 0.72, 0);
  return merge([main, branch(0.4, 0.7), branch(2.6, -0.6)]);
}

/** Folha de palmeira: faixa que sai do topo, arqueia e cai, afinando na ponta (x ao longo da folha). */
function frondGeometry(length: number, width: number): Geo {
  const segments = 8; const positions: number[] = []; const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments; const x = t * length; const y = Math.sin(t * Math.PI * 0.9) * length * 0.28 - t * t * length * 0.45;
    const w = width * Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5) * (1 - t * 0.85);
    positions.push(x, y, -w, x, y - w * 0.25, 0, x, y, w);
    if (i) { const a = (i - 1) * 3, b = i * 3; indices.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2); }
  }
  return computeNormals({ positions, indices, uvs: positions.map(() => 0).slice(0, (positions.length / 3) * 2) });
}

/** Árvores instanciadas: tronco com galhos e copa orgânica, com variação de cor, tamanho e giro. */
export function buildTrees(scene: Scene, parent: TransformNode, points: [number, number, number][]) {
  const group = new TransformNode('trees', scene); group.parent = parent;
  const trunks: Matrix[] = []; const crowns: Matrix[] = []; const colors: Color3[] = [];
  for (const [x, z, size] of points) {
    const trunk = size * 0.6; const spin = Math.random() * Math.PI * 2;
    trunks.push(compose(x, 0.33, z, 0, spin, 0, size * 0.5, trunk, size * 0.5));
    const s = size * (0.95 + Math.random() * 0.2);
    crowns.push(compose(x, 0.33 + trunk + s * 0.55, z, (Math.random() - 0.5) * 0.2, spin, (Math.random() - 0.5) * 0.2, s, s * (0.85 + Math.random() * 0.2), s));
    colors.push(hsl(0.24 + Math.random() * 0.08, 0.5 + Math.random() * 0.15, 0.3 + Math.random() * 0.08));
  }
  shadows(instanced('tree-trunks', trunkGeometry(), scene, pbr(scene, 'trunk', { color: 0x6a4d36, roughness: 1 }), trunks, group), true, false);
  shadows(instanced('tree-crowns', crownGeometry(), scene, pbr(scene, 'crown', { color: 0xffffff, roughness: 0.9 }), crowns, group, colors), true, true);
  return group;
}

/** Palmeiras instanciadas: estipe levemente curvo com anéis e coroa de folhas arqueadas. */
export function buildPalms(scene: Scene, parent: TransformNode, points: [number, number, number][]) {
  const group = new TransformNode('palms', scene); group.parent = parent;
  // Curva quadrática (0,0,0) → (0.06,0.5,0) → (0.14,1,0), em 10 trechos.
  const path = Array.from({ length: 11 }, (_, i) => { const t = i / 10; const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t; return [b * 0.06 + c * 0.14, b * 0.5 + c, 0] as [number, number, number]; });
  const trunk = tube(path, 0.022, 6);
  const fronds = merge(Array.from({ length: 9 }, (_, i) => translate(rotateY(rotateZ(frondGeometry(0.42, 0.06), 0.15 + (i % 2) * 0.12), (i / 9) * Math.PI * 2 + (i % 3) * 0.1), 0.14, 1, 0)));
  const matrices: Matrix[] = []; const colors: Color3[] = [];
  for (const [x, z, size] of points) {
    const h = 6 + size * 1.2 + Math.random() * 2;
    matrices.push(compose(x, 0.33, z, 0, Math.random() * Math.PI * 2, 0, h, h, h));
    colors.push(hsl(0.27 + Math.random() * 0.05, 0.42, 0.2 + Math.random() * 0.05));
  }
  shadows(instanced('palm-trunks', trunk, scene, pbr(scene, 'palm-trunk', { color: 0x8a7458, roughness: 1 }), matrices, group), true, false);
  shadows(instanced('palm-crowns', fronds, scene, pbr(scene, 'palm-crown', { color: 0xffffff, roughness: 0.85, doubleSided: true }), matrices, group, colors), true, false);
  return group;
}

