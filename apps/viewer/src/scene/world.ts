import {
  ArcRotateCamera, CascadedShadowGenerator, Color3, Color4, DefaultRenderingPipeline, DirectionalLight, DynamicTexture, HemisphericLight,
  ImageProcessingConfiguration, Layer, RawCubeTexture, Scene, SSAO2RenderingPipeline, Vector3, type AbstractEngine, type AbstractMesh,
} from './babylon';
import { createEngine, gpuName } from './engine';
import { rgb, toSrgbBytes } from './geometry';
import { detectQuality, qualityLevels, savedQuality, saveQuality, type QualityLevel } from './quality';

export type LightMode = 'day' | 'sunset';

interface Flight { fromPos: Vector3; fromTarget: Vector3; toPos: Vector3; toTarget: Vector3; start: number; duration: number; resolve: () => void }
interface Label { element: HTMLElement; position: Vector3; minDistance?: number; maxDistance?: number }

interface Palette { top: Color3; bottom: Color3; fog: Color3; sun: Color3; hemiSky: Color3; hemiGround: Color3; sunIntensity: number; hemiIntensity: number; elevation: number; azimuth: number; exposure: number; fogNear: number; fogFar: number }
// Intensidades na escala física do Three (lux da direcional); a hemisférica do Babylon não divide por π, então leva 1/π.
const palettes: Record<LightMode, Palette> = {
  // Tarde clara: céu azul com horizonte enevoado e quente, sol a 42° com luz levemente dourada (sombras marcadas).
  day: { top: rgb('#6fa6dc'), bottom: rgb('#f1e9da'), fog: rgb('#e9e2d4'), sun: rgb('#ffe9cc'), hemiSky: rgb('#d3e3f4'), hemiGround: rgb('#b5a88e'), sunIntensity: 2.7, hemiIntensity: 1.4 / Math.PI, elevation: 42, azimuth: 35, exposure: 1, fogNear: 650, fogFar: 2700 },
  // Fim de tarde: céu enevoado e quente, sol baixo a oeste, sombras longas e luz difusa reduzida.
  sunset: { top: rgb('#b3a49d'), bottom: rgb('#e6c49c'), fog: rgb('#dcc0a0'), sun: rgb('#ffae6e'), hemiSky: rgb('#e6cdb6'), hemiGround: rgb('#8f7a69'), sunIntensity: 2.2, hemiIntensity: 1.15 / Math.PI, elevation: 14, azimuth: -72, exposure: 1.0, fogNear: 420, fogFar: 2800 },
};
const transitionSeconds = 3.2;
/** O ACES do Three multiplica a exposição por 1/0,6 antes da curva; o do Babylon não. */
const acesExposure = 1 / 0.6;
const deg = (d: number) => (d * Math.PI) / 180;

/**
 * Cena base em Babylon.js: motor WebGPU (ou WebGL2), câmera orbital, céu em degradê, sol com sombras em
 * cascata, luz hemisférica, reflexos de um ambiente gerado aqui, oclusão de ambiente, tonemapping e
 * antisserrilhado conforme o nível de qualidade, e rótulos HTML projetados sobre a cena.
 * A cena usa o sistema de mão direita: metros, x leste, z sul, norte = −z (docs/implantacao-geografica.md).
 */
export class World {
  readonly scene: Scene;
  readonly camera: ArcRotateCamera;
  readonly sun: DirectionalLight;
  readonly hemi: HemisphericLight;
  readonly webgpu: boolean;
  quality: QualityLevel;
  /** O visitante escolheu a qualidade (não rebaixa sozinho). */
  private qualityChosen: boolean;
  private shadow: CascadedShadowGenerator | null = null;
  private shadowDirty = true;
  private pipeline: DefaultRenderingPipeline | null = null;
  private ssao: SSAO2RenderingPipeline | null = null;
  private readonly labels: Label[] = [];
  private flight: Flight | null = null;
  private readonly tickers: ((dt: number) => void)[] = [];
  private readonly interactListeners: (() => void)[] = [];
  private readonly sky: Layer;
  private readonly skyCanvas = Object.assign(document.createElement('canvas'), { width: 2, height: 256 });
  private readonly skyTexture: DynamicTexture;
  mode: LightMode = 'day';
  /** Pausa a renderização (planta 3D aberta por cima). */
  paused = false;

  static async create(host: HTMLElement, labelLayer: HTMLElement) {
    const { engine, canvas, webgpu } = await createEngine(host);
    return new World(host, labelLayer, engine, canvas, webgpu);
  }

