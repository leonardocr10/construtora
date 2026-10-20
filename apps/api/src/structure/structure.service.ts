import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LeadStatus, Prisma, UnitStatus } from '@prisma/client';
import { OrganizationContext } from '../common/organization-context';
import { PrismaService } from '../common/prisma.service';
import { assertCanEdit, assertCommercial } from '../common/roles';
import { join } from 'node:path';
import { storageRoot } from '../public/public.service';
import { parsePlanLayout } from './plan-layout';

type Db = Prisma.TransactionClient;

/** Aplica o padrão de numeração: {andar}, {final}, {final:02} e {torre}. */
export function unitNumber(pattern: string, floor: number, final: number, building: string) {
  return pattern
    .replace(/\{andar\}/g, String(floor))
    .replace(/\{final(?::(\d+))?\}/g, (_m, pad?: string) => String(final).padStart(pad ? Number(pad) : 1, '0'))
    .replace(/\{torre\}/g, building);
}
export interface BuildingInput { name: string; code: string; sortOrder?: number; imageAssetId?: string; floorCount?: number; unitsPerFloor?: number; floorHeight?: number; position?: Prisma.InputJsonValue; model3d?: Prisma.InputJsonValue; }
export interface FloorInput { name: string; number: number; sortOrder?: number; }
export interface UnitInput { number: string; floorId?: string; unitTypeId?: string; final?: string; status?: UnitStatus; privateArea?: number; totalArea?: number; price?: number; }
export interface FloorPlanInput { name: string; code?: string; area?: number; bedrooms?: number; suites?: number; bathrooms?: number; parkingSpaces?: number; description?: string; }
export interface LeadInput { name: string; phone: string; email?: string; message?: string; source?: string; unitId?: string; consent?: boolean; }

@Injectable()
export class StructureService {
  constructor(private readonly prisma: PrismaService) {}

  private audit(db: Db, context: OrganizationContext, entityType: string, entityId: string, action: string, after?: Prisma.InputJsonValue, before?: Prisma.InputJsonValue) {
    return db.auditLog.create({ data: { organizationId: context.organizationId, userId: context.userId, entityType, entityId, action, before, after } });
  }

  private async development(context: OrganizationContext, developmentId: string, db: Db = this.prisma) {
    const found = await db.development.findFirst({ where: { id: developmentId, organizationId: context.organizationId, archivedAt: null }, select: { id: true } });
    if (!found) throw new NotFoundException('Empreendimento não encontrado');
    return found;
  }

  private async building(context: OrganizationContext, buildingId: string, db: Db = this.prisma) {
    const found = await db.building.findFirst({ where: { id: buildingId, development: { organizationId: context.organizationId } } });
    if (!found) throw new NotFoundException('Torre não encontrada');
    return found;
  }

  private async unit(context: OrganizationContext, unitId: string, db: Db = this.prisma) {
    const found = await db.unit.findFirst({ where: { id: unitId, building: { development: { organizationId: context.organizationId } } }, include: { building: { select: { developmentId: true } } } });
    if (!found) throw new NotFoundException('Unidade não encontrada');
    return found;
  }

