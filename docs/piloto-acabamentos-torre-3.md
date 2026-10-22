# Piloto — solo, iluminacao e fachada

Continuacao da [etapa de vegetacao](piloto-vegetacao-torre-3.md). Refinamento incremental do visualizador existente, nao substituicao do empreendimento pela arquitetura da imagem de referencia.

## Escopo aplicado

- **Solo do lote Union Vista:** novos conjuntos PBR para asfalto, grama, intertravado e concreto. As mesmas malhas, contornos, cotas, vagas e classes de solo continuam sendo usados. Nao altera ruas externas ou mistura grama com pavimentacao. Intertravado de 20 x 10 cm; agregado fino no asfalto; laminas de grama em direcoes variadas e tons oliva/palha discretos. UV em metros, normais e rugosidade, sem sombras pintadas nas texturas.
- **Iluminacao exterior Union Vista:** oclusao de contato mais localizada e menos intensa; bloom mais contido para evitar halos em superficies claras; pequeno ajuste do afastamento da sombra para detalhes finos. Mantem a exposicao, o sol, a nevoa, o HDR e os limites de qualidade ja existentes. Qualidade Baixa continua sem SSAO/bloom, sem impor esses custos ao celular.
- **Fachada da Torre 3:** pintura com micro-normal e rugosidade, preservando as cores cadastradas e o albedo limpo. Vidros usam o HDR pre-filtrado da cena, inclusive no por do sol, com menos metal e reflexos menos espelhados. Mantem a transparencia e os interiores ilustrativos ja presentes. Nao sao reflexos dinamicos dos edificios vizinhos.
- **Detalhes da Torre 3:** peitoris claros com borda/sulco inferior, derivados dos componentes conectados dos vidros do GLB. Nenhuma grade adicional de janelas: acompanha os vaos existentes e exclui portas de varanda. Na versao atual do modelo, 344 vaos, agregados em duas malhas, com LOD a 140 m na qualidade Alta. As malhas acompanham o recorte do pavimento e nao recebem cliques.

Nao altera MySQL, modelos GLB enviados pelo usuario, plantas, mobiliario interno, limites do lote, disponibilidade comercial ou implantacao. Outros empreendimentos permanecem no acabamento anterior. A fachada detalhada ainda esta limitada a Torre 3 para comparacao; nao foi replicada indiscriminadamente nas outras torres.

## Comparar

- Depois: `http://localhost:4300/union-vista?cena=jardim-torre3`
- Solo/luz/fachada anteriores, mantendo a nova vegetacao: `http://localhost:4300/union-vista?cena=jardim-torre3&acabamento=original`
- Antes das duas etapas: acrescentar `&vegetacao=original` ao segundo endereco.
- Acrescentar `&motor=webgl` para conferir o caminho WebGL2.

Sem `cena=jardim-torre3`, a camera inicial habitual e preservada. Os parametros de comparacao nao gravam dados.

## Assets e reproducao

`scripts/blender/build_pilot_surfaces.py` gera somente novas entradas `pilot_*` no catalogo, sem sobrescrever as texturas antigas. Cinco conjuntos, albedo/normal/ORM em 1024 e 512 px: 30 WebP, aproximadamente 1.74 MiB incluindo ambas as resolucoes. Os mapas sao periodicos, deterministicos e gerados proceduralmente no projeto; nao sao texturas fotografadas. Nao requer download de assets ou troca de motor.

```powershell
node --input-type=module -e 'import "dotenv/config";import {spawnSync} from "node:child_process";const r=spawnSync(process.env.BLENDER_PATH,["-b","--factory-startup","--python-exit-code","1","--python","scripts/blender/build_pilot_surfaces.py","--","apps/viewer/public/library"],{stdio:"inherit",windowsHide:true});process.exit(r.status??1);'
node scripts/bench/check-pilot-finishes.mjs
node scripts/bench/check-unit-selection.mjs
node scripts/bench/check-ground.mjs
node scripts/bench/check-pilot-landscape.mjs
npm run build --workspace=@vistahub/viewer
```

O teste adicional valida transformacao GLB/torre, orientacao dos peitoris, exclusao de portas, deduplicacao de vaos, LOD, transparencia e arquivos do catalogo. O cubemap de fallback agora evita alocacao GPU quando nao ha superficie de renderizacao, permitindo o teste NullEngine de selecao. Nao confundir essa verificacao com renderizacao real: a conferencia visual tambem usa navegador com WebGPU/WebGL2.

Verificacao final: quatro testes acima e build aprovados. Conferidos dia/por do sol em WebGPU e WebGL2, recorte dos dois novos detalhes, vidro ligado ao HDR correto, selecao comercial opaca e card aberto. Viewport 390 x 844 conferida em WebGL2. Comparacao `acabamento=original` validada: textura antiga restaurada, perfil novo de luz desligado e detalhes extras ausentes. A primeira tentativa de captura WebGL interrompida durante recarga foi repetida com sucesso; nao foi contabilizada como aprovada.

Capturas locais: `D:/construtora/_shots/pilot-gpu-garden.png`, `pilot-gpu-facade.png`, `pilot-gpu-sunset.png`, `pilot-final-ground.png`, `pilot-final-selection.png`, `pilot-final-mobile.png`, `pilot-baseline-garden.png` e `pilot-baseline-facade.png`.

## Limites

Este piloto melhora materiais e leitura dos detalhes; ainda nao equivale ao render fotografico da referencia. Proximos ganhos grandes dependem da qualidade dos modelos/vegetacao, iluminacao artistica e composicao, nao apenas da exposicao. Nao foram feitas medicoes de FPS em aparelho fisico nem reflexos por ray tracing. O aviso de bundle grande no build continua existente.
