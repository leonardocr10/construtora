// Carrega um .env e executa um comando com essas variáveis.
// Uso: node scripts/with-env.mjs <arquivo.env> <comando> [args...]
// Substitui o `dotenv -e`: o nome `dotenv` em node_modules/.bin é disputado
// pelo dotenv-cli e pelo dotenv@18 (via @nestjs/config), e qual vence depende da instalação.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const [envFile, command, ...args] = process.argv.slice(2);
if (!envFile || !command) {
  console.error('Uso: node scripts/with-env.mjs <arquivo.env> <comando> [args...]');
  process.exit(1);
}

// Variáveis já definidas no ambiente têm prioridade sobre o arquivo, como no dotenv-cli.
if (existsSync(envFile)) process.loadEnvFile(envFile);

// Shell para achar os .cmd de node_modules/.bin no Windows; a linha vai montada
// e com aspas, porque passar args separados com shell está depreciado (DEP0190).
const quote = (value) => (/[\s"&|<>^()]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value);
const child = spawn([command, ...args].map(quote).join(' '), { stdio: 'inherit', shell: true });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
