# Revisao visual do Union Vista — 21/10/2026

Referencia de implantacao: e-book HLTS Union Vista, pagina 6; jardins, fachadas e estacionamento: paginas 3, 17 e 18. A imagem externa enviada pelo cliente orienta a qualidade de materiais e paisagismo, preservando a arquitetura e as quatro torres do Union Vista.

## Causa dos defeitos no solo

A classificacao por cor lia copas, sombras, marcadores e carros da imagem como materiais de solo. A suavizacao posterior transformava esses erros em canteiros e calcadas de contorno irregular; a classe `art` ainda projetava manchas da imagem diretamente na malha. A classificacao continua disponivel para outras implantacoes, mas o Union Vista usa agora um plano vetorial revisado no MySQL.

Foram definidos 57 poligonos com prioridade de sobreposicao, 22 eixos de fileiras de estacionamento e 30 posicoes de vegetacao. O recorte booleano gera superficies exclusivas de grama/piso/asfalto, respeitando a divisa do lote. A arte original nao e usada como acabamento dessas superficies. Todo o retangulo da vaga e toda a base da vegetacao precisam caber no material apropriado.

As coordenadas e alturas sao aproximadas, conferidas no material de vendas; nao sao levantamento topografico nem projeto executivo. Fileiras que nao couberem inteiramente no asfalto sao omitidas em vez de atravessar um canteiro. A ocupacao e a cor dos carros sao lidas da arte.

## Acabamentos e modelos

- Asfalto com agregado fino e rugosidade alta, sem a antiga normal forte com aspecto de manchas molhadas.
- Piso intertravado com pecas de 20 x 10 cm e juntas discretas, substituindo o quadriculado de placas de 1 m.
- Grama com variacao menor de cor e relevo fino; arbustos baixos nas bordaduras.
- Palmeiras com nervuras e foliolos curvos em geometria, com dois niveis de detalhe. Copas de arvores mais densas.
- Torres com juntas mais discretas e variacao deterministica dos vidros, mantendo plantas, pavimentos, volumetria e cores-base existentes. Novas versoes GLB 17 a 20 ativadas; as anteriores permanecem no historico.
- Oclusao de ambiente com alcance menor para dar contato aos objetos sem grandes halos escuros.

## Reaplicar e recuperar

O layout esta em `ViewerConfiguration.publicLayout.groundPlan` e `landscape`, no MySQL. O arquivo `scripts/import/union-vista-landscape-data.mjs` e uma fonte versionada para reaplicar a revisao; o visualizador consome a configuracao persistida da API.

```powershell
node scripts/import/union-vista-landscape.mjs           # somente resumo
node scripts/import/union-vista-landscape.mjs --apply   # grava em transacao com auditoria
node scripts/import/union-vista-landscape.mjs --restore ID_DA_AUDITORIA
node scripts/bench/check-ground.mjs
```

A auditoria inicial `cmvirp4d80001tk6o0oak8ldi` guarda o layout anterior a esta revisao. Ao salvar os contornos no painel, os metadados das fileiras permanecem; as vagas continuam limitadas pelo contorno atualizado.

Para regenerar os recursos locais, execute o Blender configurado em `BLENDER_PATH`:

```powershell
& "CAMINHO_DO_BLENDER_EXE" -b --factory-startup --python scripts/blender/build_library.py -- apps/viewer/public/library --only textures,trees --sets asphalt,paving,grass --res 1024
& "CAMINHO_DO_BLENDER_EXE" -b --factory-startup --python scripts/blender/ktx2_library.py -- apps/viewer/public/library CAMINHO_DO_KTX_EXE --sets asphalt,paving,grass
node scripts/blender/union-vista-torres.mjs
```

O Blender exporta a biblioteca e as torres com parametros reprodutiveis. As texturas KTX2 permanecem comprimidas na GPU. A referencia enviada e uma imagem de visualizacao arquitetonica; os modelos atuais continuam sendo uma reconstrucao do book para navegacao em tempo real, sem a geometria BIM original nem todos os detalhes de um render de producao.

## Verificacao

Compilacao TypeScript/Vite e Nest aprovada; sete testes do gerador Blender e seis testes da API aprovados. O teste de regressao do terreno verifica separacao de materiais, divisa, normais, conservacao das vias e a area completa das vagas, incluindo contato exato com meio-fio sem erro de arredondamento.