  private constructor(private readonly host: HTMLElement, private readonly labelLayer: HTMLElement, readonly engine: AbstractEngine, readonly canvas: HTMLCanvasElement, webgpu: boolean) {
    this.webgpu = webgpu;
    const scene = this.scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    scene.clearColor = new Color4(0.9, 0.93, 0.92, 1);
    scene.skipPointerMovePicking = true; // o realce de torre faz o próprio picking, só quando precisa
    scene.fogMode = Scene.FOGMODE_LINEAR;

    this.camera = new ArcRotateCamera('camera', 0, 1, 400, Vector3.Zero(), scene);
    const camera = this.camera;
    camera.fov = deg(38);
    camera.minZ = 1; camera.maxZ = 12000;
    camera.lowerRadiusLimit = 25; camera.upperRadiusLimit = 2600;
    camera.upperBetaLimit = deg(84);
    camera.inertia = 0.85; camera.panningInertia = 0.85;
    camera.angularSensibilityX = camera.angularSensibilityY = 640;
    camera.wheelDeltaPercentage = 0.01; camera.pinchDeltaPercentage = 0.004;
    camera.mapPanning = true; // arrastar com o botão direito move no plano do chão
    camera.setPosition(new Vector3(260, 220, 300));
    camera.attachControl(false, false, 2);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    for (const type of ['pointerdown', 'wheel'] as const) canvas.addEventListener(type, () => { for (const fn of this.interactListeners) fn(); }, { passive: true });
    camera.onProjectionMatrixChangedObservable.add(() => this.applyInset());

    this.sun = new DirectionalLight('sun', new Vector3(-0.3, -1, 0.4), scene);
    this.hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
    this.sun.shadowMinZ = -1500; this.sun.shadowMaxZ = 1500;

    // Reflexos suaves (vidros e fachadas): ambiente pequeno gerado aqui, sem baixar arquivos.
    scene.environmentTexture = skyEnvironment(scene);
    scene.environmentIntensity = 0.55;

    this.skyTexture = new DynamicTexture('sky', this.skyCanvas, scene, false);
    this.sky = new Layer('sky', null, scene, true);
    this.sky.texture = this.skyTexture;
    this.sky.convertToLinearSpace = true; // o degradê é pintado em sRGB; o pipeline aplica tonemapping depois

    this.quality = savedQuality() ?? detectQuality(gpuName(engine));
    this.qualityChosen = savedQuality() != null;
    this.applyQuality();
    this.setMode('day', true);

    scene.onNewMeshAddedObservable.add(() => { this.shadowDirty = true; });
    scene.onMeshRemovedObservable.add(() => { this.shadowDirty = true; });
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    engine.runRenderLoop(() => this.frame());
  }

  // ——— qualidade ———

  /** Troca o nível de qualidade (sombras, SSAO, antisserrilhado e resolução) e lembra a escolha. */
  setQuality(level: QualityLevel, chosen = true) {
    this.quality = level;
    if (chosen) { this.qualityChosen = true; saveQuality(level); }
    this.applyQuality();
  }

