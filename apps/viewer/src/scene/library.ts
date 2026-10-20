import { Color3, HDRCubeTexture, LoadAssetContainerAsync, Matrix, Mesh, PBRMaterial, Texture, TransformNode, Vector3, type AssetContainer, type Scene } from './babylon';

/**
 * Biblioteca de assets gerada no Blender (scripts/blender/build_library.py, em /library): texturas PBR sem
 * emenda, céu HDR e modelos GLB de vegetação e carros com dois níveis de detalhe.
 *
 * Os modelos viram "moldes" (malhas com a transformação aplicada nos vértices, ocultas) e são desenhados
 * com instâncias finas, agrupadas por região: cada região troca de nível de detalhe pela distância da
 * câmera e some além do alcance, para manter poucas chamadas de desenho e poucos triângulos ao longe.
 */
export interface LibraryCatalog {
  textures: Record<string, { meters: number; metal: number; files: Record<string, { file: string; bytes: number }> }>;
  sky: Record<'day' | 'sunset', { file: string; sunElevation: number; sunAzimuth: number }>;
  models: Record<string, { file: string; bytes: number; triangles: number }>;
}

export interface Placement { matrix: Matrix; color?: Color3 }
export interface InstanceOptions {
  parent: TransformNode;
  /** Lado da região (m) que agrupa as instâncias para o nível de detalhe. */
  chunk?: number;
  /** Distância (m) a partir da qual usa o nível 1; além de `cull`, a região some. */
  lodDistance: number;
  cull?: number;
  castShadow?: boolean;
  /** Níveis de detalhe que projetam sombra (padrão: todos). Carros ao longe não precisam. */
  shadowLevels?: number;
  /** Materiais cuja cor é multiplicada pela cor de cada instância (pintura do carro). */
  tint?: (materialName: string) => boolean;
}

interface Template { lods: Mesh[][] }
interface Chunk { center: Vector3; radius: number; lods: Mesh[][]; level: number }

export class Library {
  private readonly models = new Map<string, Promise<Template>>();
  private readonly chunks: Chunk[] = [];
  private readonly textureCache = new Map<string, Texture>();
  /** Texturas de 512 px (níveis Baixa e Média) em vez de 1024 px. */
  lowRes = false;
  /** Multiplica as distâncias de nível de detalhe (níveis mais baixos trocam mais cedo). */
  lodScale = 1;

  private constructor(readonly scene: Scene, readonly base: string, readonly catalog: LibraryCatalog) {}

  static async load(scene: Scene, base = '/library/'): Promise<Library | null> {
    try {
      const response = await fetch(`${base}library.json`);
      if (!response.ok) return null;
      return new Library(scene, base, await response.json());
    } catch { return null; }
  }

  has(model: string) { return model in (this.catalog.models ?? {}); }

  // ——— texturas e materiais ———

  private texture(file: string, color: boolean) {
    const key = `${file}|${color}`;
    let texture = this.textureCache.get(key);
    if (!texture) {
      texture = new Texture(this.base + file, this.scene, { noMipmap: false, invertY: false, samplingMode: Texture.TRILINEAR_SAMPLINGMODE });
      texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE;
      texture.anisotropicFilteringLevel = 8;
      texture.gammaSpace = color;
      this.textureCache.set(key, texture);
    }
    return texture;
  }

  /**
   * Material PBR com o conjunto de texturas `set` (albedo × cor, normal, rugosidade/metal do ORM). A malha deve
   * vir com a UV já em repetições do ladrilho (ver `tileMeters`): sem matriz de textura, as três texturas usam a
   * mesma coordenada e o shader fica dentro do limite de variáveis do WebGPU.
   */
  /** Metros cobertos por uma repetição do conjunto (para dividir a UV em metros). */
  tileMeters(set: string) { return this.catalog.textures?.[set]?.meters ?? 1; }

