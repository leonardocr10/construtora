import { Color3, DynamicTexture, Mesh, PBRMaterial, Vector3, VertexData, type Scene } from './babylon';

/** Cores do céu num instante (lineares): zênite, horizonte (igual à névoa, para o chão sumir nele) e sol. */
export interface SkyColors { top: Color3; horizon: Color3; sun: Color3 }

const radius = 9000;
/** Distância do disco do sol (dentro da cúpula) e tamanho angular do disco (maior que o real, 0,53°, para aparecer). */
const sunDistance = 8000;
const sunAngle = (2.2 * Math.PI) / 180;
/** Calota em volta do sol, entre a cúpula e o disco: malha densa só ali, para o halo sair liso e pequeno. */
const capDistance = 8500;
const capAngle = (14 * Math.PI) / 180;
const capRings = 48, capSegments = 96;

/** Degradê do céu numa direção (y = seno da altura): névoa clara numa faixa fina e azul logo acima do horizonte. */
function gradient(y: number, top: Color3, horizon: Color3, out: number[]) {
  const t = Math.pow(Math.max(y, 0), 0.25);
  out[0] = horizon.r + (top.r - horizon.r) * t; out[1] = horizon.g + (top.g - horizon.g) * t; out[2] = horizon.b + (top.b - horizon.b) * t;
}

/**
 * Céu desenhado em código: cúpula com degradê do horizonte ao zênite (e faixa quente no horizonte do lado do sol
 * quando ele está baixo), calota densa com o halo do sol e o disco do sol. Tudo opaco: a mistura transparente some
 * com o pré-passe do SSAO. Acompanha a câmera e segue a direção da luz do sol,
 * então no pôr do sol o disco desce para o oeste junto com as sombras.
 */
export class Sky {
  private readonly dome: Mesh;
  private readonly sunDisc: Mesh;
  private readonly sunMaterial: PBRMaterial;
  private readonly dirs: Float32Array;
  private readonly colors: Float32Array;
  private readonly cap: Mesh;
  private readonly capPositions = new Float32Array((capRings + 1) * (capSegments + 1) * 3);
  private readonly capColors = new Float32Array((capRings + 1) * (capSegments + 1) * 4).fill(1);