  // Torres
  async listBuildings(context: OrganizationContext, developmentId: string) {
    await this.development(context, developmentId);
    return this.prisma.building.findMany({ where: { developmentId }, include: { floors: { orderBy: { sortOrder: 'asc' } }, _count: { select: { units: true } } }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
  }

  async createBuilding(context: OrganizationContext, developmentId: string, input: BuildingInput) {
    assertCanEdit(context);
    return this.prisma.$transaction(async (db) => {
      await this.development(context, developmentId, db);
      if (input.imageAssetId) await this.assertAsset(db, developmentId, input.imageAssetId);
      const building = await db.building.create({ data: { developmentId, ...input } });
      await this.audit(db, context, 'Building', building.id, 'CREATE', { name: building.name, code: building.code });
      return building;
    });
  }

  async updateBuilding(context: OrganizationContext, buildingId: string, input: Partial<BuildingInput>) {
    assertCanEdit(context);
    return this.prisma.$transaction(async (db) => {
      const current = await this.building(context, buildingId, db);
      if (input.imageAssetId) await this.assertAsset(db, current.developmentId, input.imageAssetId);
      const updated = await db.building.update({ where: { id: buildingId }, data: input });
      await this.audit(db, context, 'Building', buildingId, 'UPDATE', { name: updated.name, code: updated.code }, { name: current.name, code: current.code });
      return updated;
    });
  }

  // Pavimentos
  async createFloor(context: OrganizationContext, buildingId: string, input: FloorInput) {
    assertCanEdit(context);
    return this.prisma.$transaction(async (db) => {
      await this.building(context, buildingId, db);
      const floor = await db.floor.create({ data: { buildingId, name: input.name, number: input.number, sortOrder: input.sortOrder ?? input.number } });
      await this.audit(db, context, 'Floor', floor.id, 'CREATE', { name: floor.name, number: floor.number });
      return floor;
    });
  }

  /**
   * Gera pavimentos e unidades de uma torre numa única transação (tudo ou nada).
   * Reaproveita pavimentos existentes, ignora números já cadastrados e vincula plantas por final.
   */
  async generateUnits(context: OrganizationContext, buildingId: string, input: { from: number; to: number; perFloor: number; pattern: string; floorPlansByFinal?: Record<string, string> }) {
    assertCanEdit(context);
    if (input.to < input.from || input.perFloor < 1 || input.perFloor > 64 || input.to - input.from > 200) throw new BadRequestException('Intervalo de pavimentos ou quantidade de unidades inválido');
    return this.prisma.$transaction(async (db) => {
      const building = await this.building(context, buildingId, db);
      const plans = input.floorPlansByFinal ?? {};
      const planIds = [...new Set(Object.values(plans).filter(Boolean))];
      if (planIds.length && (await db.floorPlan.count({ where: { id: { in: planIds }, developmentId: building.developmentId } })) !== planIds.length) throw new BadRequestException('Planta não pertence ao empreendimento');
      const existing = new Set((await db.unit.findMany({ where: { buildingId }, select: { number: true } })).map((u) => u.number));
      let created = 0; let floorsCreated = 0;
      for (let n = input.from; n <= input.to; n++) {
        let floor = await db.floor.findUnique({ where: { buildingId_number: { buildingId, number: n } } });
        if (!floor) { floor = await db.floor.create({ data: { buildingId, number: n, sortOrder: n, name: n === 0 ? 'Térreo' : `${n}º pavimento` } }); floorsCreated++; }
        for (let i = 1; i <= input.perFloor; i++) {
          const final = String(i).padStart(2, '0');
          const number = unitNumber(input.pattern, n, i, building.code);
          if (!number || number.length > 20) throw new BadRequestException('Padrão de numeração inválido');
          if (existing.has(number)) continue;
          const unit = await db.unit.create({ data: { buildingId, floorId: floor.id, number, final } });
          await db.salesStatusHistory.create({ data: { unitId: unit.id, status: unit.status, changedById: context.userId, reason: 'Geração em lote' } });
          const planId = plans[final] ?? plans[String(i)];
          if (planId) await db.unitFloorPlan.create({ data: { unitId: unit.id, floorPlanId: planId, primary: true } });
          existing.add(number); created++;
        }
      }
      const floorCount = await db.floor.count({ where: { buildingId } });
      await db.building.update({ where: { id: buildingId }, data: { floorCount, unitsPerFloor: input.perFloor } });
      await this.audit(db, context, 'Building', buildingId, 'GENERATE_UNITS', { from: input.from, to: input.to, perFloor: input.perFloor, created, floorsCreated });
      return { created, floorsCreated, floorCount };
    }, { timeout: 60_000 });
  }

  // Unidades
  async listUnits(context: OrganizationContext, buildingId: string) {
    await this.building(context, buildingId);
    const units = await this.prisma.unit.findMany({ where: { buildingId }, include: { floor: true, unitType: true, floorPlans: { include: { floorPlan: true } }, assets: { select: { id: true, kind: true, originalName: true, mimeType: true } } }, orderBy: [{ floor: { sortOrder: 'asc' } }, { number: 'asc' }] });
    return units;
  }

  async createUnit(context: OrganizationContext, buildingId: string, input: UnitInput) {
    assertCanEdit(context);
    return this.prisma.$transaction(async (db) => {
      const building = await this.building(context, buildingId, db);
      if (input.floorId && !(await db.floor.findFirst({ where: { id: input.floorId, buildingId } }))) throw new BadRequestException('Pavimento não pertence à torre');
      if (input.unitTypeId && !(await db.unitType.findFirst({ where: { id: input.unitTypeId, developmentId: building.developmentId } }))) throw new BadRequestException('Tipologia não pertence ao empreendimento');
      const unit = await db.unit.create({ data: { buildingId, ...input } });
      await db.salesStatusHistory.create({ data: { unitId: unit.id, status: unit.status, changedById: context.userId, reason: 'Cadastro inicial' } });
      await this.audit(db, context, 'Unit', unit.id, 'CREATE', { number: unit.number, status: unit.status });
      return unit;
    });
  }

  async updateUnit(context: OrganizationContext, unitId: string, input: Partial<Omit<UnitInput, 'status'>>) {
    assertCanEdit(context);
    return this.prisma.$transaction(async (db) => {
      const current = await this.unit(context, unitId, db);
      if (input.floorId && !(await db.floor.findFirst({ where: { id: input.floorId, buildingId: current.buildingId } }))) throw new BadRequestException('Pavimento não pertence à torre');
      const updated = await db.unit.update({ where: { id: unitId }, data: input });
      await this.audit(db, context, 'Unit', unitId, 'UPDATE', { number: updated.number, price: updated.price?.toString() ?? null }, { number: current.number, price: current.price?.toString() ?? null });
      return updated;
    });
  }

  // Disponibilidade comercial: status e histórico gravados na mesma transação.
  async changeUnitStatus(context: OrganizationContext, unitId: string, status: UnitStatus, reason?: string) {
    assertCommercial(context);
    return this.prisma.$transaction(async (db) => {
      const current = await this.unit(context, unitId, db);
      if (current.status === status) return current;
      const result = await db.unit.updateMany({ where: { id: unitId, status: current.status }, data: { status } });
      if (result.count !== 1) throw new BadRequestException('Status da unidade foi alterado por outra operação; tente novamente');
      await db.salesStatusHistory.create({ data: { unitId, previousStatus: current.status, status, changedById: context.userId, reason } });
      await this.audit(db, context, 'Unit', unitId, 'STATUS_CHANGE', { status }, { status: current.status });
      return db.unit.findUniqueOrThrow({ where: { id: unitId } });
    });
  }

  async unitHistory(context: OrganizationContext, unitId: string) {
    await this.unit(context, unitId);
    return this.prisma.salesStatusHistory.findMany({ where: { unitId }, include: { changedBy: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' } });
  }

  // Plantas
  async listFloorPlans(context: OrganizationContext, developmentId: string) {
    await this.development(context, developmentId);
    return this.prisma.floorPlan.findMany({ where: { developmentId }, include: { assets: { select: { id: true, kind: true, originalName: true } }, _count: { select: { units: true } } }, orderBy: { name: 'asc' } });
  }

  async createFloorPlan(context: OrganizationContext, developmentId: string, input: FloorPlanInput) {
    assertCanEdit(context);
    return this.prisma.$transaction(async (db) => {
      await this.development(context, developmentId, db);
      const plan = await db.floorPlan.create({ data: { developmentId, ...input } });
      await this.audit(db, context, 'FloorPlan', plan.id, 'CREATE', { name: plan.name });
      return plan;
    });
  }

  async floorPlanLayout(context: OrganizationContext, floorPlanId: string) {
    const plan = await this.prisma.floorPlan.findFirst({ where: { id: floorPlanId, development: { organizationId: context.organizationId, archivedAt: null } }, include: { assets: { select: { id: true, kind: true, originalName: true, mimeType: true } } } });
    if (!plan) throw new NotFoundException('Planta não encontrada');
    return plan;
  }

  /** Arquivo de uma planta (imagem usada como fundo no editor de vetorização). */
  async floorPlanAsset(context: OrganizationContext, floorPlanId: string, assetId: string) {
    const plan = await this.floorPlanLayout(context, floorPlanId);
    const asset = await this.prisma.developmentAsset.findFirst({ where: { id: assetId, developmentId: plan.developmentId } });
    if (!asset || !asset.mimeType.startsWith('image/')) throw new NotFoundException('Imagem não encontrada');
    return { path: join(storageRoot(), asset.storageKey), mimeType: asset.mimeType };
  }

  /** Grava a planta vetorizada (paredes, portas, janelas e cômodos) usada na planta 3D mobiliada. */
  async saveFloorPlanLayout(context: OrganizationContext, floorPlanId: string, input: unknown) {
    assertCanEdit(context);
    const layout = input === null ? null : parsePlanLayout(input);
    return this.prisma.$transaction(async (db) => {
      const plan = await db.floorPlan.findFirst({ where: { id: floorPlanId, development: { organizationId: context.organizationId, archivedAt: null } } });
      if (!plan) throw new NotFoundException('Planta não encontrada');
      if (layout?.imageAssetId && !(await db.developmentAsset.findFirst({ where: { id: layout.imageAssetId, developmentId: plan.developmentId } }))) throw new BadRequestException('Imagem não pertence ao empreendimento');
      const updated = await db.floorPlan.update({ where: { id: floorPlanId }, data: { layout: layout ? (layout as unknown as Prisma.InputJsonValue) : Prisma.DbNull } });
      await this.audit(db, context, 'FloorPlan', floorPlanId, 'LAYOUT', layout ? { walls: layout.walls.length, openings: layout.openings.length, rooms: layout.rooms.length } : { removed: true });
      return updated;
    });
  }

  async linkFloorPlan(context: OrganizationContext, unitId: string, floorPlanId: string, primary = false) {
    assertCanEdit(context);
    return this.prisma.$transaction(async (db) => {
      const unit = await this.unit(context, unitId, db);
      if (!(await db.floorPlan.findFirst({ where: { id: floorPlanId, developmentId: unit.building.developmentId } }))) throw new BadRequestException('Planta não pertence ao empreendimento');
      if (primary) await db.unitFloorPlan.updateMany({ where: { unitId }, data: { primary: false } });
      const link = await db.unitFloorPlan.upsert({ where: { unitId_floorPlanId: { unitId, floorPlanId } }, update: { primary }, create: { unitId, floorPlanId, primary } });
      await this.audit(db, context, 'UnitFloorPlan', `${unitId}:${floorPlanId}`, 'LINK', { primary });
      return link;
    });
  }

  // Modelos 3D (versões GLB) e configuração do visualizador
  async listModelVersions(context: OrganizationContext, developmentId: string) {
    await this.development(context, developmentId);
    const [versions, viewer] = await Promise.all([
      this.prisma.modelVersion.findMany({ where: { developmentId }, include: { asset: { select: { id: true, originalName: true, byteSize: true, checksum: true } } }, orderBy: { version: 'desc' } }),
      this.prisma.viewerConfiguration.findUnique({ where: { developmentId } }),
    ]);
    return versions.map((v) => ({ ...v, asset: { ...v.asset, byteSize: v.asset.byteSize.toString() }, active: viewer?.activeModelVersionId === v.id }));
  }

  async activateModelVersion(context: OrganizationContext, developmentId: string, modelVersionId: string) {
    assertCanEdit(context);
    return this.prisma.$transaction(async (db) => {
      await this.development(context, developmentId, db);
      const version = await db.modelVersion.findFirst({ where: { id: modelVersionId, developmentId } });
      if (!version) throw new NotFoundException('Versão do modelo não encontrada');
      const config = await db.viewerConfiguration.upsert({ where: { developmentId }, update: { activeModelVersionId: modelVersionId }, create: { developmentId, activeModelVersionId: modelVersionId } });
      await this.audit(db, context, 'ViewerConfiguration', config.id, 'ACTIVATE_MODEL', { modelVersionId, version: version.version });
      return config;
    });
  }

  async updateViewer(context: OrganizationContext, developmentId: string, input: { camera?: Prisma.InputJsonValue; lighting?: Prisma.InputJsonValue; interaction?: Prisma.InputJsonValue; publicLayout?: Prisma.InputJsonValue }) {
    assertCanEdit(context);
    return this.prisma.$transaction(async (db) => {
      await this.development(context, developmentId, db);
      const config = await db.viewerConfiguration.upsert({ where: { developmentId }, update: input, create: { developmentId, ...input } });
      await this.audit(db, context, 'ViewerConfiguration', config.id, 'UPDATE');
      return config;
    });
  }

  // Leads
  async listLeads(context: OrganizationContext, developmentId: string) {
    await this.development(context, developmentId);
    return this.prisma.lead.findMany({ where: { developmentId }, include: { unit: { select: { id: true, number: true } }, assignedTo: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' } });
  }

  async createLead(context: OrganizationContext, developmentId: string, input: LeadInput) {
    assertCommercial(context);
    return this.prisma.$transaction(async (db) => {
      await this.development(context, developmentId, db);
      if (input.unitId) { const unit = await this.unit(context, input.unitId, db); if (unit.building.developmentId !== developmentId) throw new BadRequestException('Unidade não pertence ao empreendimento'); }
      const { consent, ...data } = input;
      const lead = await db.lead.create({ data: { developmentId, ...data, consentAt: consent ? new Date() : undefined } });
      await this.audit(db, context, 'Lead', lead.id, 'CREATE', { source: lead.source ?? null });
      return lead;
    });
  }

  async updateLead(context: OrganizationContext, leadId: string, input: { status?: LeadStatus; notes?: string; assignedToId?: string }) {
    assertCommercial(context);
    return this.prisma.$transaction(async (db) => {
      const current = await db.lead.findFirst({ where: { id: leadId, development: { organizationId: context.organizationId } } });
      if (!current) throw new NotFoundException('Lead não encontrado');
      if (input.assignedToId && !(await db.organizationUser.findFirst({ where: { organizationId: context.organizationId, userId: input.assignedToId, active: true } }))) throw new BadRequestException('Responsável não pertence à organização');
      const updated = await db.lead.update({ where: { id: leadId }, data: input });
      await this.audit(db, context, 'Lead', leadId, 'UPDATE', { status: updated.status }, { status: current.status });
      return updated;
    });
  }

  private async assertAsset(db: Db, developmentId: string, assetId: string) {
    if (!(await db.developmentAsset.findFirst({ where: { id: assetId, developmentId } }))) throw new BadRequestException('Arquivo não pertence ao empreendimento');
  }
}
