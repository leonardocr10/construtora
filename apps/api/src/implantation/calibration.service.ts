import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ControlPointSource, Prisma } from '@prisma/client';
import { calibrate, type CalibrationReport } from '@vistahub/geo';
import { OrganizationContext } from '../common/organization-context';
import { PrismaService } from '../common/prisma.service';
import { assertCanEdit } from '../common/roles';

export interface ControlPointInput { id?: string; label: string; pixel: [number, number]; latitude: number; longitude: number; source?: ControlPointSource; note?: string | null }

const finite = (...values: unknown[]) => values.every((v) => typeof v === 'number' && Number.isFinite(v));

/**
 * Calibração da implantação por pontos de controle (pixel da arte ↔ latitude/longitude verificada).
 * O ajuste é feito por `calibrate` (packages/geo), no referencial local cuja origem é a localização
 * do empreendimento. Aplicar grava escala, azimute e origem em ViewerConfiguration.publicLayout,
 * junto com o resumo da qualidade (situação, erro médio e máximo), nunca sem pontos suficientes.
 */
@Injectable()
export class CalibrationService {
  constructor(private readonly prisma: PrismaService) {}

  private async development(context: OrganizationContext, developmentId: string) {
    const found = await this.prisma.development.findFirst({ where: { id: developmentId, organizationId: context.organizationId, archivedAt: null } });
    if (!found) throw new NotFoundException('Empreendimento não encontrado');
    return found;
  }

  private toDto(p: { id: string; label: string; pixelX: Prisma.Decimal; pixelY: Prisma.Decimal; latitude: Prisma.Decimal; longitude: Prisma.Decimal; source: ControlPointSource; note: string | null }) {
    return { id: p.id, label: p.label, pixel: [p.pixelX.toNumber(), p.pixelY.toNumber()] as [number, number], latitude: p.latitude.toNumber(), longitude: p.longitude.toNumber(), source: p.source, note: p.note };
  }

  async list(context: OrganizationContext, developmentId: string) {
    await this.development(context, developmentId);
    const points = await this.prisma.layoutControlPoint.findMany({ where: { developmentId }, orderBy: { createdAt: 'asc' } });
    return points.map((p) => this.toDto(p));
  }

  /** Substitui a lista de pontos (criar, alterar, remover) numa transação, com auditoria. */
  async replace(context: OrganizationContext, developmentId: string, input: ControlPointInput[]) {
    assertCanEdit(context);
    await this.development(context, developmentId);
    if (input.length > 60) throw new BadRequestException('No máximo 60 pontos de controle');
    for (const p of input) {
      if (!p.label?.trim() || p.label.length > 120) throw new BadRequestException('Cada ponto precisa de um nome (até 120 caracteres)');
      if (!Array.isArray(p.pixel) || p.pixel.length !== 2 || !finite(p.pixel[0], p.pixel[1], p.latitude, p.longitude)) throw new BadRequestException(`Ponto "${p.label}": pixel ou coordenada inválida`);
      if (Math.abs(p.latitude) > 85 || Math.abs(p.longitude) > 180) throw new BadRequestException(`Ponto "${p.label}": latitude/longitude fora do intervalo`);
      if (p.source && !Object.values(ControlPointSource).includes(p.source)) throw new BadRequestException(`Ponto "${p.label}": origem inválida`);
    }
    return this.prisma.$transaction(async (db) => {
      const existing = await db.layoutControlPoint.findMany({ where: { developmentId } });
      const keep = new Set(input.filter((p) => p.id).map((p) => p.id!));
      if ([...keep].some((id) => !existing.some((e) => e.id === id))) throw new BadRequestException('Ponto de controle não pertence ao empreendimento');
      await db.layoutControlPoint.deleteMany({ where: { developmentId, id: { notIn: [...keep] } } });
      for (const p of input) {
        const data = { label: p.label.trim(), pixelX: p.pixel[0], pixelY: p.pixel[1], latitude: p.latitude, longitude: p.longitude, source: p.source ?? ControlPointSource.OSM, note: p.note?.trim() || null };
        if (p.id) await db.layoutControlPoint.update({ where: { id: p.id }, data });
        else await db.layoutControlPoint.create({ data: { developmentId, ...data } });
      }
      await db.auditLog.create({ data: { organizationId: context.organizationId, userId: context.userId, entityType: 'LayoutControlPoint', entityId: developmentId, action: 'REPLACE', before: { count: existing.length }, after: { count: input.length } } });
      const points = await db.layoutControlPoint.findMany({ where: { developmentId }, orderBy: { createdAt: 'asc' } });
      return points.map((p) => this.toDto(p));
    });
  }

  /** Calcula a calibração com os pontos gravados; com `apply`, grava o resultado na implantação. */
  async run(context: OrganizationContext, developmentId: string, options: { apply?: boolean; tolerance?: number; expectedMetersPerPixel?: number }) {
    const development = await this.development(context, developmentId);
    const lat = development.latitude?.toNumber(); const lng = development.longitude?.toNumber();
    if (lat == null || lng == null) throw new BadRequestException('Informe a latitude/longitude do empreendimento antes de calibrar (origem do referencial da cena)');
    const points = (await this.prisma.layoutControlPoint.findMany({ where: { developmentId }, orderBy: { createdAt: 'asc' } })).map((p) => this.toDto(p));
    const report: CalibrationReport = calibrate(points.map((p) => ({ id: p.id, label: p.label, pixel: p.pixel, geo: { lat: p.latitude, lng: p.longitude } })), { lat, lng }, { tolerance: options.tolerance, expectedMetersPerPixel: options.expectedMetersPerPixel });
    if (!options.apply) return { report, applied: false };

    assertCanEdit(context);
    if (!report.transform) throw new BadRequestException('Pontos insuficientes para calibrar');
    const viewer = await this.prisma.viewerConfiguration.findUnique({ where: { developmentId } });
    const current = (viewer?.publicLayout ?? {}) as Record<string, unknown>;
    const t = report.transform;
    const layout = {
      ...current,
      metersPerPixel: Math.round(t.metersPerPixel * 1e6) / 1e6,
      azimuth: Math.round(t.azimuth * 100) / 100,
      origin: [Math.round(t.origin[0] * 10) / 10, Math.round(t.origin[1] * 10) / 10],
      calibration: { status: report.status, rms: report.rms, maxError: report.maxError, points: points.length, warnings: report.warnings, computedAt: new Date().toISOString() },
    };
    await this.prisma.$transaction(async (db) => {
      const config = await db.viewerConfiguration.upsert({ where: { developmentId }, update: { publicLayout: layout as Prisma.InputJsonValue }, create: { developmentId, publicLayout: layout as Prisma.InputJsonValue } });
      const pick = (l: Record<string, unknown>) => ({ metersPerPixel: (l.metersPerPixel as number) ?? null, azimuth: (l.azimuth as number) ?? null, origin: (l.origin as number[]) ?? null });
      await db.auditLog.create({ data: { organizationId: context.organizationId, userId: context.userId, entityType: 'ViewerConfiguration', entityId: config.id, action: 'CALIBRATE', before: pick(current), after: { ...pick(layout), status: report.status, rms: report.rms } as Prisma.InputJsonValue } });
    });
    return { report, applied: true };
  }
}