Na cena carregada, a verificacao leu os dados atuais da API e conferiu **288 vagas, 163 carros, zero vagas invalidas, palmeiras instanciadas e ausencia da malha de arte projetada**. Capturas locais de solo, paisagismo e fachadas estao em `D:/construtora/_shots/union-review/`. As versoes anteriores do modelo e as auditorias do layout continuam disponiveis para recuperacao.

## Portaria, lazer, selecao e passeio interno

Revisao adicional baseada na implantacao do book (pagina 6), na porta do quarto da Planta 01 (pagina 7), nos renders de lazer (16–18) e na organizacao visual de https://unionvista.netlify.app/. Os 14 equipamentos agora possuem centros, dimensoes e tipos explicitos em `publicLayout.amenityModels`, sem depender de manchas de cor da arte. Inclui guarita envidracada com marquise e cancela, dois quiosques grill, bar aberto, area gourmet, piscina com divisoria infantil, deque e quadras. As dimensoes continuam estimadas/ilustrativas. Nao e uma reproducao executiva ou fotorealista do projeto.

O muro possui uma abertura de acesso, o asfalto chega a divisa e `parkingExclusions` impede vagas sobre a entrada. Os totais de estacionamento acima descrevem a revisao anterior: a entrada agora retira as vagas que a bloqueavam. As alteracoes foram gravadas em transacao no MySQL, preservando os demais dados. Auditoria inicial dos detalhes: `cmviu3s820001tkmc7b3wl5ri`; complemento da exclusao de vagas: `cmviu7wuj0001tkr0muabbbcq`. Restaurar a auditoria inicial recupera a configuracao anterior a ambos os ajustes.

O corte de andar usa planos de recorte nos materiais da torre real, preservando fachadas/janelas/varandas abaixo do corte. A selecao foi refeita apos a comparacao das duas capturas: piso com cor independente dos reflexos HDR, selecionado em laranja solido suave e demais unidades com cores pastel conforme o status real. Um gabarito somente de arestas brancas preserva a altura original acima do corte para as unidades nao selecionadas. Os volumes nao invadem o nucleo central; o minimapa usa a mesma distribuicao. Nao ha aumento de escala no apartamento selecionado. As etiquetas nao selecionadas sao claras e discretas, e a camera aproxima um pouco mais no desktop. Os paineis comerciais seguem a ordem espelho de vendas / apartamento, e o menu de vistas recolhe ao abrir a selecao. Os botoes superiores possuem fundo branco opaco. Luz diurna mais neutra e preenchimento maior nas sombras, com contraste reduzido.

No interior, paredes baixas sao recortadas em vez de deformadas; mobilia nao invade cantos de ambientes em L. O passeio tem colisao com paredes e moveis, rotas A* pelos vaos de portas, clique no piso, minimapa orientado, visita guiada, dois modos de luz e controles de teclado/toque. Na Planta 01, a porta do quarto foi movida para a parede lateral do corredor, conforme o book; isso tambem foi corrigido na fonte do importador. O renderizador usa os layouts persistidos, nao dados de demonstracao.

```powershell
node scripts/import/union-vista-details.mjs             # resumo, nao grava
node scripts/import/union-vista-details.mjs --apply     # grava com auditoria
node scripts/import/union-vista-details.mjs --restore ID_DA_AUDITORIA
node scripts/bench/check-interior.mjs
node scripts/bench/check-unit-selection.mjs
npm run build --workspace=@vistahub/viewer
```

Validacao: compilacao de producao aprovada; navegacao pura testa paredes, portas, moveis, limites e as quatro plantas do banco. No navegador WebGPU foram conferidos os 14 equipamentos persistidos, os controles opacos, o recorte da fachada e todos os pares de ambientes das quatro plantas **com o mobiliario real carregado**, sem trajetos invalidos. O passeio guiado foi observado em movimento fora das colisoes. Capturas em `D:/construtora/_shots/details-*.png`.

Foi validado tambem o fallback `?motor=webgl`: recorte e selecao da torre, interior da Planta 02, conectividade, troca de modo e fechamento sem erros de console. A visita guiada da Planta 01 percorreu a fila completa e terminou sem colisao. A interface do interior foi conferida em 390 x 844. Um teste sintetico que executou centenas de quadros WebGPU sem intervalo produziu um aviso de textura de swapchain destruida; isso nao apareceu no percurso normal nem no teste WebGL. O build mantem um aviso de tamanho de bundle (nao bloqueante).

