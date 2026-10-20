import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}
  async summary(organizationId: string) {
    const [developments, buildings, units, availableUnits, reservedUnits, soldUnits, views, leads, aiJobs, storage] = await this.prisma.$transaction([
      this.prisma.development.count({ where: { organizationId, archivedAt: null } }),
      this.prisma.building.count({ where: { development: { organizationId } } }),
      this.prisma.unit.count({ where: { building: { development: { organizationId } } } }),
      this.prisma.unit.count({ where: { status: 'AVAILABLE', building: { development: { organizationId } } } }),
      this.prisma.unit.count({ where: { status: 'RESERVED', building: { development: { organizationId } } } }),
      this.prisma.unit.count({ where: { status: 'SOLD', building: { development: { organizationId } } } }),
      this.prisma.viewEvent.count({ where: { development: { organizationId } } }),
      this.prisma.lead.count({ where: { development: { organizationId } } }),
      this.prisma.generationJob.count({ where: { development: { organizationId }, kind: 'AI_EXTRACTION' } }),
      this.prisma.usageLedger.aggregate({ where: { organizationId, metric: 'STORAGE_BYTES' }, _sum: { quantity: true } }),
    ]);
    return { developments, buildings, units, availableUnits, reservedUnits, soldUnits, views, leads, aiJobs, storageBytes: storage._sum.quantity ?? 0 };
  }
}