  material(name: string, set: string, options: { color?: Color3; roughness?: number } = {}) {
    const info = this.catalog.textures?.[set];
    const material = new PBRMaterial(name, this.scene);
    material.albedoColor = options.color ?? Color3.White();
    material.metallic = info?.metal ?? 0; material.roughness = options.roughness ?? 1;
    material.maxSimultaneousLights = 4;
    if (!info) return material;
    const suffix = this.lowRes ? '_lo' : '';
    const tex = (kind: string, color: boolean) => {
      const entry = info.files[`${kind}${suffix}`] ?? info.files[kind];
      return this.texture(entry.file, color);
    };
    material.albedoTexture = tex('albedo', true);
    material.bumpTexture = tex('normal', false);
    material.metallicTexture = tex('orm', false);
    material.useRoughnessFromMetallicTextureGreen = true;
    material.useMetallnessFromMetallicTextureBlue = true;
    material.useAmbientOcclusionFromMetallicTextureRed = true;
    material.useRoughnessFromMetallicTextureAlpha = false;
    // Normal no padrão glTF/OpenGL com a cena em mão direita (como os GLB do Blender).
    material.invertNormalMapX = false; material.invertNormalMapY = false;
    return material;
  }

  /** Céu HDR pré-filtrado para reflexos e iluminação de ambiente. */
  sky(mode: 'day' | 'sunset', size = 256) {
    const entry = this.catalog.sky?.[mode];
    if (!entry) return null;
    return new HDRCubeTexture(this.base + entry.file, this.scene, size, false, true, false, true);
  }

  // ——— modelos ———

  /** Carrega um GLB da biblioteca e prepara os moldes de cada nível de detalhe (nós "<nome>_lod0", "_lod1"). */
  model(name: string): Promise<Template> {
    let entry = this.models.get(name);
    if (!entry) {
      entry = (async () => {
        const info = this.catalog.models[name];
        const container: AssetContainer = await LoadAssetContainerAsync(this.base + info.file, this.scene);
        container.addAllToScene();
        const lods: Mesh[][] = [];
        for (const node of container.transformNodes) {
          // Raiz de cada nível: exatamente "<modelo>_lod<n>" (as peças também terminam em _lod<n>).
          const match = new RegExp(`^${name}_lod(\\d)$`).exec(node.name); if (!match) continue;
          const level = Number(match[1]);
          node.computeWorldMatrix(true);
          const meshes = node.getChildMeshes(false).filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
          for (const mesh of meshes) {
            mesh.computeWorldMatrix(true);
            mesh.setParent(null);
            mesh.bakeCurrentTransformIntoVertices();
            mesh.setEnabled(false);
            mesh.isPickable = false;
            this.prepareMaterial(mesh);
          }
          // Uma malha por material em cada nível (pneus, rodas, faróis… juntos): menos chamadas de desenho por região.
          const byMaterial = new Map<unknown, Mesh[]>();
          for (const mesh of meshes) byMaterial.set(mesh.material, [...(byMaterial.get(mesh.material) ?? []), mesh]);
          lods[level] = [...byMaterial.values()].map((list) => {
            const merged = list.length === 1 ? list[0] : Mesh.MergeMeshes(list, true, true)!;
            merged.setEnabled(false); merged.isPickable = false;
            return merged;
          });
        }
        for (const node of [...container.transformNodes]) if (!node.getChildMeshes().length) node.dispose();
        return { lods: lods.filter(Boolean) };
      })();
      this.models.set(name, entry);
    }
    return entry;
  }

  private prepareMaterial(mesh: Mesh) {
    const material = mesh.material as PBRMaterial | null;
    if (!material || material.metadata?.vhPrepared) return;
    material.metadata = { ...(material.metadata ?? {}), vhPrepared: true };
    material.maxSimultaneousLights = 4;
    if (/^VH_Leaf/.test(material.name)) {
      // Folhas em cartões: recorte por alfa e as duas faces visíveis. Sem twoSidedLighting: no WebGPU ele
      // passa do limite de 16 variáveis entre os estágios do shader (com sombras em cascata e instâncias).
      material.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
      material.alphaCutOff = 0.5;
      material.backFaceCulling = false;
      material.twoSidedLighting = false;
      if (material.albedoTexture) material.albedoTexture.hasAlpha = true;
      material.useAlphaFromAlbedoTexture = true;
    }
  }

