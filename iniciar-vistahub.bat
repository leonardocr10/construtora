@echo off
setlocal EnableExtensions
title VistaHub - Inicializador
cd /d "%~dp0"

echo.
echo === VistaHub - inicializacao local ===
echo.

where node >nul 2>nul
if errorlevel 1 call :install_node
where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao esta disponivel nesta sessao.
  echo Feche este terminal e execute o arquivo novamente apos a instalacao.
  pause
  exit /b 1
)

if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  node -e "const fs=require('fs'),c=require('crypto');const p='.env',password='vistahub_local_'+c.randomBytes(12).toString('hex'),root='vistahub_root_'+c.randomBytes(12).toString('hex'),access=c.randomBytes(48).toString('base64url'),refresh=c.randomBytes(48).toString('base64url');let s=fs.readFileSync(p,'utf8').replaceAll('troque-esta-senha-local',password).replaceAll('troque-esta-senha-root-local',root).replaceAll('gere-um-segredo-aleatorio-longo',access).replaceAll('gere-outro-segredo-aleatorio-longo',refresh);s=s.replace(/^LOCAL_STORAGE_PATH=.*$/m,'LOCAL_STORAGE_PATH='+require('path').resolve('storage').split(require('path').sep).join('/'));fs.writeFileSync(p,s);"
  echo [OK] Arquivo .env configurado com segredos locais aleatorios.
)

rem O cmd interpreta %% em valores de URL. Carregamos somente as credenciais usadas aqui;
rem Prisma le DATABASE_URL e SHADOW_DATABASE_URL diretamente do arquivo .env.
set "DATABASE_URL="
set "SHADOW_DATABASE_URL="
for /f "tokens=1,* delims==" %%A in ('findstr /R /B /C:"MYSQL_DATABASE=" /C:"MYSQL_USER=" /C:"MYSQL_PASSWORD=" /C:"MYSQL_ROOT_PASSWORD=" /C:"MYSQL_BIN=" ".env"') do set "%%A=%%B"

where mysql >nul 2>nul
if errorlevel 1 call :find_mysql
where mysql >nul 2>nul
if errorlevel 1 call :install_mysql
where mysql >nul 2>nul
if errorlevel 1 (
  echo [ERRO] MySQL nao esta disponivel nesta sessao.
  echo Conclua o assistente de configuracao do MySQL e execute este arquivo novamente.
  pause
  exit /b 1
)

echo [1/5] Verificando o servico MySQL...
sc query MySQL80 >nul 2>nul
if not errorlevel 1 net start MySQL80 >nul 2>nul

set "MYSQL_PWD=%MYSQL_ROOT_PASSWORD%"
mysql --protocol=TCP -h 127.0.0.1 -u root -e "SELECT 1" >nul 2>nul
if errorlevel 1 (
  set "MYSQL_PWD="
  echo [ERRO] Nao foi possivel acessar o MySQL com o usuario root.
  echo Confirme que o servidor esta em execucao e ajuste MYSQL_ROOT_PASSWORD no arquivo .env.
  pause
  exit /b 1
)

echo [2/5] Criando banco, banco de sombra e usuario local...
if /I "%MYSQL_USER%"=="root" (
  mysql --protocol=TCP -h 127.0.0.1 -u root -e "CREATE DATABASE IF NOT EXISTS `%MYSQL_DATABASE%` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE DATABASE IF NOT EXISTS `%MYSQL_DATABASE%_shadow` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
) else (
  mysql --protocol=TCP -h 127.0.0.1 -u root -e "CREATE DATABASE IF NOT EXISTS `%MYSQL_DATABASE%` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE DATABASE IF NOT EXISTS `%MYSQL_DATABASE%_shadow` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER IF NOT EXISTS '%MYSQL_USER%'@'localhost' IDENTIFIED BY '%MYSQL_PASSWORD%'; CREATE USER IF NOT EXISTS '%MYSQL_USER%'@'127.0.0.1' IDENTIFIED BY '%MYSQL_PASSWORD%'; ALTER USER '%MYSQL_USER%'@'localhost' IDENTIFIED BY '%MYSQL_PASSWORD%'; ALTER USER '%MYSQL_USER%'@'127.0.0.1' IDENTIFIED BY '%MYSQL_PASSWORD%'; GRANT ALL PRIVILEGES ON `%MYSQL_DATABASE%`.* TO '%MYSQL_USER%'@'localhost'; GRANT ALL PRIVILEGES ON `%MYSQL_DATABASE%`.* TO '%MYSQL_USER%'@'127.0.0.1'; GRANT ALL PRIVILEGES ON `%MYSQL_DATABASE%_shadow`.* TO '%MYSQL_USER%'@'localhost'; GRANT ALL PRIVILEGES ON `%MYSQL_DATABASE%_shadow`.* TO '%MYSQL_USER%'@'127.0.0.1'; FLUSH PRIVILEGES;"
)
if errorlevel 1 goto :mysql_failed
set "MYSQL_PWD="

