# Visualizador 3D paramétrico

O visualizador público (`apps/viewer`, Vite + Three.js) monta a maquete do empreendimento em tempo real a partir dos dados do banco. Não depende de um modelo 3D pronto: a maquete é gerada a partir de parâmetros.

## De onde vem cada parte

| Parte da cena | Origem |
|---|---|
| Lote | Polígono da implantação (`ViewerConfiguration.publicLayout.lot`, em pixels), com a própria arte da implantação como textura |
| Torres | `Building.position` (x, z e rotação em metros), `floorCount`, `unitsPerFloor`, `floorHeight` e `model3d` (largura, profundidade, cores e posição de cada final) |
| Cor de cada apartamento | Status da unidade (espelho de vendas) |
| Marcadores de lazer | `Amenity.marker` e `Amenity.position` |
| Plantas | `FloorPlan` + imagem (`DevelopmentAsset` do tipo `FLOOR_PLAN`) e cômodos/cotas na descrição |
| Ruas, quadras, verde, água e prédios vizinhos | OpenStreetMap (Overpass), num raio de 1,6 km, guardado em cache em `storage/<empreendimento>/osm-surroundings.json` |
| Casas ilustrativas | Geradas ao longo das ruas residenciais onde o OSM não tem edificações (sinalizado na tela) |

A implantação é posicionada no mapa por `latitude`/`longitude` do empreendimento (centro do lote) e por `publicLayout.azimuth` (para onde aponta o topo da imagem). `metersPerPixel` define a escala.

## Como rodar

```bash
npm run dev:api
```

```bash
npm run dev:viewer
```

Abra http://localhost:4300/union-vista (ou `/<slug>` de qualquer empreendimento publicado). Em produção, gere com `npm run build --workspace=@vistahub/viewer` e defina `VITE_API_URL` se a API estiver em outro domínio.

## Rotas da API usadas

- `GET /api/v1/public/developments/:slug`: dados públicos (só empreendimentos `PUBLISHED`).
- `GET /api/v1/public/developments/:slug/surroundings`: entorno OSM em metros (cache).
- `GET /api/v1/public/assets/:id`: imagens públicas do empreendimento.
- `POST /api/v1/public/developments/:slug/leads`: contato com consentimento (limite de 5 por minuto).
- `POST /api/v1/developments/:id/surroundings/refresh`: atualização do entorno (autenticada; botão no Estúdio 3D).

## Publicação por link

No painel, em **Estúdio 3D**, use **Publicar empreendimento**. A publicação muda o status para `PUBLISHED` e grava uma versão em `PublicationVersion` (quem publicou e as contagens daquele momento). Ao despublicar, o link deixa de funcionar na hora (404).

O link para compartilhar é `GET /api/v1/public/share/:slug`: uma página leve com metadados Open Graph (título, cidade, unidades disponíveis e imagem de capa) que redireciona para o visualizador. É essa página que gera a prévia no WhatsApp. O painel mostra também o botão do WhatsApp e o QR code para baixar.

Configure no `.env` de produção (com https):

```
PUBLIC_API_URL="https://api.seudominio.com.br"
VIEWER_URL="https://3d.seudominio.com.br"
```

Em ambiente local o WhatsApp não consegue ler a página, então a prévia só aparece depois do deploy.

## Navegação

Arrastar gira a câmera, o botão direito move, a roda aproxima e Esc volta um nível. Há vistas predefinidas (aérea, frente, lateral, fundos e topo, orientadas pela implantação) e um botão de tela cheia.

## Cadastro em lote

Em **Torres e pavimentos**, o gerador cria pavimentos e unidades com um padrão de numeração (`{andar}{final:02}`) e, se quiser, vincula uma planta a cada final. Tudo roda numa única transação (`POST /api/v1/buildings/:id/generate`): se algo falhar, nada é criado. No mesmo lugar ficam os parâmetros 3D da torre (pé-direito, largura, profundidade, posição, rotação e cores).

## Union Vista

Importado por `scripts/import/union-vista.mjs` a partir do e-book e do espelho de vendas:

```bash
python -I scripts/import/extract-pdf-pages.py "C:/caminho/HLTS_UNION VISTA_E-BOOK.pdf" C:/temp/union-vista 55
```

Copie a imagem da implantação para `C:/temp/union-vista/implantacao.jpg` e rode:

```bash
node scripts/import/union-vista.mjs C:/temp/union-vista demo@vistahub.local
```

- 4 torres × 12 pavimentos (térreo + 11) × 8 apartamentos = 384 unidades; plantas 01 (57 m², finais 1, 4, 5, 8) e 02 (58 m², finais 2, 3, 6, 7), com versões garden no térreo.
- Espelho das torres 2, 3 e 4 transcrito das imagens enviadas. **A Torre 1 não veio no material: todas as unidades estão como disponíveis até a atualização no painel.**
- Preços não constam no material e não são exibidos (`publicLayout.showPrices = false`).
- Centro e rotação calibrados casando a Alameda dos Mandarins e a Av. Manuel Lúcio da arte com as mesmas vias no OSM.

