# Visualizador com prioridade para celular

## Comportamento

- Atualizacao solicitada: toda abertura inicia em Alta, inclusive no celular e no IP/HTTP por WebGL. Sem rebaixamento automatico ou reaplicacao de preferencias antigas. Resolucao permanece limitada a area Full HD e o exterior tem alvo de 30 FPS no celular. Apenas `?seguro=1` inicia no perfil leve sem sombras/pos-processamento.
- A vista inicial usa torres parametricas. Os GLB detalhados nao sao baixados na abertura; selecionar uma torre inicia somente o download dela. Cliques repetidos compartilham a mesma tarefa. Dados comerciais, recorte e selecao continuam ativos.
- O passeio interno continua importado somente ao abrir "Ver por dentro".
- Decoracao do entorno tem alcance de 650 m e limite de 400 arvores no celular. As ruas e a implantacao nao sao recortadas por esse limite.

## Build e servidor

```powershell
npm run build:viewer
npm run serve:viewer
```

O build gera arquivos `.br` e `.gz` ao lado dos estaticos originais. O preview do projeto negocia Brotli/gzip, com `Vary: Accept-Encoding`, ETag por representacao e cache longo para chunks com hash em `/assets/`. O servidor de desenvolvimento nao representa essa entrega.

Em producao, configurar o servidor estatico/proxy para servir os arquivos precompactados (por exemplo, `gzip_static on` no Nginx; Brotli depende do modulo instalado), ou habilitar compressao equivalente. Publicar todo o `dist`, inclusive os sidecars, e conferir `Content-Encoding` na resposta HTTP. Nunca servir `.br`/`.gz` como JavaScript sem esse cabecalho. O plugin do Vite atua apenas no preview, nao configura automaticamente Nginx, IIS ou CDN.

## Medicao reproduzivel

Com API e preview ativos nas portas 3000 e 4301:

```powershell
node scripts/bench/check-compressed-assets.mjs
node scripts/bench/check-viewer-loading.mjs
node scripts/bench/check-graphics-safety.mjs
node scripts/bench/mobile-startup.mjs
```

O ultimo comando usa um Chrome headless isolado, 390 x 844, DPR 2, identificacao e toque de Android, cache desativado, latencia de 80 ms e download de 250.000 bytes/s (~2 Mbit/s). Por seguranca usa WebGL por software; nao mede o desempenho de uma GPU de celular real. `CHROME_PATH` permite trocar o executavel e `BENCH_CPU_RATE` aplicar desaceleracao opcional de CPU (padrao 1). O segundo argumento pode indicar outra URL do preview.

Resultado historico local em 22/10/2026, ANTES de fixar Alta na abertura, no perfil eco: primeiro quadro navegavel em 20,7 s; entorno completo em 25,6 s; cerca de 2,53 MB transferidos em recursos. Nenhum GLB de torre nem codigo do passeio interno foi carregado na abertura. Selecionar Torre 3 baixou um unico GLB (574.171 bytes), sem erros de console, e permitiu abrir o card/selecionar unidade. Metricas e captura da execucao mais recente ficam em `bench-out/mobile/` (nao versionados); esses tempos historicos nao descrevem o custo do novo perfil Alta.

O chunk compartilhado de geometria passou de 1.977.031 bytes sem compressao para 402.857 com Brotli ou 458.016 com gzip. Isso mede esse arquivo, nao a pagina inteira.

Reexecucao com Alta fixada: 42,3 s ate a abertura e cerca de 4,00 MB de recursos no mesmo tipo de emulacao por software/rede limitada. Zero torres detalhadas na abertura; uma unica torre (574.171 bytes) apos selecionar, card e selecao aprovados, sem erros de console. A politica visual atual e o custo observado estao detalhados em `alta-qualidade-ip.md`.

Ainda nao considerar o objetivo de abertura rapida em qualquer celular resolvido: medir em aparelho fisico e rede real. Os proximos alvos sao o custo do motor JavaScript/compilacao de shaders e a preparacao da implantacao. Para uma campanha que exija conteudo imediato, uma capa 2D leve antes de ativar o 3D e uma alternativa ao custo inevitavel do motor.
