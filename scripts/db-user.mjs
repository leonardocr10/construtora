// Garante que o usuário do MySQL da DATABASE_URL existe, com a mesma senha da URL e acesso ao banco
// principal e ao de sombra. A URL é a fonte da verdade: é com ela que o Prisma e a API se conectam,
// então um MYSQL_PASSWORD diferente no .env não deixa mais o banco inacessível (erro P1000).
// Usa o root (MYSQL_ROOT_PASSWORD). Uso: node scripts/db-user.mjs
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { connection, mysqlTool, root } from './db-dump-tools.mjs';

// Sem dependências do npm: roda no instalador antes do npm install.
const envFile = join(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const url = new URL(process.env.DATABASE_URL ?? '');
const user = decodeURIComponent(url.username), password = decodeURIComponent(url.password);
const database = decodeURIComponent(url.pathname.slice(1));
const shadow = process.env.SHADOW_DATABASE_URL ? decodeURIComponent(new URL(process.env.SHADOW_DATABASE_URL).pathname.slice(1)) : `${database}_shadow`;
if (user === 'root') { console.log('DATABASE_URL usa o root: nenhum usuário a criar.'); process.exit(0); }

const mysql = mysqlTool('mysql');
const admin = connection({ preferRoot: true });
if (admin.args.at(-1) !== 'root') { console.error('Defina MYSQL_ROOT_PASSWORD no .env para criar o usuário do banco.'); process.exit(1); }

const literal = (value) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const name = (value) => `\`${value.replace(/`/g, '``')}\``;
// localhost e 127.0.0.1 cobrem o IPv4; ::1 cobre o "localhost" resolvido em IPv6 pelo Prisma no Windows.
const statements = ['localhost', '127.0.0.1', '::1'].flatMap((host) => {
  const account = `${literal(user)}@${literal(host)}`;
  return [
    `CREATE USER IF NOT EXISTS ${account} IDENTIFIED BY ${literal(password)}`,
    `ALTER USER ${account} IDENTIFIED BY ${literal(password)}`,
    `GRANT ALL PRIVILEGES ON ${name(database)}.* TO ${account}`,
    `GRANT ALL PRIVILEGES ON ${name(shadow)}.* TO ${account}`,
  ];
});
const setup = spawnSync(mysql, [...admin.args, '-e', [...statements, 'FLUSH PRIVILEGES'].join('; ')], { env: admin.env, encoding: 'utf8' });
if (setup.status !== 0) { console.error(setup.stderr || 'Não foi possível configurar o usuário do banco.'); process.exit(1); }

// Confere o login exatamente com as credenciais da URL.
const app = connection();
const check = spawnSync(mysql, [...app.args, '-e', 'SELECT 1', database], { env: app.env, encoding: 'utf8' });
if (check.status !== 0) { console.error(`O usuário "${user}" ainda não consegue entrar no banco "${database}":\n${check.stderr}`); process.exit(1); }
console.log(`Usuário "${user}" pronto, com a senha da DATABASE_URL, nos bancos "${database}" e "${shadow}".`);
