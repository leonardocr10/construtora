import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AssetKind, DevelopmentStatus, JobStatus, Prisma, PublicationStatus } from '@prisma/client';
import { OrganizationContext } from '../common/organization-context';
import { PrismaService } from '../common/prisma.service';
import { assertCanEdit } from '../common/roles';

export interface CreateDevelopmentInput { name: string; slug: string; code?: string; description?: string; city?: string; state?: string; address?: string; zipCode?: string; latitude?: number; longitude?: number; deliveryDate?: string; }
export interface AssetScope { buildingId?: string; floorId?: string; unitId?: string; floorPlanId?: string; label?: string; }

@Injectable()
export class DevelopmentsService {
  constructor(private readonly prisma: PrismaService) {}
  private assertCanEdit(context: OrganizationContext) { assertCanEdit(context); }

  list(context: OrganizationContext) {
    return this.prisma.development.findMany({ where: { organizationId: context.organizationId, archivedAt: null }, include: { _count: { select: { buildings: true } } }, orderBy: { updatedAt: 'desc' } });
  }

  async get(context: OrganizationContext, id: string) {
    const development = await this.prisma.development.findFirst({ where: { id, organizationId: context.organizationId, archivedAt: null }, include: { settings: true, theme: true, _count: { select: { buildings: true, assets: true } } } });
    if (!development) throw new NotFoundException('Empreendimento não encontrado');
    return development;
  }

  async create(context: OrganizationContext, input: CreateDevelopmentInput) {
    this.assertCanEdit(context);
    return this.prisma.$transaction(async (db) => {
      const development = await db.development.create({ data: { organizationId: context.organizationId, name: input.name, slug: input.slug, code: input.code, description: input.description, city: input.city, state: input.state, address: input.address, zipCode: input.zipCode, latitude: input.latitude, longitude: input.longitude, deliveryDate: input.deliveryDate ? new Date(input.deliveryDate) : undefined, status: DevelopmentStatus.DRAFT } });
      await db.developmentSettings.create({ data: { developmentId: development.id } });
      await db.developmentTheme.create({ data: { developmentId: development.id } });
      await db.auditLog.create({ data: { organizationId: context.organizationId, userId: context.userId, entityType: 'Development', entityId: development.id, action: 'CREATE', after: { name: development.name, slug: development.slug } } });
      return development;
    });
  }

  async update(context: OrganizationContext, id: string, input: Partial<CreateDevelopmentInput> & { status?: DevelopmentStatus }) {
    this.assertCanEdit(context);
    const current = await this.get(context, id);
    const data: Prisma.DevelopmentUpdateInput = { ...input, deliveryDate: input.deliveryDate ? new Date(input.deliveryDate) : undefined };
    return this.prisma.$transaction(async (db) => {
      const updated = await db.development.update({ where: { id: current.id }, data });
      await db.auditLog.create({ data: { organizationId: context.organizationId, userId: context.userId, entityType: 'Development', entityId: id, action: 'UPDATE', before: { name: current.name, status: current.status }, after: { name: updated.name, status: updated.status } } });
      return updated;
    });
  }

  // Publicação: muda o status e grava uma versão imutável do que foi publicado (quem, quando, contagens).
  async publish(context: OrganizationContext, id: string, publish: boolean) {
    this.assertCanEdit(context);
    const current = await this.get(context, id);
    return this.prisma.$transaction(async (db) => {
      const counts = { buildings: await db.building.count({ where: { developmentId: id } }), units: await db.unit.count({ where: { building: { developmentId: id } } }), assets: await db.developmentAsset.count({ where: { developmentId: id } }) };
      if (publish && counts.buildings === 0) throw new BadRequestException('Cadastre ao menos uma torre antes de publicar');
      const status = publish ? DevelopmentStatus.PUBLISHED : DevelopmentStatus.PREPARING;
      const updated = await db.development.update({ where: { id }, data: { status } });
      const publication = await db.publication.findFirst({ where: { developmentId: id }, orderBy: { publishedAt: 'desc' } })
        ?? await db.publication.create({ data: { developmentId: id } });
      if (publish) {
        const last = await db.publicationVersion.aggregate({ where: { publicationId: publication.id }, _max: { version: true } });
        const version = await db.publicationVersion.create({ data: { publicationId: publication.id, version: (last._max.version ?? 0) + 1, payload: { slug: updated.slug, name: updated.name, publishedBy: context.userId, ...counts } } });
        await db.publication.update({ where: { id: publication.id }, data: { status: PublicationStatus.PUBLISHED, currentVersionId: version.id, publishedAt: new Date() } });
      } else {
        await db.publication.update({ where: { id: publication.id }, data: { status: PublicationStatus.RETIRED } });
      }
      await db.auditLog.create({ data: { organizationId: context.organizationId, userId: context.userId, entityType: 'Development', entityId: id, action: publish ? 'PUBLISH' : 'UNPUBLISH', before: { status: current.status }, after: { status } } });
      return updated;
    });
  }

