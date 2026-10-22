// Restaura database/vistahub.sql no banco da DATABASE_URL (dados completos do VistaHub).
// Por segurança só restaura num banco vazio; com --replace apaga e recria o banco antes.
// Uso: npm run db:restore            (banco vazio)
//      npm run db:restore -- --replace
import 'dotenv/config';
import { existsSync, createReadStream } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { connection, dumpFile, mysqlTool } from './db-dump-tools.mjs';

if (!existsSync(dumpFile)) { console.error(`Arquivo ${dumpFile} não encontrado.`); process.exit(1); }
const mysql = mysqlTool('mysql');
// Root quando a senha do .env funciona; senão, o usuário do app (que já tem acesso total ao próprio banco).
let { database, args, env } = connection({ preferRoot: true });
if (spawnSync(mysql, [...args, '-e', 'SELECT 1'], { env, stdio: 'ignore' }).status !== 0) ({ database, args, env } = connection());
const sql = (query) => spawnSync(mysql, [...args, '-N', '-e', query], { env, encoding: 'utf8' });

const replace = process.argv.includes('--replace');
const create = sql(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
if (create.status !== 0) { console.error(create.stderr || 'Não foi possível acessar o MySQL.'); process.exit(1); }
const tables = Number(sql(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${database}'`).stdout.trim() || 0);
if (tables > 0 && !replace) {
  console.log(`O banco "${database}" já tem ${tables} tabelas: nada foi alterado. Para substituir pelos dados do dump: npm run db:restore -- --replace`);
  process.exit(0);
}
if (tables > 0) {
  const reset = sql(`DROP DATABASE \`${database}\`; CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  if (reset.status !== 0) { console.error(reset.stderr); process.exit(1); }
}

console.log(`Restaurando ${dumpFile} em "${database}"...`);
const load = spawn(mysql, [...args, '--default-character-set=utf8mb4', database], { env, stdio: ['pipe', 'inherit', 'inherit'] });
createReadStream(dumpFile).pipe(load.stdin);
load.on('close', (code) => {
  if (code !== 0) { console.error('Falha ao restaurar o banco.'); process.exit(code ?? 1); }
  console.log('Banco restaurado. Os arquivos (GLB, imagens) vêm da pasta storage/ do repositório; confira LOCAL_STORAGE_PATH no .env.');
});