  /**
   * Desenha `placements` do modelo com instâncias finas, agrupadas em regiões de `chunk` metros.
   * Retorna o nó com todas as regiões (para esconder/mostrar junto com o lote).
   */
  async instances(name: string, placements: Placement[], options: InstanceOptions) {
    const group = new TransformNode(`${name}-instances`, this.scene); group.parent = options.parent;
    if (!placements.length) return group;
    const template = await this.model(name);
    const size = options.chunk ?? 60;
    const cells = new Map<string, Placement[]>();
    for (const p of placements) {
      const t = p.matrix.getTranslation();
      const key = `${Math.floor(t.x / size)}|${Math.floor(t.z / size)}`;
      cells.set(key, [...(cells.get(key) ?? []), p]);
    }
    let index = 0;
    for (const list of cells.values()) {
      const buffer = new Float32Array(list.length * 16);
      list.forEach((p, i) => p.matrix.copyToArray(buffer, i * 16));
      const colors = list.some((p) => p.color) ? new Float32Array(list.length * 4) : null;
      if (colors) list.forEach((p, i) => { const c = p.color ?? Color3.White(); colors.set([c.r, c.g, c.b, 1], i * 4); });
      const lods = template.lods.map((meshes, level) => meshes.map((source) => {
        const mesh = source.clone(`${source.name}-c${index}-l${level}`, group, true) as Mesh;
        // Geometria própria por região: no WebGPU, malhas com instâncias finas não podem dividir a geometria.
        mesh.makeGeometryUnique();
        mesh.setEnabled(level === 0);
        mesh.thinInstanceSetBuffer('matrix', buffer.slice(), 16, true);
        if (colors && options.tint?.(source.material?.name ?? '')) mesh.thinInstanceSetBuffer('color', colors.slice(), 4, true);
        mesh.thinInstanceRefreshBoundingInfo(false);
        mesh.metadata = { ...(mesh.metadata ?? {}), castShadow: (options.castShadow ?? true) && level < (options.shadowLevels ?? 99) };
        mesh.receiveShadows = true;
        mesh.isPickable = false;
        mesh.alwaysSelectAsActiveMesh = false;
        mesh.freezeWorldMatrix();
        return mesh;
      }));
      // Centro e raio da região (para escolher o nível pela distância à câmera).
      const world = options.parent.getWorldMatrix();
      const points = list.map((p) => Vector3.TransformCoordinates(p.matrix.getTranslation(), world));
      const center = points.reduce((a, b) => a.addInPlace(b), Vector3.Zero()).scaleInPlace(1 / points.length);
      const radius = Math.max(...points.map((p) => Vector3.Distance(p, center))) + 6;
      this.chunks.push({ center, radius, lods, level: 0 });
      this.track({ lodDistance: options.lodDistance, cull: options.cull ?? Infinity }, this.chunks[this.chunks.length - 1]);
      index++;
    }
    return group;
  }

  private readonly ranges = new Map<Chunk, { lodDistance: number; cull: number }>();
  private track(range: { lodDistance: number; cull: number }, chunk: Chunk) { this.ranges.set(chunk, range); }

  /** Escolhe o nível de cada região pela distância da câmera (chamar algumas vezes por segundo). */
  updateLod(camera: Vector3) {
    for (const chunk of this.chunks) {
      const range = this.ranges.get(chunk)!;
      const d = Math.max(0, Vector3.Distance(camera, chunk.center) - chunk.radius);
      const level = d > range.cull * this.lodScale ? -1 : d > range.lodDistance * this.lodScale ? Math.min(1, chunk.lods.length - 1) : 0;
      if (level === chunk.level) continue;
      chunk.level = level;
      chunk.lods.forEach((meshes, l) => meshes.forEach((m) => m.setEnabled(l === level)));
    }
  }

  /** Quantidade de regiões e instâncias (para as medições). */
  stats() { return { chunks: this.chunks.length, levels: this.chunks.map((c) => c.level) }; }
}