## Nova decoracao e interface do interior

Os controles do apartamento foram reunidos em um painel lateral verde-escuro opaco, com ambientes, iluminacao, olhar livre e visita guiada. O painel recolhe no celular; o minimapa e os controles de toque permanecem disponiveis. A projecao da planta 3D reserva espaco para o painel no desktop, sem cobrir os quartos. O status acompanha a mudanca de ambiente durante a caminhada.

O mobiliario amadeirado foi substituido: sofa claro com almofadas sage, bases metalicas, camas/cabeceiras estofadas, mesas de pedra clara, cadeiras com assento estofado e pes metalicos, rack laqueado, armarios de cozinha off-white/verde-salvia e gabinetes de banheiro foscos. Torneiras curvas e puxadores discretos completam as bancadas. A madeira fica somente no piso; divisao e medidas dos comodos nao foram alteradas.

Portas com folha laqueada de 42 mm, frisos, batentes, guarnicoes nos dois lados, rebaixo, tres dobradicas, rosetas, macanetas e fechaduras dos dois lados. As folhas ficam abertas a 90 graus; os vaos e o navegador continuam usando a planta persistida no MySQL.

Verificacao no navegador: todos os pares de ambientes das quatro plantas continuam conectados com o mobiliario carregado. As vinte portas carregam ferragens em geometria (642 vertices de metal por folha). Planta 3D, passeio, recolhimento do painel, minimapa e fechamento foram conferidos em WebGPU e WebGL, incluindo viewport 390 x 844. Compilacao de producao e testes de navegacao/selecao aprovados. Capturas: `D:/construtora/_shots/interior-contemporary-final-*.png`.

## Divisa viaria, jardins e casas do entorno

A implantacao aproximada foi deslocada 2,5 m em X e -3 m em Z e girada +0,25 grau, sem alterar escala, latitude/longitude ou posicoes relativas das torres/equipamentos. O alinhamento foi verificado contra a largura renderizada das vias OSM e uma faixa de 1,3 m de calcada/folga: a intersecao do lote com o asfalto caiu de aproximadamente 203 m² para zero; com o corredor completo fica abaixo de 0,001 m². Isso e um ajuste visual, **nao uma demarcacao cadastral nem levantamento topografico**.

A primeira camada do terreno passou de piso para grama. Os recortes explicitos de circulacao, acesso, calcadas e equipamentos continuam preservados; assim os espacos residuais dos jardins deixam de virar triangulos brancos. Foi atualizada tambem a fonte do importador, sem regenerar/apagar os detalhes de portaria existentes. Gravacao transacional com verificacao de concorrencia; auditoria `cmviv4b9r0001tkxc234i8t2l` guarda o layout anterior completo.

As ruas usam uniao de buffers em metros, com curvas/encontros arredondados. As calcadas sao a diferenca entre o corredor viario e o asfalto: nao atravessam cruzamentos. Sao fechados somente pequenos intervalos (ate 14 m) na continuacao de um eixo em direcao a outra via conhecida, sem atravessar o lote ou edificios mapeados. Na base atual foram encontrados 15 desses intervalos. Finais de rua sem destino conhecido e vias em construcao nao sao inventados como arruamento pronto.

Casas ilustrativas orientam a fachada para a rua e testam a cobertura/quintal inteiro contra vias, divisa e outras construcoes. Ha telhados de duas aguas e lajes, marquises, portas/janelas, passeios de entrada e pequenos jardins. A representacao continua ilustrativa, nao e cadastro de imoveis do bairro. Textura procedural de asfalto sem os cones escuros causados por gradientes nao concentricos.

```powershell
node scripts/import/union-vista-street-fit.mjs             # preview; idempotente se ja aplicado
node scripts/import/union-vista-street-fit.mjs --apply
node scripts/import/union-vista-street-fit.mjs --restore cmviv4b9r0001tkxc234i8t2l
node scripts/bench/check-urban.mjs
node scripts/bench/check-ground.mjs
```

Restaurar recupera o publicLayout inteiro anterior, inclusive seus acabamentos: nao usar depois de novas edicoes sem conferir a auditoria. O teste urbano verifica curvas, cruzamentos, conservacao da area triangulada, impedimentos ao prolongamento, zero invasao do corredor viario e ausencia de sobreposicao de casas. Rede atual com 722 trechos e 7.403 casas ilustrativas. Geracao geometrica medida em cerca de 3,6 s no processo local; carregamento completo observado no navegador em cerca de 8 s. Capturas `D:/construtora/_shots/urban-review-*.png`.

