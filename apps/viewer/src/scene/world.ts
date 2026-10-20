import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type LightMode = 'day' | 'sunset';

interface Flight { fromPos: THREE.Vector3; fromTarget: THREE.Vector3; toPos: THREE.Vector3; toTarget: THREE.Vector3; start: number; duration: number; resolve: () => void }
interface Label { element: HTMLElement; position: THREE.Vector3; minDistance?: number; maxDistance?: number }

const palettes: Record<LightMode, { top: string; bottom: string; fog: number; sun: number; sunIntensity: number; hemiSky: number; hemiGround: number; hemiIntensity: number; elevation: number; azimuth: number; exposure: number }> = {
  day: { top: '#9cc4e4', bottom: '#eef1ee', fog: 0xe6ebe8, sun: 0xfff4e0, sunIntensity: 2.6, hemiSky: 0xdfeaf5, hemiGround: 0xb9b29e, hemiIntensity: 1.25, elevation: 55, azimuth: 35, exposure: 1 },
  sunset: { top: '#5d6a9a', bottom: '#f7c08e', fog: 0xf0c9a6, sun: 0xffb070, sunIntensity: 2.3, hemiSky: 0xffe2c8, hemiGround: 0xa89584, hemiIntensity: 1.35, elevation: 17, azimuth: 290, exposure: 1.02 },
};

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
    this.setMode('day');

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  setMode(mode: LightMode) {
    this.mode = mode;
    const p = palettes[mode];
    const canvas = document.createElement('canvas');
    canvas.width = 2; canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, p.top); gradient.addColorStop(0.62, p.bottom); gradient.addColorStop(1, p.bottom);
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 2, 256);
    const sky = new THREE.CanvasTexture(canvas);
    sky.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(p.fog, 900, 3200);
    this.sun.color.setHex(p.sun); this.sun.intensity = p.sunIntensity;
    this.hemi.color.setHex(p.hemiSky); this.hemi.groundColor.setHex(p.hemiGround); this.hemi.intensity = p.hemiIntensity;
    const el = THREE.MathUtils.degToRad(p.elevation); const az = THREE.MathUtils.degToRad(p.azimuth);
    this.sun.position.set(Math.sin(az) * Math.cos(el) * 600, Math.sin(el) * 600, -Math.cos(az) * Math.cos(el) * 600);
    this.renderer.toneMappingExposure = p.exposure;
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
    for (const tick of this.tickers) tick(dt);
    this.controls.update();
    // A sombra acompanha o alvo para manter resolução boa perto do empreendimento.
    this.sun.target.position.copy(this.controls.target);
    this.sun.position.copy(this.controls.target).add(this.sunOffset());
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
  }

  private sunOffset() {
    const p = palettes[this.mode];
    const el = THREE.MathUtils.degToRad(p.elevation); const az = THREE.MathUtils.degToRad(p.azimuth);
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
