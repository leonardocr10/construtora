# Imprime a pasta bin que contem o mysql.exe (cliente do MySQL ou MariaDB), ou nada se nao encontrar.
# Ordem: MYSQL_BIN (parametro), servico do Windows que roda o mysqld/mariadbd, instalacoes comuns.
param([string]$Hint)

function Test-Bin([string]$dir) { $dir -and (Test-Path (Join-Path $dir 'mysql.exe')) }

if (Test-Bin $Hint) { $Hint; exit 0 }

# Servicos (MySQL80, MySQL84, MariaDB, wampmysqld...): o executavel do servidor fica na mesma pasta bin do cliente.
foreach ($service in Get-CimInstance Win32_Service | Where-Object { $_.PathName -match 'mysqld|mariadbd' }) {
  $path = $service.PathName
  if ($path -match '^"([^"]+)"') { $path = $Matches[1] } else { $path = ($path -split ' ')[0] }
  $dir = Split-Path $path
  if (Test-Bin $dir) { $dir; exit 0 }
}

$patterns = @(
  "$env:ProgramFiles\MySQL\MySQL Server *\bin",
  "${env:ProgramFiles(x86)}\MySQL\MySQL Server *\bin",
  "$env:ProgramFiles\MariaDB *\bin",
  'C:\xampp\mysql\bin',
  'C:\laragon\bin\mysql\*\bin',
  'C:\wamp64\bin\mysql\*\bin'
)
foreach ($pattern in $patterns) {
  foreach ($dir in Get-Item $pattern -ErrorAction SilentlyContinue | Sort-Object FullName -Descending) {
    if (Test-Bin $dir.FullName) { $dir.FullName; exit 0 }
  }
}