## Destaque de selecao e cards comerciais

Ao selecionar uma unidade, as demais recebem cores mais claras, preservando a diferenca de status; outras torres recebem um tom de contexto claro, sem transparencia dos edificios. Laranja suave e opaco apenas na selecionada. Desselecionar/trocar torre restaura as cores de origem, sem clareamento acumulativo. A troca de pavimento limpa a selecao anterior.

Cards de espelho e apartamento com fundo branco esverdeado a 94% de opacidade, desfoque de 2 px, rodape fixo e dimensoes proximas da referencia. O indicador de posicao mostra unidades neutras, a selecionada laranja, direcao da fachada, norte para cima e pilha de pavimentos. A orientacao vem dos giros reais do layout/torre, nao de uma seta decorativa. Navegacao inferior e controles nao cobrem os cards; no celular, o espelho fica oculto enquanto os detalhes estao abertos e retorna ao voltar. Valores/status continuam vindos do MySQL: nao se copiam dados simulados da referencia.

Validacao em WebGPU e WebGL2: selecao, cores de contexto, restauracao ao voltar e cards em 390 x 844. Capturas `D:/construtora/_shots/selection-focus-*.png`. Testes `check-unit-selection.mjs`, `check-interior.mjs` e build do viewer aprovados (permanece o aviso nao bloqueante de tamanho de bundle).

## Fachadas dos predios mapeados do entorno

Os antigos prismas brancos do OSM agora usam `context-buildings.ts`: contorno e altura preservados, reboco em tons neutros, janelas por pavimento com vidro, caixilho, montante central e peitoril, entrada na face voltada para a via mais proxima, marquise, frisos entre andares e platibanda. A cobertura segue o poligono real, inclusive seus recuos, com textura de juntas e pequenos equipamentos posicionados inteiramente dentro da projecao.

Volumes baixos de grande area recebem proporcoes comerciais de aberturas/cobertura, em vez de janelas residenciais esticadas. Essa distincao e uma heuristica visual por area/altura, nao uma afirmacao de uso cadastral. Os acabamentos sao **ilustrativos**, nao fachadas reais fotografadas ou levantadas. Nao houve alteracao do banco, de coordenadas, de ruas nem das torres principais do empreendimento.

Na base atual: 177 edificios, 3.691 janelas, 177 entradas e 144 pequenos equipamentos de cobertura. Caixilhos, vidros, montantes e acabamentos usam instancias finas por material, sem milhares de objetos separados. Geracao geometrica local medida em cerca de 130–180 ms. Testes de sentido dos aneis, normais externas, alturas, contornos concavos, equipamentos dentro da projecao e conservacao dos edificios existentes; cena conferida em WebGPU e WebGL2. Capturas `D:/construtora/_shots/context-buildings-*.png`.

```powershell
node scripts/bench/check-context-buildings.mjs
node scripts/bench/check-urban.mjs
npm run build --workspace=@vistahub/viewer
```

## Vidro transparente e profundidade atras das janelas

Gerador Blender v3: a antiga caixa macica da lamina foi substituida por lajes entre pavimentos e fechamento junto ao nucleo. Os vaos dos paineis agora abrem para ambientes 3D com piso, teto, paredes laterais/fundo, cortinas estreitas e mobiliario (salas, quartos, cozinhas e bancadas de banheiro). Sao **ambientes ilustrativos simplificados para a vista externa**, nao uma repeticao executiva da planta de cada unidade. O passeio interno permanece independente e continua usando os layouts cadastrados no banco.

Vidro PBR nao metalico, transparencia de 68–76% nas janelas comuns, reflexo HDR moderado e rugosidade baixa; banheiros com vidro mais fosco/menos transparente. O brilho do entardecer fica nas luminarias/paredes internas, nao em uma placa emissiva cobrindo o vidro. Preenchimento emissivo discreto aproxima a luz rebatida sem criar centenas de luzes dinamicas. Mobiliario, cortinas e pequenas luminarias possuem LOD; a casca do ambiente permanece para a torre nao parecer vazada ao longe. O zoom externo agora permite aproximar a 4 m do alvo para inspecionar os detalhes.

