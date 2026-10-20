import * as THREE from 'three';
import type { Point } from '../types';

/** Altura da superfície do lote (asfalto) e do que fica acima dela (calçadas, gramados): o degrau é o meio-fio. */
export const lotBase = 0.18;

/** Aproxima a cor desenhada para uma cor de carro real (branco, prata, grafite, preto, vermelho, azul). */
function carColor(rgb: [number, number, number] | null) {
  if (!rgb) return fleetColor(Math.random() * 1000);
  const [r, g, b] = rgb; const lum = 0.3 * r + 0.59 * g + 0.11 * b; const sat = (Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(1, Math.max(r, g, b));
  if (sat > 0.28) return new THREE.Color().setHSL(new THREE.Color(`rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`).getHSL({ h: 0, s: 0, l: 0 }).h, 0.62, 0.36, THREE.SRGBColorSpace);
  if (lum > 175) return new THREE.Color(0xf1f1ee);
  if (lum > 125) return new THREE.Color(0xb6b9bd);
  return fleetColor(r * 7 + g * 13 + b * 17);
}

/** Frota realista para carros que a arte desenha escuros (sombra): maioria branco/prata, como nas ruas. */
function fleetColor(seed: number) {
  const fleet: [number, number][] = [[0xf1f1ee, 0.3], [0xb6b9bd, 0.2], [0x1d1e22, 0.18], [0x55595f, 0.14], [0x9e2a2b, 0.09], [0x2b4a7a, 0.09]];
  let t = (Math.sin(seed * 12.9898) * 43758.5453) % 1; t = t < 0 ? t + 1 : t;
  for (const [hex, weight] of fleet) { if (t < weight) return new THREE.Color(hex); t -= weight; }
  return new THREE.Color(fleet[0][0]);
}

export interface DetectedCar { x: number; y: number; angle: number; color: THREE.Color }

function insidePolygon([x, y]: Point, polygon: Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]; const [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Asfalto da arte: cinza de baixa saturação e luminância média (as faixas pintadas ficam de fora). */
function asphaltAt(data: Uint8ClampedArray, k: number) {
  const r = data[k]; const g = data[k + 1]; const b = data[k + 2];
  const lum = 0.3 * r + 0.59 * g + 0.11 * b;
  return Math.max(r, g, b) - Math.min(r, g, b) < 22 && lum > 78 && lum < 140;
}

/**
 * Encontra os carros desenhados na implantação: manchas compactas e alongadas cercadas de asfalto.
 * Cada carro encontrado é apagado da arte (pintado com o asfalto ao redor) para virar um volume 3D.
 */
export function detectCars(canvas: HTMLCanvasElement, lot: Point[], metersPerPixel: number): DetectedCar[] {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const xs = lot.map((p) => p[0]); const ys = lot.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))); const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const w = Math.min(canvas.width, Math.ceil(Math.max(...xs))) - x0; const h = Math.min(canvas.height, Math.ceil(Math.max(...ys))) - y0;
  const image = ctx.getImageData(x0, y0, w, h); const data = image.data;
  const m2 = metersPerPixel * metersPerPixel;
  // 1 = não asfalto dentro do lote (candidato), 0 = asfalto ou fora do lote.
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!asphaltAt(data, (y * w + x) * 4) && insidePolygon([x + x0, y + y0], lot)) mask[y * w + x] = 1;
  }
  const seen = new Uint8Array(w * h); const cars: DetectedCar[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    stack.push(start); seen[start] = 1;
    let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, cr = 0, cg = 0, cb = 0, lit = 0, minX = w, maxX = 0, minY = h, maxY = 0;
    const pixels: number[] = [];
    while (stack.length) {
      const i = stack.pop()!; const x = i % w; const y = (i - x) / w;
      n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; pixels.push(i);
      // Pixels muito escuros são a sombra desenhada do carro: ficam fora da cor média.
      const pr = data[i * 4]; const pg = data[i * 4 + 1]; const pb = data[i * 4 + 2];
      if (0.3 * pr + 0.59 * pg + 0.11 * pb > 58) { cr += pr; cg += pg; cb += pb; lit++; }
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (n > 900) continue; // grande demais para ser carro: só termina de marcar
      for (const j of [i - 1, i + 1, i - w, i + w]) {
        if (j < 0 || j >= mask.length || seen[j] || !mask[j]) continue;
        if ((j === i - 1 && x === 0) || (j === i + 1 && x === w - 1)) continue;
        seen[j] = 1; stack.push(j);
      }
    }
    const area = n * m2;
    if (n > 900 || area < 1.2 || area > 9) continue;
    const mx = sx / n; const my = sy / n;
    const cxx = sxx / n - mx * mx; const cyy = syy / n - my * my; const cxy = sxy / n - mx * my;
    const angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    const root = Math.sqrt(((cxx - cyy) / 2) ** 2 + cxy * cxy);
    const long = Math.sqrt(12 * Math.max((cxx + cyy) / 2 + root, 0)) * metersPerPixel;
    const short = Math.sqrt(12 * Math.max((cxx + cyy) / 2 - root, 0)) * metersPerPixel;
    if (long < 1.8 || long > 5.8 || short < 0.8 || short > 2.8 || long / short < 1.25) continue;
    // Precisa estar cercado de asfalto (vagas e pistas), não colado em calçadas ou gramados.
    let ring = 0, asphalt = 0;
    for (let x = minX - 3; x <= maxX + 3; x++) for (const y of [minY - 3, maxY + 3]) { if (x < 0 || y < 0 || x >= w || y >= h) continue; ring++; if (asphaltAt(data, (y * w + x) * 4)) asphalt++; }
    for (let y = minY - 3; y <= maxY + 3; y++) for (const x of [minX - 3, maxX + 3]) { if (x < 0 || y < 0 || x >= w || y >= h) continue; ring++; if (asphaltAt(data, (y * w + x) * 4)) asphalt++; }
    if (!ring || asphalt / ring < 0.4) continue;
    cars.push({ x: mx + x0, y: my + y0, angle, color: lit > n * 0.25 ? carColor([cr / lit, cg / lit, cb / lit]) : fleetColor(mx * 31 + my * 17) });
    // Apaga o carro (e a sombra próxima) com a cor média do anel de asfalto.
    let ar = 0, ag = 0, ab = 0, an = 0;
    for (let x = minX - 3; x <= maxX + 3; x++) for (const y of [minY - 4, maxY + 4]) { if (x < 0 || y < 0 || x >= w || y >= h) continue; const k = (y * w + x) * 4; if (!asphaltAt(data, k)) continue; ar += data[k]; ag += data[k + 1]; ab += data[k + 2]; an++; }
    if (an) {
      ctx.fillStyle = `rgb(${Math.round(ar / an)},${Math.round(ag / an)},${Math.round(ab / an)})`;
      ctx.fillRect(minX + x0 - 2, minY + y0 - 2, maxX - minX + 5, maxY - minY + 5);
    }
  }
  return cars;
}

