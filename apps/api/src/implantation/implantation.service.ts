import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DevelopmentStatus, Prisma, RegionKind } from '@prisma/client';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { OrganizationContext } from '../common/organization-context';
import { PrismaService } from '../common/prisma.service';
import { assertCanEdit } from '../common/roles';
import { storageRoot } from '../public/public.service';

type Db = Prisma.TransactionClient;
type Point = [number, number];

/** Calibração da implantação (mesmo referencial de ViewerConfiguration.publicLayout). */
export interface LayoutInput { siteImageAssetId?: string; imageWidth: number; imageHeight: number; metersPerPixel: number; origin: Point; azimuth: number; lot?: Point[]; markerRadius?: number; }
export interface PlacementInput { id: string; position: { x: number; z: number; rotation?: number }; width?: number; depth?: number; }
export interface AmenityPlacementInput { id?: string; name?: string; marker?: number | null; position?: { x: number; z: number } | null; }
export interface LotInput { id?: string; name: string; points: Point[]; unitId?: string | null; }
export interface ImplantationInput { layout?: LayoutInput; latitude?: number | null; longitude?: number | null; buildings?: PlacementInput[]; amenities?: AmenityPlacementInput[]; lots?: LotInput[]; }
export interface ModelLinkInput { node: string; unitId: string; }

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const finite = (...values: unknown[]) => values.every((v) => typeof v === 'number' && Number.isFinite(v));

/**
 * Editor de implantação: calibração da arte no mapa, posição das torres e da área comum, lotes desenhados
 * sobre a imagem (vinculados a unidades) e vínculo dos nós de um GLB importado com as unidades.
 * Lotes e nós do GLB reaproveitam InteractiveMap/InteractiveRegion/RegionLink (uma camada por mídia).
 */
@Injectable()
export class ImplantationService {
  constructor(private readonly prisma: PrismaService) {}

  private audit(db: Db, context: OrganizationContext, entityType: string, entityId: string, action: string, after?: Prisma.InputJsonValue, before?: Prisma.InputJsonValue) {
    return db.auditLog.create({ data: { organizationId: context.organizationId, userId: context.userId, entityType, entityId, action, before, after } });
  }

  private async development(context: OrganizationContext, developmentId: string, db: Db = this.prisma) {
    const found = await db.development.findFirst({ where: { id: developmentId, organizationId: context.organizationId, archivedAt: null } });
    if (!found) throw new NotFoundException('Empreendimento não encontrado');
    return found;
  }

  private async units(db: Db, developmentId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    if (unique.length !== ids.length) throw new BadRequestException('A mesma unidade foi vinculada mais de uma vez');
    if (unique.length && (await db.unit.count({ where: { id: { in: unique }, building: { developmentId } } })) !== unique.length) throw new BadRequestException('Unidade não pertence ao empreendimento');
  }

  /** Camada interativa de uma mídia (implantação ou GLB), criada na primeira gravação. */
  private async layer(db: Db, developmentId: string, assetId: string, name: string, width: number, height: number) {
    const found = await db.interactiveMap.findFirst({ where: { developmentId, assetId }, orderBy: { createdAt: 'asc' } });
    if (found) return found.width === width && found.height === height ? found : db.interactiveMap.update({ where: { id: found.id }, data: { width, height } });
    return db.interactiveMap.create({ data: { developmentId, assetId, name, width, height } });
  }

