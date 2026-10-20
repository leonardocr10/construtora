import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { AssetKind, DevelopmentStatus } from '@prisma/client';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from '../common/prisma.service';

const galleryKinds: AssetKind[] = [AssetKind.FACADE, AssetKind.INTERIOR_RENDER, AssetKind.AMENITY, AssetKind.AERIAL];
const publicKinds = new Set<AssetKind>([...galleryKinds, AssetKind.IMPLANTATION, AssetKind.FLOOR_PLAN, AssetKind.MODEL_3D, AssetKind.OTHER]);
const surroundingsRadius = 1600;
const overpassUrl = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';

type LatLng = [number, number];
interface OsmElement { type: string; id: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }

export function storageRoot() { return process.env.LOCAL_STORAGE_PATH ?? join(process.cwd(), 'storage'); }

@Injectable()
export class PublicService {
  private readonly logger = new Logger(PublicService.name);
  constructor(private readonly prisma: PrismaService) {}

  private async published(slug: string) {
    const development = await this.prisma.development.findFirst({ where: { slug, status: DevelopmentStatus.PUBLISHED, archivedAt: null } });
    if (!development) throw new NotFoundException('Empreendimento não encontrado ou não publicado');
    return development;
  }

  async development(slug: string, sessionHash?: string) {
    const development = await this.published(slug);
    const id = development.id;
    const [settings, theme, viewer, buildings, floorPlans, amenities, assets] = await Promise.all([
      this.prisma.developmentSettings.findUnique({ where: { developmentId: id } }),
      this.prisma.developmentTheme.findUnique({ where: { developmentId: id } }),
      this.prisma.viewerConfiguration.findUnique({ where: { developmentId: id }, include: { activeModelVersion: { select: { id: true, version: true, assetId: true } } } }),
      this.prisma.building.findMany({
        where: { developmentId: id }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
        include: { floors: { orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, number: true } }, units: { orderBy: { number: 'asc' }, include: { floor: { select: { number: true } }, floorPlans: { select: { floorPlanId: true, primary: true } } } } },
      }),
      this.prisma.floorPlan.findMany({ where: { developmentId: id }, orderBy: { name: 'asc' }, include: { assets: { select: { id: true, kind: true } } } }),
      this.prisma.amenity.findMany({ where: { developmentId: id }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: { media: { orderBy: { sortOrder: 'asc' }, select: { assetId: true } } } }),
      this.prisma.developmentAsset.findMany({ where: { developmentId: id, kind: { in: [...galleryKinds, AssetKind.IMPLANTATION] }, unitId: null }, orderBy: { createdAt: 'asc' }, select: { id: true, kind: true, originalName: true, metadata: true } }),
    ]);
    const layout = (viewer?.publicLayout ?? {}) as { showPrices?: boolean };
    await this.prisma.viewEvent.create({ data: { developmentId: id, event: 'PUBLIC_VIEW', sessionHash } });
    return {
      id, slug: development.slug, name: development.name, description: development.description,
      address: development.address, city: development.city, state: development.state,
      latitude: development.latitude?.toNumber() ?? null, longitude: development.longitude?.toNumber() ?? null,
      deliveryDate: development.deliveryDate, coverAssetId: development.coverAssetId,
      contact: settings ? { phone: settings.contactPhone, email: settings.contactEmail, whatsapp: settings.whatsapp, site: settings.officialSite } : null,
      theme: theme ? { primaryColor: theme.primaryColor, secondaryColor: theme.secondaryColor, fontFamily: theme.fontFamily, logoAssetId: theme.logoAssetId } : null,
      viewer: { camera: viewer?.camera ?? null, lighting: viewer?.lighting ?? null, interaction: viewer?.interaction ?? null, layout: viewer?.publicLayout ?? null, modelAssetId: viewer?.activeModelVersion?.assetId ?? null },
      buildings: buildings.map((b) => ({
        id: b.id, name: b.name, code: b.code, position: b.position, floorCount: b.floorCount, unitsPerFloor: b.unitsPerFloor,
        floorHeight: b.floorHeight?.toNumber() ?? null, model3d: b.model3d, imageAssetId: b.imageAssetId, floors: b.floors,
        units: b.units.map((u) => ({
          id: u.id, number: u.number, final: u.final, floor: u.floor?.number ?? null, status: u.status,
          privateArea: u.privateArea?.toNumber() ?? null, totalArea: u.totalArea?.toNumber() ?? null,
          price: layout.showPrices ? u.price?.toNumber() ?? null : null,
          floorPlanId: (u.floorPlans.find((f) => f.primary) ?? u.floorPlans[0])?.floorPlanId ?? null,
        })),
      })),
      floorPlans: floorPlans.map((p) => ({ id: p.id, name: p.name, code: p.code, area: p.area?.toNumber() ?? null, bedrooms: p.bedrooms, suites: p.suites, bathrooms: p.bathrooms, parkingSpaces: p.parkingSpaces, description: p.description, imageAssetIds: p.assets.map((a) => a.id) })),
      amenities: amenities.map((a) => ({ id: a.id, name: a.name, description: a.description, marker: a.marker, position: a.position, mediaAssetIds: a.media.map((m) => m.assetId) })),
      gallery: assets,
    };
  }

  /** Página leve com metadados Open Graph para a prévia do link no WhatsApp/redes, que redireciona ao visualizador. */
  async sharePage(slug: string) {
    const development = await this.published(slug);
    const apiUrl = (process.env.PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
    const viewerUrl = `${(process.env.VIEWER_URL ?? 'http://localhost:4300').replace(/\/$/, '')}/${encodeURIComponent(development.slug)}`;
    const units = await this.prisma.unit.groupBy({ by: ['status'], where: { building: { developmentId: development.id } }, _count: true });
    const available = units.find((u) => u.status === 'AVAILABLE')?._count ?? 0;
    const place = [development.city, development.state].filter(Boolean).join(' · ');
    const title = `${development.name}${place ? ` · ${place}` : ''}`;
    const description = `Explore em 3D: escolha a torre, o andar e o apartamento. ${available} unidades disponíveis.${development.description ? ` ${development.description}` : ''}`.slice(0, 280);
    const image = development.coverAssetId ? `${apiUrl}/api/v1/public/assets/${development.coverAssetId}` : null;
    const e = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${e(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="${e(description)}">
<meta property="og:type" content="website"><meta property="og:locale" content="pt_BR"><meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(description)}"><meta property="og:url" content="${e(viewerUrl)}">
${image ? `<meta property="og:image" content="${e(image)}"><meta property="og:image:width" content="1200"><meta name="twitter:card" content="summary_large_image">` : ''}
<meta http-equiv="refresh" content="0; url=${e(viewerUrl)}"><link rel="canonical" href="${e(viewerUrl)}"></head>
<body style="font-family:system-ui;padding:24px"><p>Abrindo <a href="${e(viewerUrl)}">${e(development.name)} em 3D</a>…</p></body></html>`;
  }

  async asset(id: string) {
    const asset = await this.prisma.developmentAsset.findFirst({ where: { id, development: { status: DevelopmentStatus.PUBLISHED, archivedAt: null } } });
    if (!asset || !publicKinds.has(asset.kind)) throw new NotFoundException('Arquivo não encontrado');
    return { path: join(storageRoot(), asset.storageKey), mimeType: asset.mimeType, checksum: asset.checksum };
  }

  // Entorno real (ruas, quadras, água, verde e edificações) do OpenStreetMap, convertido para metros
  // relativos ao centro do empreendimento e guardado em cache no armazenamento privado.
  async surroundings(slug: string) { return this.loadSurroundings(await this.published(slug), false); }

  /** Atualização manual do entorno pelo painel (rota autenticada), inclusive antes de publicar. */
  async refreshSurroundings(organizationId: string, developmentId: string) {
    const development = await this.prisma.development.findFirst({ where: { id: developmentId, organizationId, archivedAt: null } });
    if (!development) throw new NotFoundException('Empreendimento não encontrado');
    const result = await this.loadSurroundings(development, true);
    return { roads: result.roads.length, buildings: result.buildings.length, green: result.green.length, water: result.water.length };
  }

  private async loadSurroundings(development: { id: string; latitude: { toNumber(): number } | null; longitude: { toNumber(): number } | null }, refresh: boolean) {
    const lat = development.latitude?.toNumber(); const lng = development.longitude?.toNumber();
    if (lat == null || lng == null) throw new BadRequestException('Empreendimento sem latitude/longitude');
    const file = join(storageRoot(), development.id, 'osm-surroundings.json');
    if (!refresh) { try { return JSON.parse(await readFile(file, 'utf8')); } catch { /* sem cache */ } }
    const query = `[out:json][timeout:60];(way["highway"](around:${surroundingsRadius},${lat},${lng});way["building"](around:${surroundingsRadius},${lat},${lng});way["natural"="water"](around:${surroundingsRadius},${lat},${lng});way["leisure"~"park|pitch|garden"](around:${surroundingsRadius},${lat},${lng});way["landuse"~"grass|forest|meadow"](around:${surroundingsRadius},${lat},${lng}););out geom;`;
    let elements: OsmElement[];
    try {
      const response = await fetch(overpassUrl, { method: 'POST', body: new URLSearchParams({ data: query }), headers: { 'user-agent': 'VistaHub/1.0' }, signal: AbortSignal.timeout(70_000) });
      if (!response.ok) throw new Error(`Overpass respondeu ${response.status}`);
      elements = ((await response.json()) as { elements: OsmElement[] }).elements;
    } catch (error) {
      this.logger.warn(`Falha ao buscar entorno OSM: ${error instanceof Error ? error.message : String(error)}`);
      throw new ServiceUnavailableException('Não foi possível obter o entorno no OpenStreetMap agora');
    }
    const toLocal = ([pLat, pLng]: LatLng): [number, number] => {
      const x = (pLng - lng) * 111_320 * Math.cos((lat * Math.PI) / 180);
      const z = -(pLat - lat) * 110_540;
      return [Math.round(x * 10) / 10, Math.round(z * 10) / 10];
    };
    const result = { center: [lat, lng], radius: surroundingsRadius, attribution: '© colaboradores do OpenStreetMap (ODbL)', roads: [] as unknown[], buildings: [] as unknown[], water: [] as unknown[], green: [] as unknown[] };
    for (const element of elements) {
      if (element.type !== 'way' || !element.geometry?.length) continue;
      const points = element.geometry.map((g) => toLocal([g.lat, g.lon]));
      const tags = element.tags ?? {};
      if (tags.highway) result.roads.push({ kind: tags.highway, name: tags.name ?? null, points });
      else if (tags.building) result.buildings.push({ points, height: Number(tags.height) || (Number(tags['building:levels']) || 1) * 3 });
      else if (tags.natural === 'water') result.water.push({ points, name: tags.name ?? null });
      else result.green.push({ points, kind: tags.leisure ?? tags.landuse, name: tags.name ?? null });
    }
    await mkdir(join(storageRoot(), development.id), { recursive: true });
    await writeFile(file, JSON.stringify(result));
    return result;
  }

  async createLead(slug: string, input: { name: string; phone: string; email?: string; message?: string; unitId?: string; consent: boolean }) {
    const development = await this.published(slug);
    if (!input.consent) throw new BadRequestException('É necessário aceitar o contato');
    return this.prisma.$transaction(async (db) => {
      if (input.unitId && !(await db.unit.findFirst({ where: { id: input.unitId, building: { developmentId: development.id } } }))) throw new BadRequestException('Unidade inválida');
      const lead = await db.lead.create({ data: { developmentId: development.id, unitId: input.unitId, name: input.name, phone: input.phone, email: input.email, message: input.message, source: 'visualizador-3d', consentAt: new Date() } });
      await db.auditLog.create({ data: { organizationId: development.organizationId, entityType: 'Lead', entityId: lead.id, action: 'PUBLIC_CREATE', after: { source: 'visualizador-3d' } } });
      return { id: lead.id };
    });
  }
}
