/**
 * Níveis de qualidade gráfica. O visitante escolhe no painel de vistas; sem escolha, o nível é
 * detectado pelo aparelho (celular e GPU fraca começam mais baixo) e lembrado neste navegador.
 */
export type QualityLevel = 'eco' | 'balanced' | 'high' | 'ultra';

export interface QualitySettings {
  label: string;
  /** Resolução do mapa de sombra de cada cascata e quantidade de cascatas. */
  shadowMapSize: number; cascades: number;
  /** Suavização das bordas da sombra (PCF): 0 baixa, 1 média, 2 alta. */
  shadowFiltering: 0 | 1 | 2;
  /** Oclusão de ambiente em tela (SSAO2): resolução relativa e amostras; null desliga. */
  ssao: { ratio: number; samples: number } | null;
  /** Antisserrilhado: amostras MSAA no alvo de pós-processamento e FXAA por cima. */
  msaa: number; fxaa: boolean;
  /** Limite da densidade de pixels (1 = resolução CSS; 2 = telas retina inteiras). */
  maxPixelRatio: number;
}

export const qualityLevels: Record<QualityLevel, QualitySettings> = {
  eco: { label: 'Econômico', shadowMapSize: 1024, cascades: 2, shadowFiltering: 0, ssao: null, msaa: 1, fxaa: true, maxPixelRatio: 1 },
  balanced: { label: 'Equilibrado', shadowMapSize: 2048, cascades: 3, shadowFiltering: 1, ssao: { ratio: 0.5, samples: 8 }, msaa: 2, fxaa: false, maxPixelRatio: 1.25 },
  high: { label: 'Alto', shadowMapSize: 2048, cascades: 4, shadowFiltering: 2, ssao: { ratio: 0.75, samples: 16 }, msaa: 4, fxaa: false, maxPixelRatio: 1.5 },
  ultra: { label: 'Ultra', shadowMapSize: 4096, cascades: 4, shadowFiltering: 2, ssao: { ratio: 1, samples: 32 }, msaa: 4, fxaa: true, maxPixelRatio: 2 },
};
export const qualityOrder: QualityLevel[] = ['eco', 'balanced', 'high', 'ultra'];

const storageKey = 'vistahub.quality';

/** Escolha salva pelo visitante (null quando nunca escolheu). */
export function savedQuality(): QualityLevel | null {
  try { const v = localStorage.getItem(storageKey); return v && v in qualityLevels ? (v as QualityLevel) : null; } catch { return null; }
}
export function saveQuality(level: QualityLevel) {
  try { localStorage.setItem(storageKey, level); } catch { /* sem armazenamento */ }
}

/** É celular ou tablet? userAgentData quando existe; senão, agente e tela sensível ao toque pequena. */
export function isMobile() {
  const data = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (data?.mobile != null) return data.mobile || /iPad|Tablet/i.test(navigator.userAgent);
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 820);
}

/**
 * Nível inicial sem escolha do visitante: GPU por software → econômico; celular → econômico ou
 * equilibrado (aparelhos com bastante memória e núcleos); computador → alto (equilibrado se modesto).
 */
export function detectQuality(gpu: string): QualityLevel {
  if (/swiftshader|llvmpipe|softpipe|basic render|software/.test(gpu)) return 'eco';
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  if (isMobile()) return cores >= 8 && memory >= 6 ? 'balanced' : 'eco';
  return cores <= 4 || memory <= 4 ? 'balanced' : 'high';
}