  private async regions(db: Db, developmentId: string, assetId: string | undefined, kind: RegionKind) {
    if (!assetId) return [];
    return db.interactiveRegion.findMany({ where: { kind, map: { developmentId, assetId } }, include: { links: { select: { unitId: true } } }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  }

  async get(context: OrganizationContext, developmentId: string) {
    const development = await this.development(context, developmentId);
    const [viewer, assets, buildings, amenities, units, models] = await Promise.all([
      this.prisma.viewerConfiguration.findUnique({ where: { developmentId } }),
      this.prisma.developmentAsset.findMany({ where: { developmentId, kind: { in: ['IMPLANTATION', 'AERIAL', 'OTHER'] }, mimeType: { startsWith: 'image/' } }, select: { id: true, kind: true, originalName: true }, orderBy: { createdAt: 'asc' } }),
      this.prisma.building.findMany({ where: { developmentId }, select: { id: true, name: true, code: true, position: true, model3d: true, floorCount: true, _count: { select: { units: true } } }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] }),
      this.prisma.amenity.findMany({ where: { developmentId }, select: { id: true, name: true, marker: true, position: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.unit.findMany({ where: { building: { developmentId } }, select: { id: true, number: true, final: true, status: true, privateArea: true, totalArea: true, buildingId: true, floor: { select: { number: true } } }, orderBy: [{ buildingId: 'asc' }, { number: 'asc' }] }),
      this.prisma.modelVersion.findMany({ where: { developmentId }, select: { id: true, version: true, label: true, assetId: true, asset: { select: { originalName: true } } }, orderBy: { version: 'desc' } }),
    ]);
    const layout = (viewer?.publicLayout ?? null) as (LayoutInput & Record<string, unknown>) | null;
    const lots = await this.regions(this.prisma, developmentId, layout?.siteImageAssetId, RegionKind.LOT);
    return {
      development: { id: development.id, name: development.name, slug: development.slug, status: development.status, latitude: development.latitude?.toNumber() ?? null, longitude: development.longitude?.toNumber() ?? null },
      layout, assets, buildings, amenities,
      units: units.map(({ floor, privateArea, totalArea, ...u }) => ({ ...u, floor: floor?.number ?? null, privateArea: privateArea?.toNumber() ?? null, totalArea: totalArea?.toNumber() ?? null })),
      lots: lots.map((r) => ({ id: r.id, name: r.name, points: (r.geometry as { points: Point[] }).points, unitId: r.links.find((l) => l.unitId)?.unitId ?? null })),
      models: models.map((m) => ({ id: m.id, version: m.version, label: m.label, assetId: m.assetId, originalName: m.asset.originalName, active: viewer?.activeModelVersionId === m.id })),
    };
  }

  /** Grava tudo o que o editor alterou numa única transação (tudo ou nada), com auditoria por entidade. */
  async save(context: OrganizationContext, developmentId: string, input: ImplantationInput) {
    assertCanEdit(context);
    const moved = await this.prisma.$transaction(async (db) => {
      const development = await this.development(context, developmentId, db);
      const viewer = await db.viewerConfiguration.findUnique({ where: { developmentId } });
      const current = (viewer?.publicLayout ?? {}) as Partial<LayoutInput> & Record<string, unknown>;
      let layout = current;

      if (input.layout) {
        const l = input.layout;
        if (!finite(l.imageWidth, l.imageHeight, l.metersPerPixel, l.azimuth, ...(l.origin ?? [])) || l.imageWidth < 1 || l.imageHeight < 1 || l.metersPerPixel <= 0 || l.origin?.length !== 2) throw new BadRequestException('Calibração da implantação inválida');
        if (l.siteImageAssetId && !(await db.developmentAsset.findFirst({ where: { id: l.siteImageAssetId, developmentId, mimeType: { startsWith: 'image/' } } }))) throw new BadRequestException('Imagem da implantação não pertence ao empreendimento');
        if (l.lot) this.assertPolygon(l.lot, l, 'Contorno do terreno');
        // Ajuste manual de escala/azimute/origem invalida o resumo da calibração por pontos.
        const manual = current.metersPerPixel !== l.metersPerPixel || current.azimuth !== ((l.azimuth % 360) + 360) % 360 || JSON.stringify(current.origin) !== JSON.stringify([round(l.origin[0], 1), round(l.origin[1], 1)]);
        if (manual && current.calibration) current.calibration = { status: 'manual', note: 'Escala, azimute ou origem alterados à mão depois da calibração por pontos' };
        layout = { ...current, ...l, azimuth: ((l.azimuth % 360) + 360) % 360, origin: [round(l.origin[0], 1), round(l.origin[1], 1)], lot: l.lot?.map(([x, y]) => [Math.round(x), Math.round(y)] as Point) ?? current.lot };
        const config = await db.viewerConfiguration.upsert({ where: { developmentId }, update: { publicLayout: layout as Prisma.InputJsonValue }, create: { developmentId, publicLayout: layout as Prisma.InputJsonValue } });
        const pick = (v: Partial<LayoutInput>) => ({ siteImageAssetId: v.siteImageAssetId ?? null, metersPerPixel: v.metersPerPixel ?? null, azimuth: v.azimuth ?? null, origin: v.origin ?? null, lotPoints: v.lot?.length ?? 0 });
        await this.audit(db, context, 'ViewerConfiguration', config.id, 'UPDATE_IMPLANTATION', pick(layout), pick(current));
      }

      let locationChanged = false;
      if (input.latitude !== undefined || input.longitude !== undefined) {
        const latitude = input.latitude ?? null; const longitude = input.longitude ?? null;
        if ((latitude != null && (latitude < -90 || latitude > 90)) || (longitude != null && (longitude < -180 || longitude > 180))) throw new BadRequestException('Latitude/longitude inválida');
        const before = { latitude: development.latitude?.toNumber() ?? null, longitude: development.longitude?.toNumber() ?? null };
        if (before.latitude !== latitude || before.longitude !== longitude) {
          await db.development.update({ where: { id: developmentId }, data: { latitude, longitude } });
          await this.audit(db, context, 'Development', developmentId, 'UPDATE_LOCATION', { latitude, longitude }, before);
          locationChanged = true;
        }
      }

      for (const item of input.buildings ?? []) {
        const building = await db.building.findFirst({ where: { id: item.id, developmentId } });
        if (!building) throw new BadRequestException('Torre não pertence ao empreendimento');
        if (!finite(item.position?.x, item.position?.z, item.position?.rotation ?? 0)) throw new BadRequestException(`Posição inválida para ${building.name}`);
        const position = { x: round(item.position.x), z: round(item.position.z), rotation: round((((item.position.rotation ?? 0) % 360) + 360) % 360, 1) };
        const model = (building.model3d ?? {}) as Record<string, unknown>;
        const model3d = { ...model, ...(finite(item.width) && item.width! >= 2 ? { width: round(item.width!) } : {}), ...(finite(item.depth) && item.depth! >= 2 ? { depth: round(item.depth!) } : {}) };
        const before = { position: building.position, width: model.width ?? null, depth: model.depth ?? null };
        const after = { position, width: model3d.width ?? null, depth: model3d.depth ?? null };
        if (JSON.stringify(before) === JSON.stringify(after)) continue;
        await db.building.update({ where: { id: building.id }, data: { position, model3d: model3d as Prisma.InputJsonValue } });
        await this.audit(db, context, 'Building', building.id, 'UPDATE_PLACEMENT', after as Prisma.InputJsonValue, before as Prisma.InputJsonValue);
      }

      for (const item of input.amenities ?? []) {
        if (item.position && !finite(item.position.x, item.position.z)) throw new BadRequestException('Posição inválida para a área comum');
        const position = item.position ? { x: round(item.position.x), z: round(item.position.z) } : item.position === null ? Prisma.DbNull : undefined;
        if (!item.id) {
          if (!item.name?.trim()) throw new BadRequestException('Informe o nome da nova área comum');
          const created = await db.amenity.create({ data: { developmentId, name: item.name.trim(), marker: item.marker ?? null, sortOrder: item.marker ?? 0, position } });
          await this.audit(db, context, 'Amenity', created.id, 'CREATE', { name: created.name, marker: created.marker, position: created.position });
          continue;
        }
        const amenity = await db.amenity.findFirst({ where: { id: item.id, developmentId } });
        if (!amenity) throw new BadRequestException('Área comum não pertence ao empreendimento');
        const data = { ...(item.name?.trim() ? { name: item.name.trim() } : {}), ...(item.marker !== undefined ? { marker: item.marker } : {}), ...(position !== undefined ? { position } : {}) };
        const updated = await db.amenity.update({ where: { id: amenity.id }, data });
        if (JSON.stringify([amenity.name, amenity.marker, amenity.position]) !== JSON.stringify([updated.name, updated.marker, updated.position]))
          await this.audit(db, context, 'Amenity', amenity.id, 'UPDATE_PLACEMENT', { name: updated.name, marker: updated.marker, position: updated.position }, { name: amenity.name, marker: amenity.marker, position: amenity.position });
      }

      if (input.lots) await this.saveLots(db, context, developmentId, layout as Partial<LayoutInput>, input.lots);
      return locationChanged;
    }, { timeout: 30_000 });
    // Coordenadas novas invalidam o entorno em cache; a próxima visita busca de novo no OpenStreetMap.
    if (moved) await unlink(join(storageRoot(), developmentId, 'osm-surroundings.json')).catch(() => undefined);
    return this.get(context, developmentId);
  }

  private async saveLots(db: Db, context: OrganizationContext, developmentId: string, layout: Partial<LayoutInput>, lots: LotInput[]) {
    if (!layout.siteImageAssetId || !layout.imageWidth || !layout.imageHeight) throw new BadRequestException('Escolha a imagem da implantação antes de desenhar lotes');
    if (lots.length > 3000) throw new BadRequestException('Limite de 3000 lotes por implantação');
    for (const lot of lots) { if (!lot.name?.trim() || lot.name.length > 120) throw new BadRequestException('Todo lote precisa de um nome (até 120 caracteres)'); this.assertPolygon(lot.points, layout as LayoutInput, `Lote ${lot.name}`); }
    await this.units(db, developmentId, lots.map((l) => l.unitId).filter((id): id is string => !!id));
    const map = await this.layer(db, developmentId, layout.siteImageAssetId, 'Implantação', Math.round(layout.imageWidth), Math.round(layout.imageHeight));
    const existing = await db.interactiveRegion.findMany({ where: { mapId: map.id, kind: RegionKind.LOT }, include: { links: true } });
    const known = new Map(existing.map((r) => [r.id, r]));
    for (const lot of lots) if (lot.id && !known.has(lot.id)) throw new BadRequestException(`Lote ${lot.name} não pertence a esta implantação`);
    const keep = new Set(lots.map((l) => l.id).filter(Boolean));
    const removed = existing.filter((r) => !keep.has(r.id)).map((r) => r.id);
    if (removed.length) { await db.regionLink.deleteMany({ where: { regionId: { in: removed } } }); await db.interactiveRegion.deleteMany({ where: { id: { in: removed } } }); }
    let created = 0; let updated = 0;
    for (const [index, lot] of lots.entries()) {
      const geometry = { points: lot.points.map(([x, y]) => [round(x, 1), round(y, 1)]) };
      const region = lot.id
        ? await db.interactiveRegion.update({ where: { id: lot.id }, data: { name: lot.name.trim(), geometry, sortOrder: index } })
        : await db.interactiveRegion.create({ data: { mapId: map.id, kind: RegionKind.LOT, name: lot.name.trim(), geometry, sortOrder: index } });
      const before = lot.id ? known.get(lot.id)!.links.find((l) => l.unitId)?.unitId ?? null : null;
      if (lot.id && before === (lot.unitId ?? null) && JSON.stringify(known.get(lot.id)!.geometry) === JSON.stringify(geometry) && known.get(lot.id)!.name === region.name) continue;
      await db.regionLink.deleteMany({ where: { regionId: region.id } });
      if (lot.unitId) await db.regionLink.create({ data: { regionId: region.id, unitId: lot.unitId } });
      if (lot.id) updated++; else created++;
    }
    if (created || updated || removed.length) await this.audit(db, context, 'InteractiveMap', map.id, 'SAVE_LOTS', { total: lots.length, created, updated, removed: removed.length, linked: lots.filter((l) => l.unitId).length }, { total: existing.length });
  }

  private assertPolygon(points: Point[], layout: Pick<LayoutInput, 'imageWidth' | 'imageHeight'>, label: string) {
    if (!Array.isArray(points) || points.length < 3 || points.length > 400) throw new BadRequestException(`${label}: o polígono precisa de 3 a 400 vértices`);
    const mx = layout.imageWidth * 0.1; const my = layout.imageHeight * 0.1;
    for (const p of points) if (!Array.isArray(p) || p.length !== 2 || !finite(p[0], p[1]) || p[0] < -mx || p[1] < -my || p[0] > layout.imageWidth + mx || p[1] > layout.imageHeight + my) throw new BadRequestException(`${label}: vértice fora da imagem`);
  }

  // Modelo GLB importado: nós (malhas) vinculados a unidades.
  private async modelVersion(context: OrganizationContext, developmentId: string, versionId: string, db: Db = this.prisma) {
    await this.development(context, developmentId, db);
    const version = await db.modelVersion.findFirst({ where: { id: versionId, developmentId } });
    if (!version) throw new NotFoundException('Versão do modelo não encontrada');
    return version;
  }

  async modelLinks(context: OrganizationContext, developmentId: string, versionId: string) {
    const version = await this.modelVersion(context, developmentId, versionId);
    const regions = await this.regions(this.prisma, developmentId, version.assetId, RegionKind.UNIT);
    return { modelVersionId: version.id, assetId: version.assetId, links: regions.map((r) => ({ node: (r.geometry as { node: string }).node, unitId: r.links.find((l) => l.unitId)?.unitId ?? null })).filter((l) => l.unitId) };
  }

  async saveModelLinks(context: OrganizationContext, developmentId: string, versionId: string, links: ModelLinkInput[]) {
    assertCanEdit(context);
    if (links.length > 5000) throw new BadRequestException('Limite de 5000 vínculos por modelo');
    const nodes = links.map((l) => l.node?.trim());
    if (nodes.some((n) => !n || n.length > 191)) throw new BadRequestException('Nome de nó inválido');
    if (new Set(nodes).size !== nodes.length) throw new BadRequestException('O mesmo nó foi vinculado mais de uma vez');
    await this.prisma.$transaction(async (db) => {
      const version = await this.modelVersion(context, developmentId, versionId, db);
      await this.units(db, developmentId, links.map((l) => l.unitId));
      const map = await this.layer(db, developmentId, version.assetId, `Modelo 3D v${version.version}`, 0, 0);
      const old = await db.interactiveRegion.findMany({ where: { mapId: map.id, kind: RegionKind.UNIT }, select: { id: true } });
      await db.regionLink.deleteMany({ where: { regionId: { in: old.map((r) => r.id) } } });
      await db.interactiveRegion.deleteMany({ where: { id: { in: old.map((r) => r.id) } } });
      for (const [index, link] of links.entries()) await db.interactiveRegion.create({ data: { mapId: map.id, kind: RegionKind.UNIT, name: link.node.trim(), geometry: { node: link.node.trim() }, sortOrder: index, links: { create: { unitId: link.unitId } } } });
      await this.audit(db, context, 'ModelVersion', version.id, 'LINK_UNITS', { links: links.length }, { links: old.length });
    }, { timeout: 60_000 });
    return this.modelLinks(context, developmentId, versionId);
  }

  /** Arquivo privado (imagem da implantação ou GLB) para o editor autenticado, inclusive antes de publicar. */
  async assetFile(context: OrganizationContext, developmentId: string, assetId: string) {
    await this.development(context, developmentId);
    const asset = await this.prisma.developmentAsset.findFirst({ where: { id: assetId, developmentId } });
    if (!asset) throw new NotFoundException('Arquivo não encontrado');
    return { path: join(storageRoot(), asset.storageKey), mimeType: asset.mimeType, checksum: asset.checksum };
  }

  /** Camadas públicas: lotes da implantação e vínculos do GLB ativo (só empreendimentos publicados). */
  async publicRegions(slug: string) {
    const development = await this.prisma.development.findFirst({ where: { slug, status: DevelopmentStatus.PUBLISHED, archivedAt: null }, select: { id: true } });
    if (!development) throw new NotFoundException('Empreendimento não encontrado ou não publicado');
    const viewer = await this.prisma.viewerConfiguration.findUnique({ where: { developmentId: development.id }, include: { activeModelVersion: { select: { assetId: true } } } });
    const layout = (viewer?.publicLayout ?? null) as Partial<LayoutInput> | null;
    const [lots, nodes] = await Promise.all([
      this.regions(this.prisma, development.id, layout?.siteImageAssetId, RegionKind.LOT),
      this.regions(this.prisma, development.id, viewer?.activeModelVersion?.assetId, RegionKind.UNIT),
    ]);
    return {
      lots: lots.map((r) => ({ id: r.id, name: r.name, points: (r.geometry as { points: Point[] }).points, unitId: r.links.find((l) => l.unitId)?.unitId ?? null })),
      model: viewer?.activeModelVersion ? { assetId: viewer.activeModelVersion.assetId, links: nodes.map((r) => ({ node: (r.geometry as { node: string }).node, unitId: r.links.find((l) => l.unitId)?.unitId ?? null })).filter((l) => l.unitId) } : null,
    };
  }
}
