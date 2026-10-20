import { LocalFrame, type LatLng } from './frame.js';
import { applySimilarity, fitAffine, fitSimilarity, spread, type Pair, type Vec2 } from './fit.js';

/**
 * Calibração da implantação por pontos de controle: cada ponto liga um pixel da arte a uma
 * coordenada geográfica verificada (cruzamento, canto do muro, guia de calçada…).
 *
 * A implantação entra na cena pela convenção já usada no visualizador:
 *   local = R(azimute) · (pixel − origem) · metrosPorPixel,   R(θ) = [[cos θ, −sin θ], [sin θ, cos θ]]
 * no plano (x leste, z sul); "azimute" é o rumo, a partir do norte, para onde aponta o topo da imagem.
 * O ajuste devolve exatamente esses parâmetros, com os resíduos de cada ponto para o administrador
 * avaliar. Nada é inventado: sem pontos suficientes, o resultado é marcado como insuficiente.
 */

export interface ControlPoint { id: string; label?: string; pixel: Vec2; geo: LatLng }

export interface LayoutTransform {
  metersPerPixel: number;
  /** Rumo do topo da imagem, em graus a partir do norte (sentido horário). */
  azimuth: number;
  /** Pixel da arte que cai na origem do referencial (latitude/longitude do empreendimento). */
  origin: Vec2;
}

export type CalibrationStatus = 'insuficiente' | 'aproximada' | 'verificada';

export interface CalibrationReport {
  status: CalibrationStatus;
  transform: LayoutTransform | null;
  /** Resíduo de cada ponto (metros) após o ajuste por similaridade. */
  residuals: { id: string; label?: string; dx: number; dz: number; error: number }[];
  rms: number | null;
  maxError: number | null;
  /** Diagnóstico de distorção da arte (ajuste afim, com 4 ou mais pontos). */
  distortion: { anisotropy: number; shearDegrees: number; affineRms: number } | null;
  warnings: string[];
}

export interface CalibrationOptions {
  /** Resíduo médio aceitável (m). */
  tolerance?: number;
  /** Escala verificada por medida real (m/px), quando houver, para conferência. */
  expectedMetersPerPixel?: number;
}

const deg = 180 / Math.PI;

