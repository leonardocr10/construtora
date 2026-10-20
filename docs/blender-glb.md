# Gerador de GLB das torres (Blender headless)

O VistaHub gera localmente um modelo GLB detalhado de cada torre a partir dos mesmos parâmetros que o visualizador usa (`Building.floorCount`, `floorHeight`, `unitsPerFloor` e `model3d`). Tudo roda na máquina, com o Blender (GPL, uso comercial livre — a licença do Blender não se estende aos arquivos que ele gera) e sem serviço pago, chave de API ou rede.

A geometria é **paramétrica**: dimensões vêm do cadastro (medidas informadas pela construtora), não de fotos. Detalhes como caixilhos, peitoris e frisos usam medidas típicas de projeto, servem para a maquete de vendas e não substituem o projeto executivo.

## Requisitos

- Blender 4.2 LTS ou mais novo (testado com 5.2.2 LTS). A versão portátil (zip) basta; não precisa instalar.
- No `.env` da raiz:

  ```
  BLENDER_PATH="D:/construtora/tools/blender-5.2.2-windows-x64/blender.exe"
  # opcionais
  BLENDER_TIMEOUT_MS=180000
  BLENDER_SCRIPT=   # caminho alternativo do build_tower.py
  ```

Sem `BLENDER_PATH`, ou com um caminho inexistente, o endpoint responde `503` com a mensagem explicando o que configurar. Reinicie a API depois de alterar o `.env`.

## Como usar

**Painel:** Torres e pavimentos → selecione a torre → em *Maquete 3D*, salve os parâmetros e clique em **Gerar modelo 3D (Blender)**. O botão mostra o tempo decorrido; ao terminar aparece a versão registrada (ou o erro) e o histórico das últimas gerações. O GLB vira uma nova versão do modelo 3D do empreendimento, mas **não é ativado automaticamente** (um GLB cobre uma torre só); ative-o no Estúdio 3D se for o caso.

**API:**

| Método | Rota | O que faz |
|---|---|---|
| `POST` | `/api/v1/buildings/:id/model/generate` | Gera o GLB (síncrono). JWT + perfil de edição. Uma geração por torre de cada vez (`409` se já houver uma em andamento). |
| `GET` | `/api/v1/buildings/:id/model/jobs` | Últimas 10 gerações da torre (status, erro, duração). |

Erros: `400` parâmetros inválidos (mensagem do script), `503` Blender ausente, `504` tempo limite, `500` falha do Blender (últimas linhas do stderr ficam em `GenerationJob.error`).

O que fica gravado (só tabelas existentes):

- `GenerationJob` (`kind = MODEL_GENERATION`, `provider = 'blender'`): entrada, saída, erro, início/fim.
- `DevelopmentAsset` (`kind = MODEL_3D`, `buildingId` da torre) no armazenamento local privado (`LOCAL_STORAGE_PATH/<empreendimento>/<uuid>-T<código>-blender.glb`), com os parâmetros e estatísticas em `metadata`.
- `ModelVersion` (próximo número de versão, `label` “<torre> — modelo paramétrico (Blender)”).
- `ThreeDGeneration` (`mode = PARAMETRIC`, `provider = PARAMETRIC`) ligando o job à versão.

**Linha de comando** (sem a API):

```bash
blender -b --factory-startup --python scripts/blender/build_tower.py -- torre.json torre.glb
```

Saída `0` com uma linha `VH_RESULT {...}` no stdout; `2` para parâmetros inválidos e `1` para falha do Blender, com `VH_ERROR <mensagem>` no stderr.

## Parâmetros (JSON de entrada)

```json
{
  "code": "A", "name": "Torre A",
  "floorCount": 12, "floorHeight": 2.9, "unitsPerFloor": 8,
  "floors": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  "model3d": {
    "width": 32, "depth": 16,
    "colors": { "facade": "#e6ebe8", "accent": "#e0622a", "roof": "#d8dbd6", "base": "#c9ccc6" },
    "unitSlots": [{ "final": "01", "side": "back", "column": 0 }]
  }
}
```

