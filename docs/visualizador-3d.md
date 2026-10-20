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

## Licença dos dados do mapa

Os dados do OpenStreetMap são livres sob a licença ODbL. O crédito "© colaboradores do OpenStreetMap" com link para https://www.openstreetmap.org/copyright precisa ficar visível no visualizador, e já está. As consultas ao Overpass ficam em cache, para respeitar a política de uso do serviço.

## Próximas fases

- Planta 3D mobiliada e tour interno (exige vetorizar a planta: paredes, portas e janelas).
- Extração automática do e-book por IA (torres, pavimentos, finais e plantas) e editor visual da implantação no painel.
- Login só com e-mail e senha e as telas do painel SaaS.
