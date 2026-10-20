import * as THREE from 'three';
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
        const texture = new THREE.CanvasTexture(eraseMarkers(image, markers, layout.markerRadius ?? Math.round(layout.imageWidth * 0.0145)));
        texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
        material.map = texture; material.needsUpdate = true;
      });
    }
    const lotMesh = new THREE.Mesh(geometry, material);
    lotMesh.receiveShadow = true;
    group.add(lotMesh);
    // Meio-fio em volta do lote.
    const edge = new THREE.Mesh(new THREE.ExtrudeGeometry(new THREE.Shape(lot.map(([x, z]) => new THREE.Vector2(x, -z))), { depth: 0.16, bevelEnabled: false }).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xd9d6cc }));
    edge.receiveShadow = true;
    group.add(edge);
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
