# Cena-piloto de vegetacao — Torre 3

Esta pagina registra a primeira etapa. A continuacao de solo, iluminacao e fachada esta em [piloto-acabamentos-torre-3.md](piloto-acabamentos-torre-3.md).

Primeira etapa de refinamento visual, limitada ao jardim proximo da Torre 3 e a quatro arvores de rua imediatamente vizinhas. Nao altera MySQL, implantacao, classificacao do solo, materiais do terreno, edificios, vias, estacionamento, lazer ou iluminacao global. O restante da vegetacao do bairro mantem suas posicoes, cores e modelos leves.

## Composicao

- Duas silhuetas de arvore: copa ampla/ramificada e porte mais vertical, com galhos visiveis, vazios na copa, variacao de giro, escala e altura. Sem a esfera opaca central no LOD0 dos novos modelos.
- Arbustos verde-prateados, forracao verde-escura e tufos de capim em pequenos macicos irregulares. Gramado livre entre os grupos; nao e uma grade preenchendo o jardim inteiro.
- Ancoras existentes preservadas quando a troca cabe no local; duas novas arvores. Palmeiras existentes mantidas. Bordaduras antigas so saem onde conflitam com os novos macicos.
- Aproximadamente 50 plantas no piloto (52–54 na verificacao, conforme a rasterizacao das bordas do solo), incluindo quatro arvores detalhadas no lote, mais quatro substituicoes de modelo na rua. Modelos artisticos ilustrativos, nao cadastro botanico ou projeto executivo de paisagismo.

O planejador usa as classes de solo do lote, os volumes de todas as torres e os equipamentos de lazer. Bases das plantas baixas devem caber inteiramente na grama, com folga; arvores respeitam afastamento dos edificios e nao sao plantadas nos acessos. A composicao e semeada e reproduzivel para a mesma entrada de solo.

## Assets e desempenho

Cinco arquivos proprios em `apps/viewer/public/library/models/pilot_*.glb`, gerados por `scripts/blender/build_pilot_vegetation.py`. Aproximadamente 433 KiB adicionais no total. Dois LODs por modelo, folhas com recorte alpha (sem ordenacao alpha blend), instancias finas e distancias diferentes para arvores e forracao. Assets antigos nao foram substituidos; o catalogo recebe somente novas entradas e metadados do piloto.

```powershell
node --input-type=module -e 'import "dotenv/config";import {spawnSync} from "node:child_process";const r=spawnSync(process.env.BLENDER_PATH,["-b","--factory-startup","--python-exit-code","1","--python","scripts/blender/build_pilot_vegetation.py","--","apps/viewer/public/library"],{stdio:"inherit",windowsHide:true});process.exit(r.status??1);'
node scripts/bench/check-pilot-landscape.mjs
node scripts/bench/check-ground.mjs
npm run build --workspace=@vistahub/viewer
```

Comparacao sem o piloto: `http://localhost:4300/union-vista?vegetacao=original`. Padrao com o piloto: `http://localhost:4300/union-vista`. O parametro permite comparar/reverter visualmente sem editar dados. Outros empreendimentos nao recebem o piloto.

Enquadramento direto do jardim: `http://localhost:4300/union-vista?cena=jardim-torre3`. Acrescentar `&vegetacao=original` mostra o antes na mesma camera. A camera padrao nao muda para os visitantes sem esse parametro.

## Verificacao

Teste do planejador aprovado: plantas sobre grama, fora dos edificios, limite de escopo, ausencia de mutacao dos dados, reproducibilidade, arquivos GLB com LOD0/LOD1 e materiais sem alpha blend. Teste adicional comprova que a troca de modelo das arvores da rua nao altera as matrizes nem a sequencia de ruido do restante do bairro. Regressao do terreno e build de producao aprovados; permanece o aviso nao bloqueante de bundle grande.

Conferencia visual em WebGPU e WebGL2, dia/por do sol e viewport 390 x 844 (nao um ensaio de FPS em aparelho fisico). Capturas em `D:/construtora/_shots/vegetation-pilot-before.png`, `vegetation-pilot-after.png`, `vegetation-pilot-close.png`, `vegetation-pilot-sunset.png` e `vegetation-pilot-mobile.png`, com enquadramento identico no antes/depois.

Na primeira etapa, o teste isolado preexistente `check-unit-selection.mjs` falhava no NullEngine ao criar o cubemap do vidro, pois o simulador nao possui contexto WebGL. Nao foi tratado como aprovado. Na continuacao de acabamentos, a criacao do fallback sem superficie GPU foi corrigida, e o teste passou. Selecao comercial tambem conferida no navegador real: card aberto, volume selecionado opaco e vegetacao preservada.
