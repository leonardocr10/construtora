import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type LightMode = 'day' | 'sunset';

interface Flight { fromPos: THREE.Vector3; fromTarget: THREE.Vector3; toPos: THREE.Vector3; toTarget: THREE.Vector3; start: number; duration: number; resolve: () => void }
interface Label { element: HTMLElement; position: THREE.Vector3; minDistance?: number; maxDistance?: number }

interface Palette { top: THREE.Color; bottom: THREE.Color; fog: THREE.Color; sun: THREE.Color; hemiSky: THREE.Color; hemiGround: THREE.Color; sunIntensity: number; hemiIntensity: number; elevation: number; azimuth: number; exposure: number; fogNear: number; fogFar: number }
const c = (hex: string) => new THREE.Color(hex);
const palettes: Record<LightMode, Palette> = {
  day: { top: c('#9cc4e4'), bottom: c('#eef1ee'), fog: c('#e6ebe8'), sun: c('#fff4e0'), hemiSky: c('#dfeaf5'), hemiGround: c('#b9b29e'), sunIntensity: 2.6, hemiIntensity: 1.25, elevation: 55, azimuth: 35, exposure: 1, fogNear: 900, fogFar: 3200 },
  // Fim de tarde: céu enevoado e quente, sol baixo a oeste, sombras longas e luz difusa reduzida.
  sunset: { top: c('#b3a49d'), bottom: c('#e6c49c'), fog: c('#dcc0a0'), sun: c('#ffae6e'), hemiSky: c('#e6cdb6'), hemiGround: c('#8f7a69'), sunIntensity: 2.2, hemiIntensity: 1.15, elevation: 14, azimuth: -72, exposure: 1.0, fogNear: 420, fogFar: 2800 },
};
const transitionSeconds = 3.2;

/** Cena base: renderizador, câmera orbital, céu, luz do sol e rótulos HTML projetados. */
export class World {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly sun = new THREE.DirectionalLight();
  readonly hemi = new THREE.HemisphereLight();
  private readonly labels: Label[] = [];
  private flight: Flight | null = null;
  private readonly tickers: ((dt: number) => void)[] = [];
  private readonly clock = new THREE.Clock();
  mode: LightMode = 'day';

