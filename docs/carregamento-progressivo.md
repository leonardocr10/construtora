# Carregamento progressivo do visualizador

## Mudancas

- O carregador de tela inteira sai quando o terreno esta pronto (`site.baseReady`), nao quando todos os modelos e o bairro terminaram. As torres parametricas permitem navegar e selecionar durante a troca pelos GLB detalhados.
- `__vista.interactiveAt` mede essa liberacao. `__vista.readyAt` continua medindo o termino completo: nao confundir os dois tempos.
- Duas torres detalhadas por vez, com fila que continua apos falhas. O entorno e importado depois do terreno e nao impede a abertura. O codigo do passeio interno so e importado ao clicar em "Ver por dentro", com protecao contra clique duplicado e tratamento de erro.
- Computadores novos iniciam em Alta ou Media, celulares/GPU fraca conservam a deteccao existente. Ultra continua disponivel manualmente; preferencias ja salvas nao sao sobrescritas. Quem havia salvo Ultra deve selecionar outra qualidade em Vistas se quiser menos custo grafico.
- O visualizador pede `GET /api/v1/public/assets/:id?optimized=1` para torres. As demais imagens e os downloads originais continuam na rota original.

## Entrega compactada

A API verifica primeiro se o arquivo pertence a um empreendimento publicado, inclusive quando a derivada ja esta em cache. A otimizacao gera uma copia Meshopt, sem simplificar malhas nem quantizar coordenadas. Preserva nomes usados pelo recorte, materiais, atributos de vertices, interiores e imagens KTX2. O codec pode girar ciclicamente os tres indices de um triangulo, mantendo exatamente a face e a orientacao.

Gzip e negociado por `Accept-Encoding`, com `Vary`, ETags distintos por representacao e revalidacao 304. O decoder Meshopt e servido localmente em `/meshopt/meshopt_decoder.js`, com licenca MIT incluida; nenhuma visita depende do CDN para esse decoder.

Cache privado reconstruivel em `storage/.viewer-cache/`, ou na pasta LOCAL_STORAGE_PATH configurada. Chave inclui versao do algoritmo, checksum, tamanho e data do original. Um worker por vez, no maximo oito derivadas em espera, timeout de 45 segundos e limite de entrada de 100 MiB. Requisicoes simultaneas ao mesmo arquivo compartilham trabalho. Falhas retornam o original, com espera de cinco minutos antes de nova tentativa. Arquivos originais e banco nao sao regravados.

O primeiro visitante pode esperar a geracao da derivada. Visitas seguintes usam o cache. Copiar `scripts/viewer/` junto ao deploy da API, instalar as dependencias de producao declaradas na raiz e garantir escrita no armazenamento. O decoder ja esta versionado; `postinstall` tambem sincroniza sua versao/licenca a partir do pacote fixado.

## Medicoes locais

Torres atuais do Union Vista (bytes HTTP; gzip negociado):

| Torre | Original | Derivada transferida |
| --- | ---: | ---: |
| 1 | 7.569.148 | 576.186 |
| 2 | 7.539.056 | 573.693 |
| 3 | 7.562.564 | 574.171 |
| 4 | 7.537.244 | 574.322 |
| Total | 30.208.012 | 2.298.372 |

Reducao de aproximadamente 92,4% no download **das torres**, nao do site inteiro. Sem gzip, as quatro derivadas Meshopt somam cerca de 15,7 MB. Compressao reduz transferencia; nao reduz os triangulos que a GPU precisa desenhar.

Chrome headless local, WebGPU, 1280 x 800, qualidade Ultra salva e cache do navegador desativado: carregador anterior ate aproximadamente 12,7 s; depois, cena liberada em 2,5–2,7 s e detalhes completos em aproximadamente 12 s. Cache de derivadas ja gerado na API. Nao e uma promessa de tempo em celular ou internet real; o ganho medido aqui e na primeira interacao, enquanto o custo de montar todos os detalhes permanece.

## Verificacao e comandos

```powershell
npm ci
npm run build --workspace=@vistahub/api
npm run build:viewer
node scripts/bench/check-web-glb.mjs
node scripts/bench/check-viewer-loading.mjs
node scripts/bench/check-pilot-finishes.mjs
node scripts/bench/check-unit-selection.mjs
node scripts/bench/check-ground.mjs
node scripts/bench/check-pilot-landscape.mjs
```

Para conferir um GLB real sem altera-lo: `node scripts/bench/check-web-glb.mjs "caminho/do/original.glb"`. Verificacao feita tambem com a Torre 1 real: atributos exatos, mesmas faces/orientacao, nomes, transforms, materiais e texturas. Cache, concorrencia, fallback, gzip/identity e HTTP 304 conferidos.

No navegador: GLB detalhado carregado usando decoder local, card/recorte de unidades funcionando e passeio ausente da rede na abertura, baixado e aberto apenas apos o clique. Capturas de QA em `D:/construtora/_shots/loading-before.png`, `loading-after.png` e `loading-interior.png`.

Para testar o build localmente, `npm run serve:viewer`. Para publicacao, usar um servidor de arquivos estaticos/proxy apropriado, nao o Vite de desenvolvimento. O aviso de chunk grande compartilhado do motor permanece; nao foram removidos recursos do Babylon so para esconder esse aviso.

`npm install` reportou dez vulnerabilidades na arvore de dependencias; nao foi executado `audit fix --force` nem uma atualizacao ampla fora deste escopo.