| Campo | Faixa | Padrão |
|---|---|---|
| `width`, `depth` (m) | 4–300 | 32 × 16 |
| `floorCount` | 1–200 | 1 |
| `floorHeight` (m, piso a piso) | 2,2–8 | 2,9 |
| `floors` | um inteiro por pavimento, de baixo para cima | `0 … floorCount-1` |
| `unitSlots` | até 64; `side` `front`/`back`, `column` 0–31, `final` único | derivado de `unitsPerFloor` como no visualizador (metade no fundo, metade na frente) |
| `colors` | `#rrggbb` | as do visualizador |

`width`, `depth`, `colors` e `unitSlots` também são aceitos no nível de cima. `position` é ignorado (o GLB fica centrado na origem; a posição no terreno continua em `Building.position`). A API monta esse JSON a partir do registro da torre e envia `floors` com a numeração real quando o número de pavimentos cadastrados bate com `floorCount`.

## Geometria

Referencial idêntico ao do visualizador: metros, Y para cima, `x` = largura, `z` = profundidade, lado `front` em `z` negativo, base da torre em `y = 0`.

- Duas lâminas separadas pelo núcleo central (largura do núcleo `min(4,2 m; 12 % da largura)`).
- Painéis de fachada por apartamento em dois tons alternados, com 14 cm de espessura e **vãos reais**: as janelas ficam recuadas 9 cm (vidro a 5 cm da alvenaria), com caixilho de quatro perfis, montante central e peitoril com pingadeira. Janela de banheiro entre as duas janelas principais quando há espaço.
- Frisos de laje a cada pavimento, platibanda de 1,10 m com rufo, casa de máquinas e reservatório na cobertura, embasamento.
- Núcleo na cor de destaque com os vãos dos patamares recuados (até 60 cm), lajes de patamar em balanço e guarda-corpo com corrimão, travessa e montantes.
- Chanfro (modificador Bevel, aplicado na exportação) nas arestas do corpo e dos volumes da cobertura.

Materiais PBR (Principled BSDF → `pbrMetallicRoughness`), com nomes estáveis para o visualizador localizar: `VH_Wall`, `VH_Roof`, `VH_PanelA`, `VH_PanelB`, `VH_Trim`, `VH_Frame` (metálico), `VH_Glass` (rugosidade 0,05), `VH_GlassLit` (mesmo vidro, com `extras.vh_emissive = "#ffc56a"` e emissão 0), `VH_Accent`, `VH_CoreVoid`, `VH_Rail`, `VH_Base`, `VH_Unit` (translúcido).

Exportação: glTF binário 2.0, Y para cima, transformações aplicadas, **Draco desligado** (compatibilidade com qualquer carregador), sem câmeras/luzes, propriedades customizadas exportadas como `extras`.

## Nomes dos nós

`{code}` é o código da torre com caracteres fora de `[A-Za-z0-9_.]` trocados por `_` (ex.: `TORRE-01` → `TORRE_01`), para que o `-` continue separando as partes do nome.

```
T{code}                       raiz (extras: vh_role = "tower", vh_params = JSON dos parâmetros)
├── T{code}-visual            geometria visual (coleção "visual" no Blender)
│   ├── T{code}-body          lâminas (alvenaria + cobertura)
│   ├── T{code}-panels        painéis de fachada
│   ├── T{code}-trim          peitoris, frisos, platibanda
│   ├── T{code}-frames        caixilhos
│   ├── T{code}-glass         vidros que ficam apagados       (extras.vh_role = "glass")
│   ├── T{code}-glass-lit     vidros que acendem ao entardecer (extras.vh_role = "glass-lit")
│   ├── T{code}-core          núcleo, vãos e patamares
│   ├── T{code}-rails         guarda-corpos
│   ├── T{code}-roof-equipment
│   └── T{code}-base
└── T{code}-units             volumes comerciais (coleção "units")
    └── T{code}-F{andar}-U{final}   um por apartamento
```

Os volumes `T{code}-F{andar}-U{final}` são caixas simples, separadas da geometria visual, para seleção/raycast e para o vínculo nó → unidade do editor de implantação. `{andar}` é o número do pavimento (`floors`), `{final}` o final da unidade (só letras e números). A translação do nó é o centro do apartamento (sem rotação/escala), e `extras` traz `vh_role = "unit"`, `vh_building`, `vh_floor` e `vh_final`. A altura usa a posição do pavimento na lista (o primeiro pavimento fica no chão), como o visualizador faz com a numeração 0…N-1.

