// Inicializa o banco do VistaHub: valida a conexão, aplica migrations versionadas,
// grava dados de referência (planos) e, opcionalmente, cria o primeiro administrador.
// Uso:
//   npm run db:init
//   npm run db:init -- --admin "Construtora X" construtora-x "Nome Admin" admin@x.com "senha-com-12+"
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schema = join(root, 'prisma', 'schema.prisma');

function run(label, command, args) {
  console.log(`\n> ${label}`);
  // npx é um .cmd no Windows e precisa de shell; nesse caso o comando vai como string única.
  const result = Array.isArray(args) ? spawnSync(command, args, { cwd: root, stdio: 'inherit' }) : spawnSync(`${command} ${args}`, { cwd: root, stdio: 'inherit', shell: true });
  if (result.status !== 0) { console.error(`Falha em: ${label}`); process.exit(result.status ?? 1); }
}

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL não definida. Copie .env.example para .env e ajuste a conexão.'); process.exit(1); }
const target = new URL(process.env.DATABASE_URL);
console.log(`Banco alvo: ${target.hostname}:${target.port || 3306}${target.pathname}`);

// migrate deploy cria o banco se ele não existir e aplica apenas migrations pendentes (seguro em produção).
run('Aplicando migrations', 'npx', `prisma migrate deploy --schema "${schema}"`);
run('Gerando Prisma Client', 'npx', `prisma generate --schema "${schema}"`);

const { PrismaClient, SubscriptionPlan } = await import('@prisma/client');
const prisma = new PrismaClient();
try {
  const plans = [
    { code: SubscriptionPlan.BASIC, name: 'Básico', monthlyPrice: 0, monthlyCredits: 50, maxDevelopments: 3, maxUsers: 3, maxStorageBytes: 5_000_000_000n },
    { code: SubscriptionPlan.PROFESSIONAL, name: 'Profissional', monthlyPrice: 0, monthlyCredits: 300, maxDevelopments: 15, maxUsers: 15, maxStorageBytes: 50_000_000_000n },
    { code: SubscriptionPlan.ENTERPRISE, name: 'Enterprise', monthlyPrice: 0, monthlyCredits: 2000, maxDevelopments: 1000, maxUsers: 500, maxStorageBytes: 1_000_000_000_000n },
  ];
  await prisma.$transaction(plans.map(({ code, ...data }) => prisma.plan.upsert({ where: { code }, update: {}, create: { code, ...data } })));
  console.log('\n> Planos de referência garantidos (preços zerados; ajuste na tabela Plan).');
} finally { await prisma.$disconnect(); }

const adminIndex = process.argv.indexOf('--admin');
if (adminIndex !== -1) run('Criando primeiro administrador', process.execPath, [join(root, 'scripts', 'provision-admin.mjs'), ...process.argv.slice(adminIndex + 1)]);
else console.log('\nPara criar o primeiro administrador: npm run db:init -- --admin "Construtora" slug "Nome" email "senha-com-12+"');

run('Verificando banco', process.execPath, [join(root, 'scripts', 'check-database.mjs')]);
console.log('\nBanco pronto.');
