import 'dotenv/config';
import argon2 from 'argon2';
import { PrismaClient, OrganizationRole, UnitStatus } from '@prisma/client';

const prisma = new PrismaClient();
try {
  const passwordHash = await argon2.hash('VistaHubDemo2026!');
  await prisma.$transaction(async (db) => {
    const organization = await db.organization.upsert({ where: { slug: 'vistahub-demonstracao' }, update: { name: 'Construtora Demonstração' }, create: { name: 'Construtora Demonstração', slug: 'vistahub-demonstracao' } });
    const user = await db.user.upsert({ where: { email: 'demo@vistahub.local' }, update: { name: 'Administrador Demonstração', passwordHash, active: true }, create: { name: 'Administrador Demonstração', email: 'demo@vistahub.local', passwordHash } });
    await db.organizationUser.upsert({ where: { organizationId_userId: { organizationId: organization.id, userId: user.id } }, update: { role: OrganizationRole.ADMIN, active: true }, create: { organizationId: organization.id, userId: user.id, role: OrganizationRole.ADMIN } });
    const development = await db.development.upsert({ where: { slug: 'residencial-demonstracao' }, update: { organizationId: organization.id, name: 'Residencial Demonstração', status: 'DRAFT' }, create: { organizationId: organization.id, name: 'Residencial Demonstração', slug: 'residencial-demonstracao', city: 'Cidade Exemplo', state: 'SP', status: 'DRAFT' } });
    await db.developmentSettings.upsert({ where: { developmentId: development.id }, update: {}, create: { developmentId: development.id } });
    await db.developmentTheme.upsert({ where: { developmentId: development.id }, update: {}, create: { developmentId: development.id } });
    const building = await db.building.upsert({ where: { developmentId_code: { developmentId: development.id, code: 'TORRE-01' } }, update: { name: 'Torre 01' }, create: { developmentId: development.id, code: 'TORRE-01', name: 'Torre 01' } });
    for (const floorNumber of [1, 2]) {
      const floor = await db.floor.upsert({ where: { buildingId_number: { buildingId: building.id, number: floorNumber } }, update: {}, create: { buildingId: building.id, number: floorNumber, sortOrder: floorNumber, name: `${floorNumber}º pavimento` } });
      await db.unit.createMany({ data: [1, 2].map((finalNumber) => ({ buildingId: building.id, floorId: floor.id, number: `${floorNumber}${String(finalNumber).padStart(2, '0')}`, final: String(finalNumber).padStart(2, '0'), status: UnitStatus.AVAILABLE })), skipDuplicates: true });
    }
    const plan = await db.floorPlan.findFirst({ where: { developmentId: development.id, code: 'TIPO-A' } }) ?? await db.floorPlan.create({ data: { developmentId: development.id, name: 'Planta Tipo A', code: 'TIPO-A', area: 68.5, bedrooms: 2, suites: 1, bathrooms: 2, parkingSpaces: 1 } });
    const units = await db.unit.findMany({ where: { buildingId: building.id } });
    for (const unit of units) {
      await db.unitFloorPlan.upsert({ where: { unitId_floorPlanId: { unitId: unit.id, floorPlanId: plan.id } }, update: {}, create: { unitId: unit.id, floorPlanId: plan.id, primary: true } });
      if (!(await db.salesStatusHistory.findFirst({ where: { unitId: unit.id } }))) await db.salesStatusHistory.create({ data: { unitId: unit.id, status: unit.status, reason: 'Seed demonstrativo' } });
    }
    if (!(await db.lead.findFirst({ where: { developmentId: development.id, email: 'lead.demo@vistahub.local' } }))) await db.lead.create({ data: { developmentId: development.id, unitId: units[0]?.id, name: 'Lead Demonstração', phone: '+55 11 90000-0000', email: 'lead.demo@vistahub.local', source: 'seed-demo' } });
    await db.creditWallet.upsert({ where: { organizationId: organization.id }, update: {}, create: { organizationId: organization.id, balance: 50 } });
  });
  console.log('Seed demonstrativo concluído. Dados criados: Construtora Demonstração e Residencial Demonstração.');
} catch (error) {
  console.error(`Falha ao criar seed demonstrativo: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
