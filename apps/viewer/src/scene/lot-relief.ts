import * as THREE from 'three';
import type { Point } from '../types';

/** Altura da superfície do lote (asfalto) e do que fica acima dela (calçadas, gramados): o degrau é o meio-fio. */
export const lotBase = 0.18;
const curb = 0.17;

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

/**
 * Relevo do lote como malha com a arte por cima: asfalto na cota base e calçadas/gramados um degrau acima,
 * formando o meio-fio. Retorna a geometria já no referencial do terreno (metros).
 */
export function buildRelief(canvas: HTMLCanvasElement, lot: Point[], toSite: (p: Point) => Point) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const step = 4;
  const xs = lot.map((p) => p[0]); const ys = lot.map((p) => p[1]);
  const x0 = Math.floor(Math.min(...xs)); const y0 = Math.floor(Math.min(...ys));
  const nx = Math.ceil((Math.max(...xs) - x0) / step); const ny = Math.ceil((Math.max(...ys) - y0) / step);
  // Fração de asfalto numa janela 9×9 px: faixas finas pintadas não viram meio-fio.
  const raised = (px: number, py: number) => {
    let total = 0, asphalt = 0;
    for (let dy = -4; dy <= 4; dy += 2) for (let dx = -4; dx <= 4; dx += 2) {
      const x = Math.round(px + dx); const y = Math.round(py + dy);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      total++; if (asphaltAt(data, (y * width + x) * 4)) asphalt++;
    }
    return total > 0 && asphalt / total < 0.45;
  };
  const positions: number[] = []; const uvs: number[] = []; const indices: number[] = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const px = x0 + i * step; const py = y0 + j * step;
    const [x, z] = toSite([px, py]);
    positions.push(x, lotBase + (raised(px, py) ? curb : 0), z);
    uvs.push(px / width, 1 - py / height);
  }
  const at = (i: number, j: number) => j * (nx + 1) + i;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!insidePolygon([x0 + (i + 0.5) * step, y0 + (j + 0.5) * step], lot)) continue;
    indices.push(at(i, j), at(i, j + 1), at(i + 1, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Carros 3D instanciados: carroceria, cabine com vidros escuros e rodas, na cor detectada na arte. */
export function buildCars(cars: { x: number; z: number; angle: number; color: THREE.Color }[]) {
  const group = new THREE.Group();
  if (!cars.length) return group;
  const body = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.35 }), cars.length);
  const cabin = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, metalness: 0.2 }), cars.length);
  const wheels = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.32, 0.32, 0.22, 10).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.9 }), cars.length * 4);
  const dummy = new THREE.Object3D(); const glass = new THREE.Color(0x2a3540); const tint = new THREE.Color();
  const yaw = new THREE.Quaternion();
  cars.forEach((car, i) => {
    const L = 4.3; const W = 1.8;
    yaw.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -car.angle);
    dummy.quaternion.copy(yaw);
    dummy.position.set(car.x, lotBase + 0.62, car.z); dummy.scale.set(L, 0.66, W); dummy.updateMatrix(); body.setMatrixAt(i, dummy.matrix);
    tint.copy(car.color);
    body.setColorAt(i, tint);
    const back = new THREE.Vector3(-0.2, 0, 0).applyQuaternion(yaw);
    dummy.position.set(car.x + back.x, lotBase + 1.22, car.z + back.z); dummy.scale.set(L * 0.52, 0.55, W * 0.88); dummy.updateMatrix(); cabin.setMatrixAt(i, dummy.matrix);
    cabin.setColorAt(i, glass.clone().lerp(tint, 0.25));
    let k = 0;
    for (const fx of [-1.35, 1.35]) for (const fz of [-0.82, 0.82]) {
      const offset = new THREE.Vector3(fx, 0, fz).applyQuaternion(yaw);
      dummy.position.set(car.x + offset.x, lotBase + 0.32, car.z + offset.z); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
      wheels.setMatrixAt(i * 4 + k++, dummy.matrix);
    }
  });
  body.castShadow = cabin.castShadow = true; body.receiveShadow = true;
  group.add(body, cabin, wheels);
  return group;
}