  constructor(private readonly scene: Scene) {
    // Esfera UV com normais para dentro; as cores ficam por vértice (céu liso, sem textura).
    const rings = 96, segments = 192;
    const positions: number[] = [], indices: number[] = [];
    for (let r = 0; r <= rings; r++) {
      const phi = (r / rings) * Math.PI; // 0 = zênite
      for (let s = 0; s <= segments; s++) {
        const theta = (s / segments) * Math.PI * 2;
        positions.push(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
      }
    }
    for (let r = 0; r < rings; r++) for (let s = 0; s < segments; s++) {
      const a = r * (segments + 1) + s, b = a + segments + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
    this.dirs = new Float32Array(positions);
    this.colors = new Float32Array((positions.length / 3) * 4).fill(1);
    const data = new VertexData();
    data.positions = positions.map((v) => v * radius); data.indices = indices; data.colors = this.colors;
    const dome = this.dome = new Mesh('sky-dome', scene);
    data.applyToMesh(dome, true);
    const material = new PBRMaterial('sky-dome', scene);
    material.unlit = true; material.backFaceCulling = false; material.fogEnabled = false;
    material.disableDepthWrite = true; material.albedoColor = Color3.White();
    dome.material = material; dome.useVertexColors = true; dome.hasVertexAlpha = false;
    dome.applyFog = false; dome.isPickable = false; dome.infiniteDistance = false; dome.renderingGroupId = 0;
    dome.alwaysSelectAsActiveMesh = true;

    // Calota: anéis em volta do sol, mais densos no centro (o halo concentrado muda rápido ali).
    const capIndices: number[] = [];
    for (let r = 0; r < capRings; r++) for (let k = 0; k < capSegments; k++) {
      const a = r * (capSegments + 1) + k, b = a + capSegments + 1;
      capIndices.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const capData = new VertexData();
    capData.positions = this.capPositions; capData.indices = capIndices; capData.colors = this.capColors;
    const cap = this.cap = new Mesh('sun-halo', scene);
    capData.applyToMesh(cap, true);
    // Mesmo material da cúpula (sem gravar profundidade: gravando, o pré-passe do SSAO clareia a calota e aparece a
    // borda). Criada depois da cúpula, é desenhada depois dela e fica por cima.
    cap.material = material; cap.useVertexColors = true; cap.hasVertexAlpha = false;
    cap.applyFog = false; cap.isPickable = false; cap.alwaysSelectAsActiveMesh = true;

    // Disco do sol: quadrado virado para a câmera recortado em círculo (alpha test; a mistura transparente some com o
    // pré-passe do SSAO). O halo em volta fica na calota; o bloom realça o disco nos níveis altos.
    const size = 128;
    const texture = new DynamicTexture('sun-disc', { width: size, height: size }, scene, true);
    const ctx = texture.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, size, size); ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2); ctx.fill();
    texture.hasAlpha = true; texture.update(true);
    const sunMaterial = this.sunMaterial = new PBRMaterial('sun-disc', scene);
    // Emissivo em vez de unlit: o albedo é limitado a 1 e o sol precisa passar disso (laranja forte no poente, bloom).
    sunMaterial.albedoColor = Color3.Black(); sunMaterial.directIntensity = 0; sunMaterial.environmentIntensity = 0; sunMaterial.specularIntensity = 0;
    sunMaterial.albedoTexture = texture; sunMaterial.useAlphaFromAlbedoTexture = true;
    sunMaterial.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST; sunMaterial.alphaCutOff = 0.5;
    sunMaterial.fogEnabled = false; sunMaterial.backFaceCulling = false;
    const half = sunDistance * Math.tan(sunAngle / 2);
    const disc = this.sunDisc = new Mesh('sun-disc', scene);
    const quad = new VertexData();
    quad.positions = [-half, -half, 0, half, -half, 0, half, half, 0, -half, half, 0];
    quad.uvs = [0, 0, 1, 0, 1, 1, 0, 1]; quad.indices = [0, 1, 2, 0, 2, 3];
    quad.applyToMesh(disc);
    disc.material = sunMaterial; disc.billboardMode = Mesh.BILLBOARDMODE_ALL;
    disc.applyFog = false; disc.isPickable = false; disc.renderingGroupId = 0; disc.alwaysSelectAsActiveMesh = true;

    // Cúpula e sol acompanham a câmera (infiniteDistance falha com a cena em mão direita).
    scene.onBeforeRenderObservable.add(() => {
      const eye = scene.activeCamera?.globalPosition; if (!eye) return;
      dome.position.copyFrom(eye); cap.position.copyFrom(eye);
      disc.position.copyFrom(eye).addInPlace(this.sunPosition.scale(sunDistance));
    });
  }

  /** Direção (unitária) da câmera para o sol. */
  private sunPosition = new Vector3(0, 1, 0);

  /** Atualiza cores e posição do sol. `lightDirection` é a direção em que a luz viaja (do sol para a cena). */
  update(colors: SkyColors, lightDirection: Vector3) {
    const sun = this.sunPosition.copyFrom(lightDirection).scaleInPlace(-1).normalize();
    const low = 1 - Math.min(1, Math.max(0, sun.y) / Math.sin((40 * Math.PI) / 180)); // 0 com sol alto, 1 no horizonte
    const { top, horizon } = colors;
    // Brilho saturado (cor do sol ao quadrado): com o sol baixo o halo fica laranja em vez de branco lavado.
    const glow = colors.sun, sat = 1 + low;
    const gr = Math.pow(glow.r, sat), gg = Math.pow(glow.g, sat), gb = Math.pow(glow.b, sat);
    const d = this.dirs, c = this.colors, sky = [0, 0, 0];
    // Direção horizontal do sol, para o clarão quente ao longo do horizonte no pôr do sol (largo e suave: cabe na cúpula).
    const hx = sun.x, hz = sun.z, hl = Math.hypot(hx, hz) || 1;
    const band = (x: number, y: number, z: number) => {
      const side = Math.max(0, (x * hx + z * hz) / (hl * (Math.hypot(x, z) || 1)));
      return low * low * Math.pow(1 - Math.max(y, 0), 6) * side * side * 0.45;
    };
    for (let i = 0, j = 0; i < d.length; i += 3, j += 4) {
      const x = d[i], y = d[i + 1], z = d[i + 2];
      gradient(y, top, horizon, sky);
      const k = band(x, y, z);
      c[j] = sky[0] + gr * k; c[j + 1] = sky[1] + gg * k; c[j + 2] = sky[2] + gb * k;
    }
    this.dome.updateVerticesData('color', c);

    // Calota orientada para o sol: mesmo céu da cúpula mais o halo, que some antes da borda (sem emenda).
    const u = Math.abs(sun.y) < 0.95 ? Vector3.Cross(sun, Vector3.Up()).normalize() : new Vector3(1, 0, 0);
    const v = Vector3.Cross(u, sun).normalize();
    const p = this.capPositions, q = this.capColors;
    for (let r = 0, n = 0; r <= capRings; r++) {
      const ang = capAngle * Math.pow(r / capRings, 1.6), ca = Math.cos(ang), sa = Math.sin(ang);
      const edge = Math.min(1, Math.max(0, (ang / capAngle - 0.55) / 0.45));
      const fade = 1 - edge * edge * (3 - 2 * edge);
      const halo = (Math.pow(ca, 3000) * 0.9 + Math.pow(ca, 300) * 0.25 + Math.pow(ca, 40) * 0.05 * (0.5 + low)) * fade;
      for (let k = 0; k <= capSegments; k++, n++) {
        const th = (k / capSegments) * Math.PI * 2, cu = Math.cos(th) * sa, cv = Math.sin(th) * sa;
        const x = sun.x * ca + u.x * cu + v.x * cv, y = sun.y * ca + u.y * cu + v.y * cv, z = sun.z * ca + u.z * cu + v.z * cv;
        p[n * 3] = x * capDistance; p[n * 3 + 1] = y * capDistance; p[n * 3 + 2] = z * capDistance;
        gradient(y, top, horizon, sky);
        const k2 = band(x, y, z) + halo;
        q[n * 4] = sky[0] + gr * k2; q[n * 4 + 1] = sky[1] + gg * k2; q[n * 4 + 2] = sky[2] + gb * k2;
      }
    }
    this.cap.updateVerticesData('position', p); this.cap.updateVerticesData('color', q);
    this.cap.refreshBoundingInfo();
    // Disco: branco e forte com o sol alto; amarelo-alaranjado no poente (com intensidade menor, senão o ACES o leva
    // ao branco). Bem mais forte que o céu em volta para se destacar.
    const warm = Math.min(1, Math.max(0, (low - 0.3) / 0.45)), w = warm * warm * (3 - 2 * warm);
    const intensity = 8 - 6.2 * w;
    this.sunMaterial.emissiveColor.set(intensity, (1 - 0.6 * w) * intensity, (1 - 0.88 * w) * intensity);
    this.sunDisc.setEnabled(sun.y > -0.02);
  }
}