export function calibrate(points: ControlPoint[], origin: LatLng, options: CalibrationOptions = {}): CalibrationReport {
  const tolerance = options.tolerance ?? 1.5;
  const warnings: string[] = [];
  const empty: CalibrationReport = { status: 'insuficiente', transform: null, residuals: [], rms: null, maxError: null, distortion: null, warnings };
  if (points.length < 2) { warnings.push('Cadastre pelo menos 2 pontos de controle (recomendado: 4 ou mais, bem espalhados).'); return empty; }

  const frame = new LocalFrame(origin);
  const pairs: Pair[] = points.map((p) => { const l = frame.toLocal(p.geo); return { from: p.pixel, to: [l.x, l.z] }; });
  if (spread(points.map((p) => p.pixel)) < 0.12 && points.length >= 3) warnings.push('Os pontos estão quase alinhados: espalhe-os pelos cantos da implantação.');

  let fit;
  try { fit = fitSimilarity(pairs); } catch (error) { warnings.push(error instanceof Error ? error.message : 'Ajuste impossível'); return empty; }

  const residuals = points.map((p, i) => {
    const [x, z] = applySimilarity(fit, p.pixel); const [tx, tz] = pairs[i].to;
    return { id: p.id, label: p.label, dx: x - tx, dz: z - tz, error: Math.hypot(x - tx, z - tz) };
  });
  const rms = Math.sqrt(residuals.reduce((s, r) => s + r.error ** 2, 0) / residuals.length);
  const maxError = Math.max(...residuals.map((r) => r.error));

  // Origem: pixel cujo destino é (0, 0) → p = −R(−θ)·t / s.
  const c = Math.cos(-fit.rotation), s = Math.sin(-fit.rotation);
  const originPixel: Vec2 = [-(c * fit.tx - s * fit.ty) / fit.scale, -(s * fit.tx + c * fit.ty) / fit.scale];
  const transform: LayoutTransform = { metersPerPixel: fit.scale, azimuth: ((fit.rotation * deg) % 360 + 360) % 360, origin: originPixel };

  // Arte espelhada: o espelho explicaria os pontos muito melhor.
  if (points.length >= 3) {
    const mirrored = fitSimilarity(pairs.map(({ from, to }) => ({ from: [from[0], -from[1]], to })));
    const mirroredRms = Math.sqrt(pairs.reduce((sum, { from, to }) => { const [x, z] = applySimilarity(mirrored, [from[0], -from[1]]); return sum + (x - to[0]) ** 2 + (z - to[1]) ** 2; }, 0) / pairs.length);
    if (mirroredRms < rms * 0.5 && rms > tolerance) warnings.push('Os pontos indicam que a arte está espelhada: confira se a imagem não foi invertida.');
  }

  let distortion: CalibrationReport['distortion'] = null;
  if (points.length >= 4) {
    try {
      const affine = fitAffine(pairs);
      const sx = Math.hypot(affine.a, affine.c), sy = Math.hypot(affine.b, affine.d);
      const shear = Math.abs(90 - Math.acos(Math.max(-1, Math.min(1, (affine.a * affine.b + affine.c * affine.d) / (sx * sy)))) * deg);
      const affineRms = Math.sqrt(pairs.reduce((sum, { from, to }) => { const x = affine.a * from[0] + affine.b * from[1] + affine.tx, z = affine.c * from[0] + affine.d * from[1] + affine.ty; return sum + (x - to[0]) ** 2 + (z - to[1]) ** 2; }, 0) / pairs.length);
      distortion = { anisotropy: Math.abs(sx / sy - 1), shearDegrees: shear, affineRms };
      if (distortion.anisotropy > 0.03 || shear > 1.5) warnings.push(`A arte parece distorcida (escalas x/y diferem ${(distortion.anisotropy * 100).toFixed(1)}%, cisalhamento ${shear.toFixed(1)}°): ela pode não estar em escala.`);
    } catch { /* colineares: já avisado */ }
  }

  for (const r of residuals) if (r.error > Math.max(3, tolerance * 2)) warnings.push(`Ponto "${r.label ?? r.id}" com resíduo de ${r.error.toFixed(2)} m: confira o pixel e a coordenada.`);
  if (rms > tolerance) warnings.push(`Resíduo médio de ${rms.toFixed(2)} m, acima da tolerância de ${tolerance} m.`);
  if (options.expectedMetersPerPixel) {
    const diff = Math.abs(transform.metersPerPixel / options.expectedMetersPerPixel - 1);
    if (diff > 0.02) warnings.push(`Escala ajustada (${transform.metersPerPixel.toFixed(4)} m/px) difere ${(diff * 100).toFixed(1)}% da escala medida.`);
  }
  if (points.length === 2) warnings.push('Com 2 pontos o ajuste é exato por construção: não há como medir o erro. Adicione mais pontos.');

  const status: CalibrationStatus = points.length >= 4 && rms <= tolerance && !warnings.some((w) => /distorcida|espelhada|alinhados|resíduo de/.test(w)) ? 'verificada' : 'aproximada';
  return { status, transform, residuals, rms, maxError, distortion, warnings };
}

/** Pixel da arte → referencial local (metros), com a convenção do visualizador. */
export function pixelToLocal(t: LayoutTransform, [px, py]: Vec2): Vec2 {
  const x = (px - t.origin[0]) * t.metersPerPixel, y = (py - t.origin[1]) * t.metersPerPixel;
  const a = t.azimuth / deg;
  return [Math.cos(a) * x - Math.sin(a) * y, Math.sin(a) * x + Math.cos(a) * y];
}

/** Referencial local (metros) → pixel da arte. */
export function localToPixel(t: LayoutTransform, [x, z]: Vec2): Vec2 {
  const a = -t.azimuth / deg;
  const u = Math.cos(a) * x - Math.sin(a) * z, v = Math.sin(a) * x + Math.cos(a) * z;
  return [u / t.metersPerPixel + t.origin[0], v / t.metersPerPixel + t.origin[1]];
}