  private applyQuality() {
    const q = qualityLevels[this.quality];
    this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, q.maxPixelRatio));

    this.shadow?.dispose();
    const shadow = new CascadedShadowGenerator(q.shadowMapSize, this.sun);
    shadow.numCascades = q.cascades;
    shadow.lambda = 0.82;
    shadow.stabilizeCascades = true;
    shadow.cascadeBlendPercentage = 0.08;
    shadow.shadowMaxZ = 900;
    shadow.usePercentageCloserFiltering = true;
    shadow.filteringQuality = [CascadedShadowGenerator.QUALITY_LOW, CascadedShadowGenerator.QUALITY_MEDIUM, CascadedShadowGenerator.QUALITY_HIGH][q.shadowFiltering];
    shadow.bias = 0.0012;
    shadow.normalBias = 0.012;
    shadow.transparencyShadow = false;
    this.shadow = shadow; this.shadowDirty = true;

    this.pipeline?.dispose(); this.pipeline = null;
    this.ssao?.dispose(); this.ssao = null;
    if (q.ssao) {
      try {
        const ssao = new SSAO2RenderingPipeline('ssao', this.scene, { ssaoRatio: q.ssao.ratio, blurRatio: 1 }, [this.camera], true);
        ssao.radius = 3.5; ssao.totalStrength = 1.1; ssao.base = 0.08; ssao.samples = q.ssao.samples;
        ssao.maxZ = 900; ssao.minZAspect = 0.5; ssao.expensiveBlur = q.ssao.samples >= 16; ssao.bilateralSoften = 0.05;
        this.ssao = ssao;
      } catch (error) { console.warn('SSAO indisponível', error); }
    }
    const pipeline = new DefaultRenderingPipeline('main', true, this.scene, [this.camera]);
    pipeline.samples = q.msaa;
    pipeline.fxaaEnabled = q.fxaa;
    // Brilho suave só nos níveis altos: realça vidros e reflexos do sol sem custo nos aparelhos modestos.
    pipeline.bloomEnabled = this.quality === 'high' || this.quality === 'ultra';
    pipeline.bloomThreshold = 0.82; pipeline.bloomWeight = 0.14; pipeline.bloomKernel = 48; pipeline.bloomScale = 0.5;
    pipeline.imageProcessingEnabled = true;
    pipeline.imageProcessing.toneMappingEnabled = true;
    pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    pipeline.imageProcessing.contrast = 1.12;
    pipeline.imageProcessing.vignetteEnabled = true; pipeline.imageProcessing.vignetteWeight = 1.2; pipeline.imageProcessing.vignetteStretch = 0.4;
    pipeline.imageProcessing.exposure = this.current.exposure * acesExposure;
    this.pipeline = pipeline;
    if (this.scene.prePassRenderer) this.scene.prePassRenderer.samples = q.msaa;
  }

  /** Lista de projetores de sombra: malhas marcadas com metadata.castShadow (recalculada quando a cena muda). */
  private refreshShadowCasters() {
    if (!this.shadow || !this.shadowDirty) return;
    this.shadowDirty = false;
    const map = this.shadow.getShadowMap();
    if (map) map.renderList = this.scene.meshes.filter((m: AbstractMesh) => m.metadata?.castShadow === true);
  }

  // ——— luz do dia / pôr do sol ———

  /** 0 = dia, 1 = pôr do sol. Anima suavemente até o alvo; listeners recebem o valor a cada quadro. */
  dusk = 0;
  private duskTarget = 0;
  private duskFrom = 0;
  private duskStart = 0;
  private readonly duskListeners: ((t: number) => void)[] = [];
  private readonly current: Palette = { ...palettes.day, top: palettes.day.top.clone(), bottom: palettes.day.bottom.clone(), fog: palettes.day.fog.clone(), sun: palettes.day.sun.clone(), hemiSky: palettes.day.hemiSky.clone(), hemiGround: palettes.day.hemiGround.clone() };

  setMode(mode: LightMode, immediate = false) {
    this.mode = mode;
    this.duskTarget = mode === 'sunset' ? 1 : 0;
    this.duskFrom = this.dusk; this.duskStart = performance.now();
    if (immediate) { this.dusk = this.duskTarget; this.applyLighting(); }
  }

  onDusk(fn: (t: number) => void) { this.duskListeners.push(fn); fn(this.dusk); }

  private applyLighting() {
    const t = this.dusk * this.dusk * (3 - 2 * this.dusk);
    const a = palettes.day; const b = palettes.sunset; const p = this.current;
    for (const key of ['top', 'bottom', 'fog', 'sun', 'hemiSky', 'hemiGround'] as const) Color3.LerpToRef(a[key], b[key], t, p[key]);
    for (const key of ['sunIntensity', 'hemiIntensity', 'elevation', 'azimuth', 'exposure', 'fogNear', 'fogFar'] as const) p[key] = a[key] + (b[key] - a[key]) * t;
    const ctx = this.skyCanvas.getContext('2d')!;
    const css = (c: Color3) => `rgb(${toSrgbBytes(c).join(',')})`;
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, css(p.top)); gradient.addColorStop(0.62, css(p.bottom)); gradient.addColorStop(1, css(p.bottom));
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 2, 256);
    this.skyTexture.update(true);
    this.scene.fogColor.copyFrom(p.fog); this.scene.fogStart = p.fogNear; this.scene.fogEnd = p.fogFar;
    this.sun.diffuse.copyFrom(p.sun); this.sun.specular.copyFrom(p.sun); this.sun.intensity = p.sunIntensity;
    const el = deg(p.elevation); const az = deg(p.azimuth);
    this.sun.direction.set(-Math.sin(az) * Math.cos(el), -Math.sin(el), Math.cos(az) * Math.cos(el));
    this.hemi.diffuse.copyFrom(p.hemiSky); this.hemi.groundColor.copyFrom(p.hemiGround); this.hemi.intensity = p.hemiIntensity;
    this.hemi.specular.set(0, 0, 0);
    if (this.pipeline) this.pipeline.imageProcessing.exposure = p.exposure * acesExposure;
    for (const listener of this.duskListeners) listener(t);
  }

  // ——— câmera ———

  onTick(fn: (dt: number) => void) { this.tickers.push(fn); }
  /** O visitante mexeu na câmera (arrastar, roda): interrompe o tour. */
  onInteract(fn: () => void) { this.interactListeners.push(fn); }

  /** Ponto para onde a câmera olha. */
  get target() { return this.camera.target; }
  get cameraPosition() { return this.camera.position; }

  addLabel(element: HTMLElement, position: Vector3, range: { minDistance?: number; maxDistance?: number } = {}) {
    this.labelLayer.appendChild(element);
    const label = { element, position, ...range };
    this.labels.push(label);
    return () => { element.remove(); this.labels.splice(this.labels.indexOf(label), 1); };
  }

  /** Voa a câmera até uma posição/alvo com aceleração suave. */
  flyTo(position: Vector3, target: Vector3, duration = 1.6) {
    this.flight?.resolve();
    const camera = this.camera;
    camera.inertialAlphaOffset = camera.inertialBetaOffset = camera.inertialRadiusOffset = 0;
    camera.inertialPanningX = camera.inertialPanningY = 0;
    return new Promise<void>((resolve) => {
      this.flight = { fromPos: camera.position.clone(), fromTarget: camera.target.clone(), toPos: position.clone(), toTarget: target.clone(), start: performance.now(), duration: duration * 1000, resolve };
    });
  }

  /** Enquadra um ponto a uma distância, mantendo a direção horizontal atual (ou um azimute dado). */
  frame3(target: Vector3, distance: number, polarDeg = 58, azimuthDeg?: number, duration = 1.6) {
    const current = this.camera.position.subtract(this.camera.target);
    const az = azimuthDeg != null ? deg(azimuthDeg) : Math.atan2(current.x, current.z);
    const polar = deg(polarDeg);
    const offset = new Vector3(Math.sin(polar) * Math.sin(az), Math.cos(polar), Math.sin(polar) * Math.cos(az)).scale(distance);
    return this.flyTo(target.add(offset), target.clone(), duration);
  }

  private inset = 0;
  /** Desloca o centro óptico quando painéis ocupam um lado da tela (positivo = painéis à direita). */
  setInset(pixels: number) { this.inset = pixels; this.camera.getProjectionMatrix(true); }

  /** Projeção descentrada (como setViewOffset do Three): soma ao termo de x que depende da profundidade. */
  private applyInset() {
    const w = this.host.clientWidth;
    if (!this.inset || w <= 760) return;
    this.camera.getProjectionMatrix().addAtIndex(8, this.inset / w);
  }

  private resize() {
    this.engine.resize();
    this.camera.getProjectionMatrix(true);
  }

  /** Seleção na posição do ponteiro (coordenadas do evento relativas ao canvas). */
  pick(event: { clientX: number; clientY: number }, predicate: (mesh: AbstractMesh) => boolean) {
    const rect = this.canvas.getBoundingClientRect();
    return this.scene.pick(event.clientX - rect.left, event.clientY - rect.top, predicate);
  }

  // ——— quadro ———

  private lastFrame = performance.now();
  private slowSince = 0;
  private frame() {
    const now = performance.now();
    const dt = Math.min((now - this.lastFrame) / 1000, 0.1); this.lastFrame = now;
    if (this.paused) return;
    if (this.flight) {
      const f = this.flight;
      const t = Math.min((now - f.start) / f.duration, 1);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.camera.setTarget(Vector3.Lerp(f.fromTarget, f.toTarget, e));
      this.camera.setPosition(Vector3.Lerp(f.fromPos, f.toPos, e));
      if (t >= 1) { this.flight = null; f.resolve(); }
    }
    if (this.dusk !== this.duskTarget) {
      // Baseado no relógio: a transição dura o mesmo tempo mesmo com poucos quadros por segundo.
      const progress = Math.min(1, (now - this.duskStart) / (transitionSeconds * 1000 * Math.max(Math.abs(this.duskTarget - this.duskFrom), 0.05)));
      this.dusk = progress >= 1 ? this.duskTarget : this.duskFrom + (this.duskTarget - this.duskFrom) * progress;
      this.applyLighting();
    }
    for (const tick of this.tickers) tick(dt);
    // Arrastar com o botão direito move o ponto sob o cursor na mesma proporção em qualquer zoom.
    const camera = this.camera;
    camera.panningSensibility = this.engine.getRenderHeight(true) / (2 * camera.radius * Math.tan(camera.fov / 2)) / (1 - camera.panningInertia) / 3;
    if (this.shadow) {
      // A última cascata cobre até um pouco além do alvo: sombras nítidas perto e presentes ao longe.
      const reach = Math.min(2400, Math.max(500, camera.radius * 2.2));
      if (Math.abs(this.shadow.shadowMaxZ - reach) > reach * 0.15) this.shadow.shadowMaxZ = reach;
    }
    this.refreshShadowCasters();
    this.scene.render();
    this.updateLabels();
    this.autoDowngrade(now);
  }

  /** Sem escolha do visitante, rebaixa um nível se a taxa de quadros ficar muito baixa por alguns segundos. */
  private autoDowngrade(now: number) {
    if (this.qualityChosen || this.quality === 'eco' || document.hidden) { this.slowSince = 0; return; }
    if (this.engine.getFps() >= 22) { this.slowSince = 0; return; }
    if (!this.slowSince) { this.slowSince = now; return; }
    if (now - this.slowSince < 5000) return;
    this.slowSince = 0;
    const order: QualityLevel[] = ['eco', 'balanced', 'high', 'ultra'];
    this.setQuality(order[order.indexOf(this.quality) - 1], false);
    this.qualityListeners.forEach((fn) => fn(this.quality));
  }
  private readonly qualityListeners: ((level: QualityLevel) => void)[] = [];
  /** Avisa quando a qualidade muda sozinha (para atualizar o seletor). */
  onQualityChange(fn: (level: QualityLevel) => void) { this.qualityListeners.push(fn); }

  private updateLabels() {
    const w = this.host.clientWidth; const h = this.host.clientHeight;
    const m = this.scene.getTransformMatrix().m; const eye = this.camera.position;
    for (const label of this.labels) {
      const { x, y, z } = label.position;
      const distance = Vector3.Distance(eye, label.position);
      const cw = x * m[3] + y * m[7] + z * m[11] + m[15];
      const nx = (x * m[0] + y * m[4] + z * m[8] + m[12]) / cw;
      const ny = (x * m[1] + y * m[5] + z * m[9] + m[13]) / cw;
      const visible = cw > 0 && Math.abs(nx) < 1.1 && Math.abs(ny) < 1.1
        && (label.minDistance == null || distance >= label.minDistance) && (label.maxDistance == null || distance <= label.maxDistance);
      label.element.style.display = visible && !label.element.classList.contains('hidden') ? '' : 'none';
      if (!visible) continue;
      label.element.style.transform = `translate(-50%, -100%) translate(${((nx + 1) / 2) * w}px, ${((1 - ny) / 2) * h}px)`;
      label.element.style.zIndex = String(Math.round(10000 - distance));
    }
  }
}

