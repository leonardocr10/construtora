// Utilidades comuns de db-export.mjs e db-restore.mjs: localizar os executáveis do MySQL e ler a conexão do .env.
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
/** Dump versionado com o banco completo (estrutura, dados e histórico de migrations do Prisma). */
export const dumpFile = join(root, 'database', 'vistahub.sql');

/** Caminho de um executável do MySQL (mysql, mysqldump): PATH ou pastas padrão do instalador no Windows. */
export function mysqlTool(name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  if (spawnSync(exe, ['--version'], { stdio: 'ignore' }).status === 0) return exe;
  const bases = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);
  for (const base of bases) for (const version of ['8.4', '8.0', '9.0', '9.1']) {
    const candidate = join(base, 'MySQL', `MySQL Server ${version}`, 'bin', exe);
    if (existsSync(candidate)) return candidate;
  }
  console.error(`Não encontrei o ${name}. Instale o MySQL Server 8 ou coloque a pasta bin dele no PATH.`);
  process.exit(1);
}

/**
 * Conexão do .env. Com MYSQL_ROOT_PASSWORD usa o root (pode recriar o banco); senão, o usuário da DATABASE_URL.
 * A senha vai por MYSQL_PWD (não aparece na linha de comando).
 */
export function connection({ preferRoot = false } = {}) {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL não definida. Copie .env.example para .env e ajuste a conexão.'); process.exit(1); }
  const url = new URL(process.env.DATABASE_URL);
  const database = decodeURIComponent(url.pathname.slice(1));
  const root = preferRoot && process.env.MYSQL_ROOT_PASSWORD && !/troque-esta/.test(process.env.MYSQL_ROOT_PASSWORD);
  const user = root ? 'root' : decodeURIComponent(url.username);
  const password = root ? process.env.MYSQL_ROOT_PASSWORD : decodeURIComponent(url.password);
  const host = url.hostname === 'localhost' ? '127.0.0.1' : url.hostname;
  return { database, args: ['--protocol=TCP', '-h', host, '-P', url.port || '3306', '-u', user], env: { ...process.env, MYSQL_PWD: password } };
}