## Planta 3D mobiliada e passeio interno

Cada planta pode ser vetorizada no painel, em **Plantas e tipologias → Vetorizar planta** (`/empreendimentos/:id/plantas/:planId/vetorizar`). O editor desenha sobre a imagem da planta:

- **Escala**: clique nas duas pontas de uma cota impressa e informe a medida real; o desenho já feito é reescalado junto.
- **Parede**: cliques encadeados, com encaixe nas pontas existentes (20 cm) e trava em 0°/90°. Duplo clique ou Esc encerra.
- **Porta, janela e porta de correr**: clique sobre uma parede; largura, posição e peitoril são editados no painel lateral.
- **Cômodo**: clique nos cantos e feche no primeiro ponto. O tipo (sala, quarto, suíte, cozinha, banheiro, varanda, serviço, circulação, garden) é sugerido pelo nome e define o mobiliário. **Criar paredes no contorno** gera as paredes que faltam.
- Selecionar, arrastar as pontas da parede, Delete, Ctrl+Z, roda para zoom e botão direito para mover.

A planta fica em `FloorPlan.layout` (JSON em metros, origem no canto superior esquerdo da imagem), gravada por `PUT /api/v1/floor-plans/:id/layout` e validada por `parsePlanLayout` (`apps/api/src/structure/plan-layout.ts`). O endpoint público devolve o `layout` de cada planta.

No visualizador, os apartamentos cuja planta tem `layout` mostram **Planta 3D mobiliada e passeio** (também no modal da planta). A cena (`apps/viewer/src/scene/interior.ts`) é gerada na hora:

- paredes com os vãos de portas (folha aberta) e janelas (peitoril, verga e vidro), piso por tipo de cômodo (madeira, porcelanato, cerâmica, grama);
- mobiliário ilustrativo distribuído automaticamente junto às paredes livres, sem bloquear portas nem pôr móveis altos na frente de janelas;
- **Maquete**: vista orbital de cima, com as paredes cortadas a 1,10 m;
- **Passeio**: primeira pessoa com teto, arrastar para olhar, WASD/setas (ou o direcional na tela) para andar, colisão com as paredes exceto pelas portas, e botões para ir a cada cômodo (o ponto de vista é o de maior profundidade no ambiente).

Plantas do Union Vista: `node scripts/import/union-vista-plantas-3d.mjs` (depois de `npm run build`) grava as plantas 01 e 02 tracejadas sobre o e-book e calibradas pelas cotas impressas. As versões garden usam a mesma planta, sem o garden.

## Chão, estacionamento e lazer gerados da arte

Tudo abaixo sai da arte da implantação e do cadastro, sem ajuste por empreendimento:

- **Chão** (`scene/ground.ts`): cada pixel do lote vira asfalto, grama, piso, faixa pintada ou "outro". O chão é redesenhado com texturas próprias, e calçadas e canteiros sobem com meio-fio.
- **Estacionamento** (`scene/lot-relief.ts`, `scene/parking.ts`): carros são detectados (inclusive fileiras de carros encostados), agrupados em fileiras alinhadas e encaixados em vagas de 2,5 m, todas demarcadas. Onde estava o carro, o chão é reconstruído pela continuação dos lados.
- **Lazer** (`scene/amenities.ts`): o tipo vem do nome da área (piscina, quadra, beach tennis, quiosque/gourmet/bar, playground, deque, bicicletário, portaria/lixeira e construções em geral). O tamanho vem da arte em volta do marcador: água para a piscina, mancha de cor uniforme para o resto, com limites por tipo.
- **Vegetação** (`scene/trees.ts`): árvores detectadas na arte ganham copa orgânica; palmeiras são plantadas em fileira nas faixas de grama junto ao muro.
- **Torres** (`scene/tower.ts`): fachada em geometria (painéis em dois tons, janelas com caixilho e vidro, peitoril, frisos de laje e patamares da escada).

No visualizador, o botão **Ocultar números** (barra de vistas) esconde os marcadores do lazer, e a escolha fica salva no navegador.

## Licença dos dados do mapa

Os dados do OpenStreetMap são livres sob a licença ODbL. O crédito "© colaboradores do OpenStreetMap" com link para https://www.openstreetmap.org/copyright precisa ficar visível no visualizador, e já está. As consultas ao Overpass ficam em cache, para respeitar a política de uso do serviço.

## Próximas fases

- Extração automática do e-book por IA (torres, pavimentos, finais e plantas) e editor visual da implantação no painel.
- Login só com e-mail e senha e as telas do painel SaaS.
