import 'dotenv/config';
import argon2 from 'argon2';
import { PrismaClient, OrganizationRole, SubscriptionPlan } from '@prisma/client';

const [organizationName, organizationSlug, name, email, password] = process.argv.slice(2);
if (![organizationName, organizationSlug, name, email, password].every(Boolean) || password.length < 12) {
  console.error('Uso: npm run provision:admin --workspace=@vistahub/api -- "Construtora Exemplo" construtora-exemplo "Nome Admin" admin@exemplo.com "senha-com-ao-menos-12-caracteres"');
  process.exit(1);
}
const prisma = new PrismaClient();
try {
  const passwordHash = await argon2.hash(password);
  const result = await prisma.$transaction(async (db) => {
    const organization = await db.organization.upsert({ where: { slug: organizationSlug }, update: { name: organizationName }, create: { name: organizationName, slug: organizationSlug } });
    const user = await db.user.upsert({ where: { email }, update: { name, passwordHash, active: true }, create: { name, email, passwordHash } });
    await db.organizationUser.upsert({ where: { organizationId_userId: { organizationId: organization.id, userId: user.id } }, update: { role: OrganizationRole.ADMIN, active: true }, create: { organizationId: organization.id, userId: user.id, role: OrganizationRole.ADMIN } });
    const current = await db.subscription.findFirst({ where: { organizationId: organization.id, active: true } });
    const plan = await db.plan.findUnique({ where: { code: SubscriptionPlan.BASIC } });
    if (!current) await db.subscription.create({ data: { organizationId: organization.id, plan: SubscriptionPlan.BASIC, planId: plan?.id, limits: { developments: plan?.maxDevelopments ?? 3, users: plan?.maxUsers ?? 3, storageBytes: Number(plan?.maxStorageBytes ?? 5_000_000_000n) } } });
    await db.creditWallet.upsert({ where: { organizationId: organization.id }, update: {}, create: { organizationId: organization.id, balance: plan?.monthlyCredits ?? 0 } });
    return { organizationId: organization.id, email: user.email };
  });
  console.log(`Administrador provisionado para a organização ${result.organizationId}: ${result.email}`);
} catch (error) {
  console.error(`Falha ao provisionar administrador: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