Para acender as janelas ao entardecer, o visualizador pode localizar `T{code}-glass-lit` (ou o material `VH_GlassLit`) e definir a cor emissiva a partir de `extras.vh_emissive`. Os vidros acesos são sorteados com o mesmo gerador congruente do visualizador, semeado pelo código da torre — o resultado é determinístico.

## Testes

```bash
npm test --workspace=@vistahub/api
```

```bash
python scripts/blender/test_build_tower.py
```

O teste Node (`apps/api/test/tower-glb.test.mjs`) cobre a montagem dos parâmetros, as mensagens de erro e, quando `BLENDER_PATH` existe, gera uma torre de 3 pavimentos e confere cabeçalho GLB, nomes dos nós, `extras`, posição de um apartamento e ausência de Draco. O teste Python roda a parte pura do script (parâmetros, volumes, orientação das faces, determinismo) e, com o Blender disponível, uma exportação completa. Sem Blender, as partes que dependem dele são puladas.

## Limites

- Uma tipologia de fachada (duas lâminas + núcleo central). Torres em L, escalonadas, com varandas em balanço ou fachadas específicas exigem um novo módulo de geometria ou modelagem manual importada como GLB.
- Sem texturas (só cores PBR) e sem UVs úteis; sem interiores.
- Torre de 30 pavimentos com 8 apartamentos por andar: ~50 mil faces, ~5 MB, poucos segundos. Torres muito altas geram arquivos grandes, já que o Draco fica desligado de propósito.
- Geração síncrona dentro da requisição; uma por torre de cada vez. Para filas maiores, levar a chamada para um worker (o registro em `GenerationJob` já está pronto para isso).
- Os volumes dos apartamentos seguem `unitSlots` (grade frente/fundo × colunas), não a planta real.

## Reconstrução 3D a partir de imagens (avaliação, não implementado)

Existem modelos abertos que geram uma malha 3D a partir de uma ou poucas imagens e rodam localmente. Foram avaliados como possível complemento (ex.: mobiliário, elementos de paisagismo), **não** como fonte da geometria das torres. Licenças e requisitos abaixo conforme publicados pelos projetos até 2025 — confirmar a versão vigente antes de adotar.

| Modelo | Licença | Uso comercial | GPU (RTX 4060 Ti 8 GB) |
|---|---|---|---|
| **TRELLIS** (Microsoft) | Código e pesos MIT | Permitido pelo MIT, mas o pipeline usa dependências com licença NVIDIA não comercial (ex.: `nvdiffrast`) para renderizar/extrair texturas; seria preciso substituí-las ou licenciá-las | O projeto pede GPU com ≥ 16 GB; não roda de forma prática em 8 GB |
| **Hunyuan3D-2 / 2mini** (Tencent) | Tencent Hunyuan 3D Community License | Permitido com condições: não vale na União Europeia, Reino Unido e Coreia do Sul; acima de 1 milhão de usuários ativos mensais exige licença própria; obrigações de atribuição e política de uso | 2mini (forma, ~0,6 B parâmetros) cabe em ~5–6 GB; forma + textura do Hunyuan3D-2 pede ~16 GB — em 8 GB só a malha sem textura, ou com offload lento |
| **InstantMesh** (TencentARC) | Apache 2.0 | Permitido pelo Apache 2.0, mas depende do Zero123++ (base Stable Diffusion, licença RAIL com restrições de uso) e do `nvdiffrast` (NVIDIA, não comercial) | Funciona em 8 GB com ajustes, perto do limite |

**Fidelidade:** essas redes inventam as partes que a foto não mostra e não têm escala métrica — a malha sai normalizada num cubo unitário, com proporções aproximadas, faces irregulares e geometria fundida (janelas e lajes viram relevo de textura). Os modelos resultantes **não são dimensionalmente precisos** e **não podem ser usados como geometria arquitetônica** (volumes de torre, áreas, alturas, posição de apartamentos) sem validação contra medidas reais (projeto, levantamento topográfico ou fotogrametria com pontos de controle). No VistaHub, a geometria comercial continua vindo dos parâmetros medidos; um eventual uso desses modelos ficaria restrito a elementos decorativos, sempre identificados como ilustrativos.
