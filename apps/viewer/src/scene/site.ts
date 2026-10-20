import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Development, Point, SiteLayout } from '../types';
import { buildTower, type TowerObject } from './tower';

/** Converte pixels da implantação para metros no referencial do terreno (antes da rotação do azimute). */
export function pixelToSite(layout: SiteLayout, [px, py]: Point): Point {
  return [(px - layout.origin[0]) * layout.metersPerPixel, (py - layout.origin[1]) * layout.metersPerPixel];
}

/**
 * Cobre cada círculo de marcador da arte com a cor média do anel ao redor (um "remendo" discreto),
 * tirando o número impresso no chão sem afetar o restante da implantação.
 */
function eraseMarkers(image: HTMLImageElement, markers: Point[], radius: number) {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  const scale = canvas.width / image.naturalWidth;
  for (const [mx, my] of markers) {
    const x = mx * scale; const y = my * scale; const r = radius * scale;
    const outer = Math.ceil(r * 1.55);
    const box = ctx.getImageData(Math.max(0, x - outer), Math.max(0, y - outer), outer * 2, outer * 2);
    let red = 0, green = 0, blue = 0, n = 0;
    for (let j = 0; j < box.height; j++) for (let i = 0; i < box.width; i++) {
      const d = Math.hypot(i - outer, j - outer);
      if (d < r * 1.2 || d > r * 1.55) continue;
      const k = (j * box.width + i) * 4; red += box.data[k]; green += box.data[k + 1]; blue += box.data[k + 2]; n++;
    }
    if (!n) continue;
    const gradient = ctx.createRadialGradient(x, y, r * 0.9, x, y, r * 1.35);
    const fill = `rgb(${Math.round(red / n)},${Math.round(green / n)},${Math.round(blue / n)})`;
    gradient.addColorStop(0, fill); gradient.addColorStop(1, `rgba(${Math.round(red / n)},${Math.round(green / n)},${Math.round(blue / n)},0)`);
    ctx.fillStyle = gradient;
    ctx.beginPath(); ctx.arc(x, y, r * 1.35, 0, Math.PI * 2); ctx.fill();
  }
  return canvas;
}

function insidePolygon([x, y]: Point, polygon: Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]; const [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Encontra as copas de árvores desenhadas na arte (manchas verde-escuras) para erguê-las em 3D.
 * Retorna [x px, y px, tamanho em metros], com espaçamento mínimo entre árvores.
 */
function detectTrees(canvas: HTMLCanvasElement, lot: Point[], footprints: { x: number; y: number; r: number }[], metersPerPixel: number) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const isCanopy = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const k = (Math.round(y) * width + Math.round(x)) * 4;
    const r = data[k]; const g = data[k + 1]; const b = data[k + 2];
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    return g > r * 1.07 && g > b * 1.2 && lum < 150 && lum > 25;
  };
  const step = Math.max(4, Math.round(1.2 / metersPerPixel));
  const minGap = Math.round(3.4 / metersPerPixel);
  const found: [number, number, number][] = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (!insidePolygon([x, y], lot) || footprints.some((f) => Math.hypot(f.x - x, f.y - y) < f.r)) continue;
      let hits = 0; const rad = Math.max(3, Math.round(1.4 / metersPerPixel));
      for (const [dx, dy] of [[0, 0], [rad, 0], [-rad, 0], [0, rad], [0, -rad], [rad, rad], [-rad, -rad], [rad, -rad], [-rad, rad]]) if (isCanopy(x + dx, y + dy)) hits++;
      if (hits < 6 || found.some(([fx, fy]) => Math.hypot(fx - x, fy - y) < minGap)) continue;
      found.push([x, y, 2.4 + (hits - 6) * 0.45 + Math.random() * 1.2]);
      if (found.length > 400) return found;
    }
  }
  return found;
}

/** Árvores instanciadas: tronco e copa em dois volumes, com leve variação de cor e tamanho. */
function buildTrees(points: [number, number, number][]) {
  const group = new THREE.Group();
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.2, 1, 6).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x6b4f3a, roughness: 1 }), points.length);
  const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), points.length * 2);
  const dummy = new THREE.Object3D(); const color = new THREE.Color();
  points.forEach(([x, z, size], i) => {
    const trunk = size * 0.55;
    dummy.position.set(x, 0.2, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, trunk, 1); dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
    for (let j = 0; j < 2; j++) {
      const s = size * (j ? 0.62 : 0.85);
      dummy.position.set(x + (j ? size * 0.25 : 0), trunk + s * (j ? 1.15 : 0.75), z + (j ? -size * 0.18 : 0)); dummy.rotation.set(Math.random(), Math.random(), 0); dummy.scale.set(s, s * 0.92, s); dummy.updateMatrix();
      crowns.setMatrixAt(i * 2 + j, dummy.matrix);
      crowns.setColorAt(i * 2 + j, color.setHSL(0.26 + Math.random() * 0.07, 0.45, 0.26 + Math.random() * 0.1, THREE.SRGBColorSpace));
    }
  });
  trunks.castShadow = crowns.castShadow = true; crowns.receiveShadow = true;
  group.add(trunks, crowns);
  return group;
}

