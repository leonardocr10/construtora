# Encerra instancias locais da API (porta 3000) e do painel (porta 4200) deste projeto.
# Instancias antigas seguram a porta (EADDRINUSE) e travam a DLL do Prisma (EPERM).
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ids = @()
foreach ($port in 3000, 4200) {
  $ids += (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).OwningProcess
}
$ids += (Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
  $_.CommandLine -and $_.CommandLine.Contains($root) -and $_.CommandLine -match 'nest|ng\.js|dist.main'
}).ProcessId
$ids = $ids | Where-Object { $_ } | Select-Object -Unique
foreach ($id in $ids) { taskkill /PID $id /T /F *> $null }
if ($ids) { Write-Host "Encerradas $($ids.Count) instancia(s) antiga(s)." } else { Write-Host 'Nenhuma instancia em execucao.' }