/**
 * Ambiente para reflexos PBR gerado em código (cubo 32×32 por face): céu claro em cima, horizonte luminoso
 * e chão neutro embaixo. Depende só da altura da direção, então serve em qualquer orientação de cubo.
 */
export function skyEnvironment(scene: Scene) {
  const size = 32;
  const zenith = [0.4, 0.6, 0.86], horizon = [0.97, 0.93, 0.86], ground = [0.44, 0.41, 0.35];
  const color = (y: number) => {
    if (y >= 0) { const t = Math.pow(y, 0.6); return horizon.map((h, k) => h + (zenith[k] - h) * t); }
    const t = Math.min(1, -y * 3); return horizon.map((h, k) => h + (ground[k] - h) * t);
  };
  // Direções por face (+x, −x, +y, −y, +z, −z) na convenção de cubemap; u, v em [−1, 1].
  const dirs: ((u: number, v: number) => [number, number, number])[] = [
    (u, v) => [1, -v, -u], (u, v) => [-1, -v, u], (u, v) => [u, 1, v], (u, v) => [u, -1, -v], (u, v) => [u, -v, 1], (u, v) => [-u, -v, -1],
  ];
  const faces = dirs.map((dir) => {
    const data = new Uint8Array(size * size * 4);
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const [x, y, z] = dir(((i + 0.5) / size) * 2 - 1, ((j + 0.5) / size) * 2 - 1);
      const c = color(y / Math.hypot(x, y, z));
      const k = (j * size + i) * 4;
      // sRGB de 8 bits (a textura é tratada como gama e convertida para linear no shader).
      for (let n = 0; n < 3; n++) data[k + n] = Math.round(Math.pow(c[n], 1 / 2.2) * 255);
      data[k + 3] = 255;
    }
    return data;
  });
  const texture = new RawCubeTexture(scene, faces, size, 5 /* RGBA */, 0 /* UNSIGNED_BYTE */, true);
  texture.gammaSpace = true;
  return texture;
}