echo [3/5] Encerrando instancias antigas da API e do painel...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-vistahub.ps1"
timeout /t 2 /nobreak >nul

echo [4/5] Instalando/atualizando dependencias Node.js...
call npm install --no-audit --no-fund
if errorlevel 1 goto :failed

echo [5/5] Restaurando os dados (banco vazio), gerando cliente Prisma e aplicando migrations...
call npm run db:restore
if errorlevel 1 goto :failed
call npm run prisma:generate
if errorlevel 1 goto :failed
call npm run db:init
if errorlevel 1 goto :failed

echo Abrindo API e painel...
start "VistaHub API" /D "%~dp0" cmd /k npm run dev:api
start "VistaHub Painel" /D "%~dp0" cmd /k npm run dev:admin
start "VistaHub Visualizador 3D" /D "%~dp0" cmd /k npm run dev:viewer

echo Aguardando a API responder...
powershell -NoProfile -Command "for($i=0;$i -lt 60;$i++){ try { Invoke-WebRequest -UseBasicParsing http://localhost:3000/api/v1/health/db -TimeoutSec 2 | Out-Null; exit 0 } catch { Start-Sleep 2 } }; exit 1"
if errorlevel 1 (echo [AVISO] A API ainda nao respondeu. Veja a janela "VistaHub API".) else (echo [OK] API conectada ao MySQL.)

echo Aguardando o painel...
powershell -NoProfile -Command "for($i=0;$i -lt 90;$i++){ try { Invoke-WebRequest -UseBasicParsing http://localhost:4200 -TimeoutSec 2 | Out-Null; exit 0 } catch { Start-Sleep 2 } }; exit 1"
if errorlevel 1 (echo [AVISO] O painel ainda nao respondeu. Veja a janela "VistaHub Painel".) else (start "" http://localhost:4200)

echo.
echo Servicos iniciados. Painel: http://localhost:4200
echo Visualizador 3D: http://localhost:4300/union-vista
echo Documentacao da API: http://localhost:3000/api/docs
exit /b 0

:mysql_failed
set "MYSQL_PWD="
echo [ERRO] Nao foi possivel configurar o banco de dados local.
echo Verifique MYSQL_DATABASE, MYSQL_USER e MYSQL_PASSWORD no arquivo .env.
pause
exit /b 1

:failed
echo.
echo A inicializacao foi interrompida. Revise as mensagens acima e tente novamente.
pause
exit /b 1

:install_node
echo Node.js nao encontrado. Tentando instalar a versao LTS pelo winget...
where winget >nul 2>nul
if errorlevel 1 (
  echo [ERRO] winget nao esta disponivel. Instale Node.js LTS manualmente em https://nodejs.org/
  exit /b 1
)
winget install --id OpenJS.NodeJS.LTS --exact --accept-source-agreements --accept-package-agreements
if errorlevel 1 exit /b 1
set "PATH=%ProgramFiles%\nodejs;%PATH%"
exit /b 0

:install_mysql
echo MySQL nao encontrado. Tentando instalar MySQL 8 pelo winget...
where winget >nul 2>nul
if errorlevel 1 (
  echo [ERRO] winget nao esta disponivel. Se o MySQL ja esta instalado, coloque a pasta bin dele em MYSQL_BIN no .env.
  exit /b 1
)
winget install --id Oracle.MySQL --exact --accept-source-agreements --accept-package-agreements
if errorlevel 1 exit /b 1
echo MySQL instalado. Conclua o assistente, defina a senha root no .env e execute este arquivo novamente.
exit /b 0

:find_mysql
rem MYSQL_BIN do .env, servico do Windows (mysqld/mariadbd) ou instalacoes comuns (MySQL, MariaDB, XAMPP, Laragon, Wamp).
for /f "usebackq delims=" %%D in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\find-mysql.ps1" -Hint "%MYSQL_BIN%"`) do set "PATH=%%D;%PATH%"
exit /b 0
