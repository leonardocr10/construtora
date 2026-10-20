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
  node -e "const fs=require('fs'),c=require('crypto');const p='.env',password='vistahub_local_'+c.randomBytes(12).toString('hex'),root='vistahub_root_'+c.randomBytes(12).toString('hex'),access=c.randomBytes(48).toString('base64url'),refresh=c.randomBytes(48).toString('base64url');let s=fs.readFileSync(p,'utf8').replaceAll('troque-esta-senha-local',password).replaceAll('troque-esta-senha-root-local',root).replaceAll('gere-um-segredo-aleatorio-longo',access).replaceAll('gere-outro-segredo-aleatorio-longo',refresh);fs.writeFileSync(p,s);"
  echo [OK] Arquivo .env configurado com segredos locais aleatorios.
)

rem O cmd interpreta %% em valores de URL. Carregamos somente as credenciais usadas aqui;
rem Prisma le DATABASE_URL e SHADOW_DATABASE_URL diretamente do arquivo .env.
set "DATABASE_URL="
set "SHADOW_DATABASE_URL="
for /f "tokens=1,* delims==" %%A in ('findstr /R /B /C:"MYSQL_DATABASE=" /C:"MYSQL_USER=" /C:"MYSQL_PASSWORD=" /C:"MYSQL_ROOT_PASSWORD=" ".env"') do set "%%A=%%B"

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

echo [1/4] Verificando o servico MySQL...
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

echo [2/4] Criando banco, banco de sombra e usuario local...
if /I "%MYSQL_USER%"=="root" (
  mysql --protocol=TCP -h 127.0.0.1 -u root -e "CREATE DATABASE IF NOT EXISTS `%MYSQL_DATABASE%` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE DATABASE IF NOT EXISTS `%MYSQL_DATABASE%_shadow` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
) else (
  mysql --protocol=TCP -h 127.0.0.1 -u root -e "CREATE DATABASE IF NOT EXISTS `%MYSQL_DATABASE%` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE DATABASE IF NOT EXISTS `%MYSQL_DATABASE%_shadow` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER IF NOT EXISTS '%MYSQL_USER%'@'localhost' IDENTIFIED BY '%MYSQL_PASSWORD%'; CREATE USER IF NOT EXISTS '%MYSQL_USER%'@'127.0.0.1' IDENTIFIED BY '%MYSQL_PASSWORD%'; ALTER USER '%MYSQL_USER%'@'localhost' IDENTIFIED BY '%MYSQL_PASSWORD%'; ALTER USER '%MYSQL_USER%'@'127.0.0.1' IDENTIFIED BY '%MYSQL_PASSWORD%'; GRANT ALL PRIVILEGES ON `%MYSQL_DATABASE%`.* TO '%MYSQL_USER%'@'localhost'; GRANT ALL PRIVILEGES ON `%MYSQL_DATABASE%`.* TO '%MYSQL_USER%'@'127.0.0.1'; GRANT ALL PRIVILEGES ON `%MYSQL_DATABASE%_shadow`.* TO '%MYSQL_USER%'@'localhost'; GRANT ALL PRIVILEGES ON `%MYSQL_DATABASE%_shadow`.* TO '%MYSQL_USER%'@'127.0.0.1'; FLUSH PRIVILEGES;"
)
if errorlevel 1 goto :mysql_failed
set "MYSQL_PWD="

if not exist "node_modules" (
  echo [3/4] Instalando dependencias Node.js...
  call npm install
  if errorlevel 1 goto :failed
)

echo [4/4] Gerando cliente Prisma e aplicando migrations...
if not exist "node_modules\.prisma\client\query_engine-windows.dll.node" (
  call npm run prisma:generate
  if errorlevel 1 goto :failed
)
call npm run db:init
if errorlevel 1 goto :failed

echo Abrindo API e painel...
netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul
if errorlevel 1 (start "VistaHub API" /D "%~dp0" cmd /k npm run dev:api) else (echo API ja esta em execucao na porta 3000.)
netstat -ano | findstr /R /C:":4200 .*LISTENING" >nul
if errorlevel 1 (start "VistaHub Painel" /D "%~dp0" cmd /k npm run dev:admin) else (echo Painel ja esta em execucao na porta 4200.)
echo.
echo Servicos iniciados. Painel: http://localhost:4200
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
  echo [ERRO] winget nao esta disponivel. Instale MySQL Server 8 manualmente.
  exit /b 1
)
winget install --id Oracle.MySQL --exact --accept-source-agreements --accept-package-agreements
if errorlevel 1 exit /b 1
echo MySQL instalado. Conclua o assistente, defina a senha root no .env e execute este arquivo novamente.
exit /b 0

:find_mysql
for %%D in ("%ProgramFiles%\MySQL\MySQL Server 8.4\bin" "%ProgramFiles%\MySQL\MySQL Server 8.0\bin" "%ProgramFiles(x86)%\MySQL\MySQL Server 8.4\bin" "%ProgramFiles(x86)%\MySQL\MySQL Server 8.0\bin") do (
  if exist "%%~D\mysql.exe" set "PATH=%%~D;%PATH%"
)
exit /b 0
