import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Copa de árvore orgânica: vários blocos poliédricos com vértices deslocados, mais escura embaixo
 * (cores por vértice) e com leve variação, numa geometria só, reaproveitada por todas as árvores.
 */
export function crownGeometry() {
  let seed = 11; const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const blobs: [number, number, number, number][] = [[0, 0.1, 0, 0.78], [0.42, -0.08, 0.18, 0.55], [-0.38, -0.05, -0.2, 0.58], [0.1, 0.38, -0.32, 0.5], [-0.15, 0.32, 0.36, 0.48], [0.05, -0.3, 0, 0.6]];
  const parts = blobs.map(([x, y, z, r]) => {
    const g = new THREE.IcosahedronGeometry(r, 1);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) { const k = 1 + (random() - 0.5) * 0.22; pos.setXYZ(i, pos.getX(i) * k + x, pos.getY(i) * k * 0.9 + y, pos.getZ(i) * k + z); }
    return g;
  });
  const geometry = mergeGeometries(parts.map((g) => g.toNonIndexed()));
  const pos = geometry.attributes.position; const colors: number[] = [];
  for (let i = 0; i < pos.count; i++) { const t = THREE.MathUtils.clamp((pos.getY(i) + 0.9) / 1.6, 0, 1); const shade = 0.58 + t * 0.55 + (random() - 0.5) * 0.08; colors.push(shade, shade, shade); }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Tronco afunilado com dois galhos curtos. */
export function trunkGeometry() {
  const main = new THREE.CylinderGeometry(0.1, 0.2, 1, 7).translate(0, 0.5, 0);
  const branch = (angle: number, tilt: number) => new THREE.CylinderGeometry(0.04, 0.08, 0.45, 5).translate(0, 0.22, 0).rotateZ(tilt).rotateY(angle).translate(0, 0.72, 0);
  return mergeGeometries([main, branch(0.4, 0.7), branch(2.6, -0.6)].map((g) => g.toNonIndexed()));
}
