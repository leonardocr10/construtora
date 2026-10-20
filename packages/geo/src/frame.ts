/**
 * Referencial local da cena 3D (convenção única do VistaHub):
 * - unidade: metro;
 * - origem: latitude/longitude do empreendimento (Development.latitude/longitude);
 * - eixo x: leste; eixo z: sul; eixo y: para cima (Three.js, mão direita);
 * - norte geográfico = -z.
 *
 * A conversão usa o plano tangente local sobre o elipsoide WGS84 (raios de curvatura na latitude
 * de origem). Até ~2 km da origem o erro fica abaixo de 1 cm por metro, suficiente para a maquete.
 * Latitude/longitude nunca são tratadas como metros: tudo passa por estas funções.
 */

export interface LatLng { lat: number; lng: number }
/** Ponto no referencial local: x leste, z sul (metros). */
export interface Local { x: number; z: number }

const a = 6378137; // semieixo maior WGS84 (m)
const f = 1 / 298.257223563;
const e2 = f * (2 - f);
const rad = Math.PI / 180;

export class LocalFrame {
  /** Metros por grau de latitude e de longitude na origem. */
  readonly metersPerDegLat: number;
  readonly metersPerDegLng: number;

  constructor(readonly origin: LatLng) {
    if (!Number.isFinite(origin.lat) || !Number.isFinite(origin.lng) || Math.abs(origin.lat) > 85) throw new RangeError('Origem geográfica inválida');
    const s = Math.sin(origin.lat * rad);
    const w = Math.sqrt(1 - e2 * s * s);
    const meridional = (a * (1 - e2)) / (w * w * w); // raio de curvatura no meridiano
    const normal = a / w; // raio de curvatura no primeiro vertical
    this.metersPerDegLat = meridional * rad;
    this.metersPerDegLng = normal * Math.cos(origin.lat * rad) * rad;
  }

  toLocal({ lat, lng }: LatLng): Local {
    return { x: (lng - this.origin.lng) * this.metersPerDegLng, z: -(lat - this.origin.lat) * this.metersPerDegLat };
  }

  toGeo({ x, z }: Local): LatLng {
    return { lat: this.origin.lat - z / this.metersPerDegLat, lng: this.origin.lng + x / this.metersPerDegLng };
  }
}
