import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
try {
  await prisma.$queryRaw`SELECT 1`;
  // Lista derivada do schema Prisma: toda tabela modelada precisa existir.
  const { Prisma } = await import('@prisma/client');
  const requiredTables = Object.values(Prisma.ModelName).map((name) => name.toLowerCase());
  const rows = await prisma.$queryRaw`SELECT table_name AS tableName FROM information_schema.tables WHERE table_schema = DATABASE()`;
  const available = new Set(rows.map((row) => String(row.tableName ?? row.TABLE_NAME).toLowerCase()));
  const missing = requiredTables.filter((table) => !available.has(table));
  if (missing.length) throw new Error(`Tabelas obrigatórias ausentes: ${missing.join(', ')}`);
  const [pending] = await prisma.$queryRaw`SELECT COUNT(*) AS total FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL`;
  if (Number(pending.total) > 0) throw new Error('Há migrations com falha/pendentes em _prisma_migrations; use prisma migrate resolve');
  console.log(`MySQL conectado e ${requiredTables.length} tabelas verificadas.`);
} catch (error) {
  console.error(`Falha na verificação do banco: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