  async addAsset(context: OrganizationContext, developmentId: string, asset: { kind: AssetKind; originalName: string; storageKey: string; mimeType: string; byteSize: bigint; checksum: string; metadata: Prisma.InputJsonValue }, scope: AssetScope = {}) {
    this.assertCanEdit(context);
    await this.get(context, developmentId);
    if (asset.kind === AssetKind.MODEL_3D && asset.mimeType !== 'model/gltf-binary') throw new BadRequestException('Modelos 3D devem ser enviados em GLB');
    const { label, ...links } = scope;
    return this.prisma.$transaction(async (db) => {
      await this.assertScope(db, developmentId, links);
      const created = await db.developmentAsset.create({ data: { developmentId, ...asset, ...links, uploadedById: context.userId } });
      await db.usageLedger.create({ data: { organizationId: context.organizationId, metric: 'STORAGE_BYTES', quantity: created.byteSize, referenceId: created.id } });
      let modelVersion = null;
      if (created.kind === AssetKind.MODEL_3D) {
        // Número da versão calculado dentro da transação; o índice único (developmentId, version) impede duplicidade concorrente.
        const last = await db.modelVersion.aggregate({ where: { developmentId }, _max: { version: true } });
        modelVersion = await db.modelVersion.create({ data: { developmentId, assetId: created.id, version: (last._max.version ?? 0) + 1, label, status: JobStatus.SUCCEEDED, createdById: context.userId } });
        await db.viewerConfiguration.upsert({ where: { developmentId }, update: {}, create: { developmentId, activeModelVersionId: modelVersion.id } });
      }
      await db.auditLog.create({ data: { organizationId: context.organizationId, userId: context.userId, entityType: 'DevelopmentAsset', entityId: created.id, action: 'CREATE', after: { kind: created.kind, originalName: created.originalName, byteSize: created.byteSize.toString(), modelVersion: modelVersion?.version ?? null } } });
      return { ...this.serializeAsset(created), modelVersion };
    });
  }

  async listAssets(context: OrganizationContext, developmentId: string) {
    await this.get(context, developmentId);
    const assets = await this.prisma.developmentAsset.findMany({ where: { developmentId }, orderBy: { createdAt: 'desc' } });
    return assets.map((asset) => this.serializeAsset(asset));
  }

  private async assertScope(db: Prisma.TransactionClient, developmentId: string, links: Omit<AssetScope, 'label'>) {
    if (links.buildingId && !(await db.building.findFirst({ where: { id: links.buildingId, developmentId } }))) throw new BadRequestException('Torre não pertence ao empreendimento');
    if (links.floorId && !(await db.floor.findFirst({ where: { id: links.floorId, building: { developmentId } } }))) throw new BadRequestException('Pavimento não pertence ao empreendimento');
    if (links.unitId && !(await db.unit.findFirst({ where: { id: links.unitId, building: { developmentId } } }))) throw new BadRequestException('Unidade não pertence ao empreendimento');
    if (links.floorPlanId && !(await db.floorPlan.findFirst({ where: { id: links.floorPlanId, developmentId } }))) throw new BadRequestException('Planta não pertence ao empreendimento');
  }

  private serializeAsset<T extends { byteSize: bigint }>(asset: T) {
    return { ...asset, byteSize: asset.byteSize.toString() };
  }
}