  constructor(private readonly host: HTMLElement, private readonly labelLayer: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    host.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(38, 1, 1, 12000);
    this.camera.position.set(260, 220, 300);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(84);
    this.controls.minDistance = 25;
    this.controls.maxDistance = 2600;
    this.controls.screenSpacePanning = false;

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const shadow = this.sun.shadow.camera;
    shadow.left = -260; shadow.right = 260; shadow.top = 260; shadow.bottom = -260; shadow.near = 10; shadow.far = 1400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target, this.hemi);
    this.setMode('day', true);

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** 0 = dia, 1 = pôr do sol. Anima suavemente até o alvo; listeners recebem o valor a cada quadro. */
  dusk = 0;
  private duskTarget = 0;
  private duskFrom = 0;
  private duskStart = 0;
  private readonly duskListeners: ((t: number) => void)[] = [];
  private readonly skyCanvas = Object.assign(document.createElement('canvas'), { width: 2, height: 256 });
  private readonly skyTexture = new THREE.CanvasTexture(this.skyCanvas);
  private readonly current = { ...palettes.day, top: palettes.day.top.clone(), bottom: palettes.day.bottom.clone(), fog: palettes.day.fog.clone(), sun: palettes.day.sun.clone(), hemiSky: palettes.day.hemiSky.clone(), hemiGround: palettes.day.hemiGround.clone() };

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
    for (const key of ['top', 'bottom', 'fog', 'sun', 'hemiSky', 'hemiGround'] as const) p[key].copy(a[key]).lerp(b[key], t);
    for (const key of ['sunIntensity', 'hemiIntensity', 'elevation', 'azimuth', 'exposure', 'fogNear', 'fogFar'] as const) p[key] = a[key] + (b[key] - a[key]) * t;
    const ctx = this.skyCanvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, `#${p.top.getHexString()}`); gradient.addColorStop(0.62, `#${p.bottom.getHexString()}`); gradient.addColorStop(1, `#${p.bottom.getHexString()}`);
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 2, 256);
    this.skyTexture.colorSpace = THREE.SRGBColorSpace;
    this.skyTexture.needsUpdate = true;
    this.scene.background = this.skyTexture;
    if (!(this.scene.fog instanceof THREE.Fog)) this.scene.fog = new THREE.Fog(p.fog, p.fogNear, p.fogFar);
    const fog = this.scene.fog as THREE.Fog; fog.color.copy(p.fog); fog.near = p.fogNear; fog.far = p.fogFar;
    this.sun.color.copy(p.sun); this.sun.intensity = p.sunIntensity;
    this.hemi.color.copy(p.hemiSky); this.hemi.groundColor.copy(p.hemiGround); this.hemi.intensity = p.hemiIntensity;
    this.renderer.toneMappingExposure = p.exposure;
    for (const listener of this.duskListeners) listener(t);
  }

  onTick(fn: (dt: number) => void) { this.tickers.push(fn); }

  addLabel(element: HTMLElement, position: THREE.Vector3, range: { minDistance?: number; maxDistance?: number } = {}) {
    this.labelLayer.appendChild(element);
    const label = { element, position, ...range };
    this.labels.push(label);
    return () => { element.remove(); this.labels.splice(this.labels.indexOf(label), 1); };
  }

  /** Voa a câmera até uma posição/alvo com aceleração suave. */
  flyTo(position: THREE.Vector3, target: THREE.Vector3, duration = 1.6) {
    this.flight?.resolve();
    return new Promise<void>((resolve) => {
      this.flight = { fromPos: this.camera.position.clone(), fromTarget: this.controls.target.clone(), toPos: position, toTarget: target, start: performance.now(), duration: duration * 1000, resolve };
    });
  }

  /** Enquadra um ponto a uma distância, mantendo a direção horizontal atual (ou um azimute dado). */
  frame3(target: THREE.Vector3, distance: number, polarDeg = 58, azimuthDeg?: number, duration = 1.6) {
    const current = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    const az = azimuthDeg != null ? THREE.MathUtils.degToRad(azimuthDeg) : Math.atan2(current.x, current.z);
    const polar = THREE.MathUtils.degToRad(polarDeg);
    const offset = new THREE.Vector3(Math.sin(polar) * Math.sin(az), Math.cos(polar), Math.sin(polar) * Math.cos(az)).multiplyScalar(distance);
    return this.flyTo(target.clone().add(offset), target.clone(), duration);
  }

  private inset = 0;
  /** Desloca o centro óptico quando painéis ocupam um lado da tela (positivo = painéis à direita). */
  setInset(pixels: number) { this.inset = pixels; this.resize(); }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.host;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / Math.max(h, 1);
    if (this.inset && w > 760) this.camera.setViewOffset(w, h, this.inset / 2, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  private frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    if (this.flight) {
      const f = this.flight;
      const t = Math.min((performance.now() - f.start) / f.duration, 1);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.camera.position.lerpVectors(f.fromPos, f.toPos, e);
      this.controls.target.lerpVectors(f.fromTarget, f.toTarget, e);
      if (t >= 1) { this.flight = null; f.resolve(); }
    }
    if (this.dusk !== this.duskTarget) {
      // Baseado no relógio: a transição dura o mesmo tempo mesmo com poucos quadros por segundo.
      const progress = Math.min(1, (performance.now() - this.duskStart) / (transitionSeconds * 1000 * Math.max(Math.abs(this.duskTarget - this.duskFrom), 0.05)));
      this.dusk = progress >= 1 ? this.duskTarget : this.duskFrom + (this.duskTarget - this.duskFrom) * progress;
      this.applyLighting();
    }
    for (const tick of this.tickers) tick(dt);
    this.controls.update();
    // A sombra acompanha o alvo para manter resolução boa perto do empreendimento.
    this.sun.target.position.copy(this.controls.target);
    this.sun.position.copy(this.controls.target).add(this.sunOffset());
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
  }

  private sunOffset() {
    const el = THREE.MathUtils.degToRad(this.current.elevation); const az = THREE.MathUtils.degToRad(this.current.azimuth);
    return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).multiplyScalar(600);
  }

  private readonly projected = new THREE.Vector3();
  private updateLabels() {
    const w = this.host.clientWidth; const h = this.host.clientHeight;
    for (const label of this.labels) {
      const distance = this.camera.position.distanceTo(label.position);
      this.projected.copy(label.position).project(this.camera);
      const visible = this.projected.z < 1 && Math.abs(this.projected.x) < 1.1 && Math.abs(this.projected.y) < 1.1
        && (label.minDistance == null || distance >= label.minDistance) && (label.maxDistance == null || distance <= label.maxDistance);
      label.element.style.display = visible && !label.element.classList.contains('hidden') ? '' : 'none';
      if (!visible) continue;
      label.element.style.transform = `translate(-50%, -100%) translate(${((this.projected.x + 1) / 2) * w}px, ${((1 - this.projected.y) / 2) * h}px)`;
      label.element.style.zIndex = String(Math.round(10000 - distance));
    }
  }
}
