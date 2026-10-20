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

/** Folha de palmeira: faixa que sai do topo, arqueia e cai, afinando na ponta (x ao longo da folha). */
function frondGeometry(length: number, width: number) {
  const segments = 8; const positions: number[] = []; const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments; const x = t * length; const y = Math.sin(t * Math.PI * 0.9) * length * 0.28 - t * t * length * 0.45;
    const w = width * Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5) * (1 - t * 0.85);
    positions.push(x, y, -w, x, y - w * 0.25, 0, x, y, w);
    if (i) { const a = (i - 1) * 3, b = i * 3; indices.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Palmeiras instanciadas: estipe levemente curvo com anéis e coroa de folhas arqueadas. */
export function buildPalms(points: [number, number, number][]) {
  const group = new THREE.Group();
  const height = 1; // escala por instância
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.06, 0.5, 0), new THREE.Vector3(0.14, height, 0));
  const trunk = new THREE.TubeGeometry(curve, 10, 0.022, 6, false);
  const fronds = mergeGeometries(Array.from({ length: 9 }, (_, i) => {
    const g = frondGeometry(0.42, 0.06); g.rotateZ(0.15 + (i % 2) * 0.12); g.rotateY((i / 9) * Math.PI * 2 + (i % 3) * 0.1); g.translate(0.14, height, 0);
    return g;
  }));
  const trunks = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: 0x8a7458, roughness: 1 }), points.length);
  const crowns = new THREE.InstancedMesh(fronds, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide }), points.length);
  const dummy = new THREE.Object3D(); const color = new THREE.Color();
  points.forEach(([x, z, size], i) => {
    const h = 6 + size * 1.2 + Math.random() * 2;
    dummy.position.set(x, 0.33, z); dummy.rotation.set(0, Math.random() * Math.PI * 2, 0); dummy.scale.setScalar(h); dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix); crowns.setMatrixAt(i, dummy.matrix);
    crowns.setColorAt(i, color.setHSL(0.27 + Math.random() * 0.05, 0.42, 0.2 + Math.random() * 0.05, THREE.SRGBColorSpace));
  });
  trunks.castShadow = crowns.castShadow = true;
  group.add(trunks, crowns);
  return group;
}