/** Muro baixo no contorno do lote, como nas maquetes de vendas. */
function buildWall(lot: Point[]) {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < lot.length; i++) {
    const [ax, az] = lot[i]; const [bx, bz] = lot[(i + 1) % lot.length];
    const length = Math.hypot(bx - ax, bz - az); if (length < 0.5) continue;
    const segment = new THREE.BoxGeometry(length, 1.6, 0.22);
    segment.rotateY(-Math.atan2(bz - az, bx - ax));
    segment.translate((ax + bx) / 2, 0.8, (az + bz) / 2);
    parts.push(segment);
  }
  const wall = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ color: 0xe9e7e1, roughness: 0.9 }));
  wall.castShadow = wall.receiveShadow = true;
  return wall;
}

export interface SiteResult {
  group: THREE.Group; towers: TowerObject[]; lotWorld: Point[];
  amenityAnchors: Map<string, THREE.Vector3>; roadAnchors: { name: string; position: THREE.Vector3 }[];
}

/**
 * Terreno do empreendimento: o lote recebe a própria arte da implantação como textura e as torres
 * paramétricas são erguidas sobre ela. O grupo é girado pelo azimute para casar com o mapa real.
 */
export function buildSite(development: Development, siteImageUrl: string | null): SiteResult {
  const layout = development.viewer.layout;
  const group = new THREE.Group();
  group.rotation.y = -THREE.MathUtils.degToRad(layout?.azimuth ?? 0);

  let lotWorld: Point[] = [];
  if (layout?.lot?.length) {
    const lot = layout.lot.map((p) => pixelToSite(layout, p));
    const contour = lot.map(([x, z]) => new THREE.Vector2(x, z));
    const clockwise = THREE.ShapeUtils.isClockWise(contour);
    const triangles = THREE.ShapeUtils.triangulateShape(clockwise ? [...contour].reverse() : contour, []);
    const ordered = clockwise ? [...layout.lot].reverse() : layout.lot;
    const orderedSite = clockwise ? [...lot].reverse() : lot;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(orderedSite.flatMap(([x, z]) => [x, 0.18, z]), 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(ordered.flatMap(([px, py]) => [px / layout.imageWidth, 1 - py / layout.imageHeight]), 2));
    geometry.setIndex(triangles.flat().reverse());
    geometry.computeVertexNormals();
    const material = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    if (siteImageUrl) {
      // Os marcadores numerados já existem em 3D: apaga os círculos pintados na arte para não duplicar.
      const markers = development.amenities.filter((a) => a.position).map((a) => [a.position!.x / layout.metersPerPixel + layout.origin[0], a.position!.z / layout.metersPerPixel + layout.origin[1]] as Point);
      new THREE.ImageLoader().load(siteImageUrl, (image) => {
        const canvas = eraseMarkers(image, markers, layout.markerRadius ?? Math.round(layout.imageWidth * 0.0145));
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
        material.map = texture; material.needsUpdate = true;
        const footprints = development.buildings.filter((b) => b.position).map((b) => ({ x: b.position!.x / layout.metersPerPixel + layout.origin[0], y: b.position!.z / layout.metersPerPixel + layout.origin[1], r: Math.hypot(b.model3d?.width ?? 30, b.model3d?.depth ?? 16) / 2 / layout.metersPerPixel + 4 }));
        const trees = detectTrees(canvas, layout.lot!, footprints, layout.metersPerPixel);
        if (trees.length) group.add(buildTrees(trees.map(([px, py, size]) => { const [x, z] = pixelToSite(layout, [px, py]); return [x, z, size] as [number, number, number]; })));
      });
    }
    const lotMesh = new THREE.Mesh(geometry, material);
    lotMesh.receiveShadow = true;
    group.add(lotMesh);
    // Meio-fio em volta do lote.
    const edge = new THREE.Mesh(new THREE.ExtrudeGeometry(new THREE.Shape(lot.map(([x, z]) => new THREE.Vector2(x, -z))), { depth: 0.16, bevelEnabled: false }).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xd9d6cc }));
    edge.receiveShadow = true;
    group.add(edge);
    group.add(buildWall(lot));
  }

  const towers = development.buildings.map((building) => buildTower(building));
  for (const tower of towers) group.add(tower.group);
  group.updateMatrixWorld(true);
  // Recalcula as âncoras já com a rotação do terreno aplicada.
  for (const tower of towers) {
    tower.center.set(0, tower.height / 2, 0).applyMatrix4(tower.group.matrixWorld);
    tower.top.set(0, tower.height + 6, 0).applyMatrix4(tower.group.matrixWorld);
  }

  const toWorld = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(group.matrixWorld);
  if (layout?.lot?.length) lotWorld = layout.lot.map((p) => { const [x, z] = pixelToSite(layout, p); const v = toWorld(x, 0, z); return [v.x, v.z] as Point; });
  const amenityAnchors = new Map<string, THREE.Vector3>();
  for (const amenity of development.amenities) if (amenity.position) amenityAnchors.set(amenity.id, toWorld(amenity.position.x, 3, amenity.position.z));
  const roadAnchors = (layout?.roads ?? []).map((road) => {
    const mid = road.points.length === 2
      ? [(road.points[0][0] + road.points[1][0]) / 2, (road.points[0][1] + road.points[1][1]) / 2] as Point
      : road.points[Math.floor(road.points.length / 2)];
    const [x, z] = pixelToSite(layout!, mid);
    return { name: road.name, position: toWorld(x, 1.5, z) };
  });
  return { group, towers, lotWorld, amenityAnchors, roadAnchors };
}
