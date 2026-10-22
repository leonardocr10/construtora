# Encerra instancias da API (3000), do painel (4200) e do visualizador 3D (4300) DESTE projeto.
# Instancias antigas seguram a porta (EADDRINUSE) e travam a DLL do Prisma (EPERM).
# So encerra processos cuja linha de comando esta dentro desta pasta: num servidor com outros projetos,
# um programa de outro sistema na mesma porta nao e tocado (o .bat avisa quando a porta estiver ocupada).
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ours = @{}
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($root) } | ForEach-Object { $ours[[int]$_.ProcessId] = $true }
$ids = @()
foreach ($port in 3000, 4200, 4300) {
  foreach ($owner in (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).OwningProcess) {
    if ($ours.ContainsKey([int]$owner)) { $ids += $owner } elseif ($owner) { Write-Host "Aviso: a porta $port esta em uso por outro programa (PID $owner); ele nao sera encerrado." }
  }
}
$ids += (Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
  $_.CommandLine -and $_.CommandLine.Contains($root) -and $_.CommandLine -match 'nest|ng\.js|dist.main|vite'
}).ProcessId
$ids = $ids | Where-Object { $_ } | Select-Object -Unique
foreach ($id in $ids) { taskkill /PID $id /T /F *> $null }
if ($ids) { Write-Host "Encerradas $($ids.Count) instancia(s) antiga(s)." } else { Write-Host 'Nenhuma instancia em execucao.' }