Novos modelos ativos: versoes 21, 22, 23 e 24, com 388 pequenos ambientes por torre e aproximadamente 7,2 MB por GLB. Os modelos anteriores nao foram apagados. A ativacao das quatro torres foi feita em uma unica transacao, com verificacao de edicao concorrente e auditoria `cmvivofg20001tk9s25hu8a3g`. As primeiras tentativas de ativacao falharam na validacao da auditoria e foram revertidas integralmente; as versoes geradas foram reutilizadas apos a correcao, sem gerar copias adicionais.

```powershell
python scripts/blender/test_build_tower.py
node scripts/bench/check-facade-glass.mjs
node scripts/bench/check-unit-selection.mjs
node scripts/blender/union-vista-glass.mjs                 # preview
node scripts/blender/union-vista-glass.mjs --apply         # gera novas versoes e ativa em conjunto
node scripts/blender/union-vista-glass.mjs --restore cmvivofg20001tk9s25hu8a3g
```

Restaurar recupera o model3d inteiro anterior das quatro torres; conferir edicoes posteriores antes de usar. O comando nao remove assets nem historico. O teste Python inclui exportacao GLB real, alphaMode BLEND, ambientes mobiliados, determinismo e ausencia do corpo opaco atras das janelas. Testes do material, selecao por pavimento e build aprovados. Cena conferida em WebGPU e WebGL2, de dia, em angulo e ao entardecer, incluindo recorte de pavimento. Capturas `D:/construtora/_shots/facade-glass-*.png`.

## Revisao de tonalidades e menor transparencia

A comparacao seguinte enviada pelo cliente pede fachadas mais marcadas, proximas da primeira captura, e janelas menos esbranquicadas. A revisao abaixo **substitui a intensidade/transparencia da etapa anterior**, mantendo seus ambientes 3D e a geometria.

Paleta gravada no MySQL para as quatro torres: verde acinzentado `#819d90`, cinza `#a8b4ae`, nucleo terracota `#b35b2f`, caixilhos `#adb9b1` e vidro verde-escuro `#294238`. `facade.appearance: contrasted` permite ao viewer reaplicar os tons sobre os GLB 21–24 existentes, sem gerar outros arquivos nem apagar detalhes da fachada. As superficies de alvenaria ficam explicitamente opacas, com reflexo especular baixo; continuam clareando somente no modo de contexto da selecao comercial.

Vidros agora com 72–84% de opacidade (16–28% de transmissao visual), variacoes verde/cinza/quente, reflexo moderado e sem emissao. Banheiros a 90% de opacidade, mais foscos. Reduzido o preenchimento luminoso dos ambientes externos para nao parecerem placas brancas. Os interiores continuam presentes, mas sua leitura e discreta na vista geral. O exportador Blender foi atualizado para as futuras geracoes; as versoes atuais recebem o acabamento no carregamento.

Auditoria de recuperacao: `cmvivw9y30001tkpssbjuieck`. Transacao unica para todas as torres, com controle de concorrencia. Restaurar recupera o model3d completo anterior; conferir edicoes posteriores antes de usar.

```powershell
node scripts/import/union-vista-facade-tones.mjs
node scripts/import/union-vista-facade-tones.mjs --apply
node scripts/import/union-vista-facade-tones.mjs --restore cmvivw9y30001tkpssbjuieck
node scripts/bench/check-facade-glass.mjs
node scripts/bench/check-unit-selection.mjs
python scripts/blender/test_build_tower.py
```

Compilacao e testes aprovados, incluindo exportacao GLB e separacao entre fachada opaca e vidro tonalizado. Conferencia em WebGPU e WebGL2, vista frontal da Torre 3, angulo, por do sol e selecao comercial. Capturas `D:/construtora/_shots/facade-tones-*.png`. O aviso de tamanho do bundle continua nao bloqueante.

## Fachadas mais claras

A pedido do cliente, os dois tons das quatro torres ficaram mais claros: verde `#a5bfb2` (antes `#819d90`) e cinza `#cdd4d0` (antes `#a8b4ae`), cobertura `#c9d0c6`. No viewer, as faixas (`VH_Trim`) e as juntas de pavimento (`VH_Joint`) acompanham: `#cbd9d0` e `#8ea397`. Nucleo terracota, caixilhos e vidro sem alteracao.

Auditoria de recuperacao: `cmviwzhy50001tkh4qapy1vky`.

```powershell
node scripts/import/union-vista-facade-tones.mjs --restore cmviwzhy50001tkh4qapy1vky
```