/** Perfil lateral (x ao longo do carro, y altura) extrudado na largura e centrado. */
function profile(points: [number, number][], width: number, bevel = 0.06) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  geometry.translate(0, 0, -(width - bevel * 2) / 2);
  return geometry;
}

/**
 * Carros 3D instanciados com perfil de hatch/sedã: carroceria na cor detectada na arte, vidros escuros,
 * teto na cor do carro, rodas com calota, faróis e lanternas. Comprimento 4,3 m e largura 1,8 m.
 */
export function buildCars(cars: { x: number; z: number; angle: number; color: THREE.Color }[]) {
  const group = new THREE.Group();
  if (!cars.length) return group;
  const W = 1.78;
  const lower = profile([[-2.15, 0.28], [2.12, 0.28], [2.18, 0.5], [2.08, 0.72], [1.2, 0.86], [-1.75, 0.92], [-2.12, 0.86], [-2.18, 0.5]], W);
  const glassShape = profile([[1.18, 0.84], [0.42, 1.36], [-1.05, 1.38], [-1.72, 0.9]], W * 0.9, 0.04);
  const roofShape = profile([[0.36, 1.37], [0.4, 1.42], [-1.02, 1.44], [-1.06, 1.38]], W * 0.86, 0.03);
  const wheel = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 14).rotateX(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.19, 0.19, 0.26, 10).rotateX(Math.PI / 2);
  const light = new THREE.BoxGeometry(0.06, 0.12, 0.38);
  const paint = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.45 });
  const parts = {
    body: new THREE.InstancedMesh(lower, paint, cars.length),
    roof: new THREE.InstancedMesh(roofShape, paint, cars.length),
    glass: new THREE.InstancedMesh(glassShape, new THREE.MeshStandardMaterial({ color: 0x1c252e, roughness: 0.08, metalness: 0.6 }), cars.length),
    wheels: new THREE.InstancedMesh(wheel, new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.85 }), cars.length * 4),
    hubs: new THREE.InstancedMesh(hub, new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.35, metalness: 0.7 }), cars.length * 4),
    head: new THREE.InstancedMesh(light, new THREE.MeshStandardMaterial({ color: 0xf4f1e4, emissive: 0x3a382e, roughness: 0.2 }), cars.length * 2),
    tail: new THREE.InstancedMesh(light, new THREE.MeshStandardMaterial({ color: 0xa3141b, emissive: 0x2a0204, roughness: 0.3 }), cars.length * 2),
  };
  const car = new THREE.Object3D(); const part = new THREE.Object3D(); const matrix = new THREE.Matrix4();
  const place = (mesh: THREE.InstancedMesh, index: number, x: number, y: number, z: number) => {
    part.position.set(x, y, z); part.updateMatrix(); matrix.multiplyMatrices(car.matrix, part.matrix); mesh.setMatrixAt(index, matrix);
  };
  cars.forEach((c, i) => {
    car.position.set(c.x, lotBase, c.z); car.rotation.set(0, -c.angle, 0); car.updateMatrix();
    place(parts.body, i, 0, 0, 0); place(parts.roof, i, 0, 0, 0); place(parts.glass, i, 0, 0, 0);
    parts.body.setColorAt(i, c.color); parts.roof.setColorAt(i, c.color);
    let k = 0;
    for (const fx of [-1.38, 1.38]) for (const fz of [-0.8, 0.8]) { place(parts.wheels, i * 4 + k, fx, 0.33, fz); place(parts.hubs, i * 4 + k, fx, 0.33, fz); k++; }
    place(parts.head, i * 2, 2.15, 0.6, -0.58); place(parts.head, i * 2 + 1, 2.15, 0.6, 0.58);
    place(parts.tail, i * 2, -2.16, 0.68, -0.6); place(parts.tail, i * 2 + 1, -2.16, 0.68, 0.6);
  });
  for (const mesh of Object.values(parts)) { mesh.castShadow = true; mesh.instanceMatrix.needsUpdate = true; group.add(mesh); }
  parts.body.receiveShadow = true;
  return group;
}
