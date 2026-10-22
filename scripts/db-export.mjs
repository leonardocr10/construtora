// Exporta o banco inteiro para database/vistahub.sql (estrutura + dados + _prisma_migrations), para versionar
// junto com a pasta storage/ e restaurar em outra máquina com "npm run db:restore" (ou iniciar-vistahub.bat).
// Uso: npm run db:export
import 'dotenv/config';
import { mkdirSync, createWriteStream, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { connection, dumpFile, mysqlTool } from './db-dump-tools.mjs';

const { database, args, env } = connection();
mkdirSync(dirname(dumpFile), { recursive: true });
const out = createWriteStream(dumpFile);
// Sem CREATE DATABASE: o dump entra em qualquer nome de banco. --skip-dump-date deixa o diff do git limpo.
const dump = spawn(mysqlTool('mysqldump'), [...args, '--single-transaction', '--no-tablespaces', '--set-gtid-purged=OFF', '--routines', '--triggers',
  '--default-character-set=utf8mb4', '--hex-blob', '--skip-dump-date', '--skip-extended-insert', '--complete-insert', database], { env, stdio: ['ignore', 'pipe', 'inherit'] });
dump.stdout.pipe(out);
dump.on('close', (code) => {
  out.end(() => {
    if (code !== 0) { console.error('Falha ao exportar o banco.'); process.exit(code ?? 1); }
    console.log(`Banco "${database}" exportado para ${dumpFile} (${(statSync(dumpFile).size / 1048576).toFixed(1)} MB).`);
    console.log('Versione também a pasta storage/ (arquivos enviados: GLB das torres, imagens, plantas).');
  });
});
