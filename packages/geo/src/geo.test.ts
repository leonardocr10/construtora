import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calibrate, LocalFrame, localToPixel, pixelToLocal, type ControlPoint, type LayoutTransform } from './index.js';

// Origem de teste próxima a Uberlândia–MG (valor arbitrário para os testes, não é dado do empreendimento).
const origin = { lat: -18.95, lng: -48.25 };
const frame = new LocalFrame(origin);

test('referencial local: norte é -z, leste é +x e a ida e volta preserva a coordenada', () => {
  const north = frame.toLocal({ lat: origin.lat + 0.001, lng: origin.lng });
  const east = frame.toLocal({ lat: origin.lat, lng: origin.lng + 0.001 });
  assert.ok(north.z < 0 && Math.abs(north.x) < 1e-9);
  assert.ok(east.x > 0 && Math.abs(east.z) < 1e-9);
  // ~110,7 m por milésimo de grau de latitude e ~105,3 m de longitude nessa latitude.
  assert.ok(Math.abs(-north.z - 110.7) < 0.3, `${-north.z}`);
  assert.ok(Math.abs(east.x - 105.3) < 0.3, `${east.x}`);
  const back = frame.toGeo(frame.toLocal({ lat: -18.9512, lng: -48.2489 }));
  assert.ok(Math.abs(back.lat + 18.9512) < 1e-12 && Math.abs(back.lng + 48.2489) < 1e-12);
});

test('pixel ↔ local segue a convenção do visualizador (azimute = rumo do topo da imagem)', () => {
  const t: LayoutTransform = { metersPerPixel: 0.2, azimuth: 90, origin: [100, 100] };
  // Topo da imagem (−y) aponta para leste (+x) quando o azimute é 90°.
  const [x, z] = pixelToLocal(t, [100, 50]);
  assert.ok(Math.abs(x - 10) < 1e-9 && Math.abs(z) < 1e-9);
  const [px, py] = localToPixel(t, pixelToLocal(t, [321, 77]));
  assert.ok(Math.abs(px - 321) < 1e-9 && Math.abs(py - 77) < 1e-9);
});

/** Gera pontos de controle a partir de uma transformação conhecida, com ruído opcional (m). */
function synthetic(t: LayoutTransform, pixels: [number, number][], noise = 0): ControlPoint[] {
  let seed = 3; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  return pixels.map((pixel, i) => {
    const [x, z] = pixelToLocal(t, pixel);
    return { id: `p${i}`, pixel, geo: frame.toGeo({ x: x + rand() * noise * 2, z: z + rand() * noise * 2 }) };
  });
}

const known: LayoutTransform = { metersPerPixel: 0.16, azimuth: 202.5, origin: [600, 640] };
const corners: [number, number][] = [[150, 160], [1100, 470], [1080, 840], [120, 1090], [600, 640]];

test('recupera escala, azimute e origem a partir de pontos exatos', () => {
  const report = calibrate(synthetic(known, corners), origin);
  assert.equal(report.status, 'verificada');
  assert.ok(Math.abs(report.transform!.metersPerPixel - 0.16) < 1e-6);
  assert.ok(Math.abs(report.transform!.azimuth - 202.5) < 1e-6);
  assert.ok(Math.abs(report.transform!.origin[0] - 600) < 1e-3 && Math.abs(report.transform!.origin[1] - 640) < 1e-3);
  assert.ok(report.rms! < 1e-6);
});

test('com ruído de 0,5 m o ajuste continua dentro da tolerância e informa os resíduos', () => {
  const report = calibrate(synthetic(known, corners, 0.5), origin);
  assert.equal(report.residuals.length, corners.length);
  assert.ok(report.rms! > 0 && report.rms! < 1);
  assert.ok(Math.abs(report.transform!.azimuth - 202.5) < 0.5);
});

test('dois pontos: ajuste possível, mas sem verificação de erro', () => {
  const report = calibrate(synthetic(known, corners.slice(0, 2)), origin);
  assert.equal(report.status, 'aproximada');
  assert.ok(report.warnings.some((w) => /2 pontos/.test(w)));
});

test('um ponto: insuficiente, sem transformação inventada', () => {
  const report = calibrate(synthetic(known, corners.slice(0, 1)), origin);
  assert.equal(report.status, 'insuficiente');
  assert.equal(report.transform, null);
});

test('ponto errado aparece como resíduo alto e impede a verificação', () => {
  const points = synthetic(known, corners);
  points[2] = { ...points[2], geo: { lat: points[2].geo.lat + 0.0001, lng: points[2].geo.lng } }; // ~11 m de erro
  const report = calibrate(points, origin);
  assert.notEqual(report.status, 'verificada');
  assert.ok(report.warnings.some((w) => /resíduo/.test(w)));
});

test('arte esticada em um eixo é apontada como distorcida', () => {
  const points = synthetic(known, corners).map((p) => ({ ...p, pixel: [p.pixel[0] * 1.1, p.pixel[1]] as [number, number] }));
  const report = calibrate(points, origin);
  assert.ok(report.distortion && report.distortion.anisotropy > 0.05);
  assert.ok(report.warnings.some((w) => /distorcida/.test(w)));
});

test('pontos alinhados geram aviso', () => {
  const report = calibrate(synthetic(known, [[100, 100], [300, 101], [500, 102], [700, 103]]), origin);
  assert.ok(report.warnings.some((w) => /alinhados/.test(w)));
});
