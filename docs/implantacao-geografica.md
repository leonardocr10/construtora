# Implantação geográfica da maquete

Plano para fazer a maquete respeitar a implantação original e as posições geográficas reais, para qualquer empreendimento do VistaHub. Este documento registra a convenção de coordenadas (já em vigor), o que foi entregue e as próximas etapas, na ordem combinada: geometria e posicionamento antes de efeitos gráficos.

## Convenção de coordenadas (em vigor)

| Item | Definição |
|---|---|
| Unidade | metro |
| Origem | `Development.latitude/longitude` (o ponto da arte em `publicLayout.origin` cai aqui) |
| Eixos da cena | x = leste, z = sul, y = para cima (Three.js, mão direita) |
| Norte geográfico | −z |
| Projeção | plano tangente local sobre o elipsoide WGS84 (`LocalFrame` em `packages/geo`) |
| Implantação → cena | `local = R(azimute) · (pixel − origem) · metrosPorPixel`, com `R(θ) = [[cos θ, −sin θ], [sin θ, cos θ]]` no plano (x, z) |
| Azimute | rumo, a partir do norte e no sentido horário, para onde aponta o topo da imagem |

Latitude/longitude nunca são usadas como metros: toda conversão passa por `LocalFrame`. O entorno do OpenStreetMap passou a usar o mesmo referencial (antes usava constantes fixas, com cerca de 0,15% de erro na latitude de Uberlândia, ou seja, uns 2,5 m na borda do raio de 1,6 km). O cache do entorno guarda a versão do referencial (`frame: local-wgs84-v1`) e é refeito quando ela muda.

## Calibração por pontos de controle (entregue: cálculo)

`packages/geo` (`calibrate`) recebe pontos de controle, cada um ligando um pixel da arte a uma coordenada geográfica verificada, e devolve:

- `metersPerPixel`, `azimuth` e `origin`, nos mesmos campos que o visualizador já usa em `publicLayout`;
- o resíduo de cada ponto (dx, dz e erro, em metros), o erro médio (RMS) e o máximo;
- diagnóstico de distorção (ajuste afim com 4 ou mais pontos: diferença de escala entre x e y e cisalhamento);
- avisos: poucos pontos, pontos alinhados, ponto com resíduo alto, arte espelhada, arte distorcida, escala diferente da medida;
- situação: `insuficiente` (menos de 2 pontos, sem transformação), `aproximada` ou `verificada` (4 ou mais pontos, erro dentro da tolerância e sem distorção).

Com 2 pontos o ajuste é exato por construção e não mede erro, então nunca sai como `verificada`. Testes: `npm test --workspace=@vistahub/geo`.

**Union Vista hoje:** escala, origem e azimute foram ajustados à mão, casando a Alameda dos Mandarins e a Av. Manuel Lúcio da arte com as vias do OSM. Sem pontos de controle cadastrados, a situação desse alinhamento é **aproximada, sem medida de erro**. Os vértices do lote estão em pixels da arte, não em coordenadas medidas.

## Dependência da fase 2

A fase 2 (`fase2-editor-unidades-lotes`, ainda sem merge) traz o editor de implantação: calibração manual (escala, origem, azimute), contorno do lote editável, posição/rotação/tamanho das torres, posição das áreas de lazer e lotes. As etapas abaixo **estendem esse editor**, sem criar um paralelo. Por isso, elas só começam depois do merge da fase 2.

## Próximas etapas

1. **Calibrar implantação** (após a fase 2): no editor, a arte e um mapa (MapLibre GL JS com tiles do OSM) lado a lado; o administrador marca pares de pontos (pixel ↔ lat/lng). A API grava os pontos (tabela `LayoutControlPoint`), roda `calibrate` e mostra resíduos e avisos; aplicar grava `publicLayout` e a lat/lng do empreendimento.
2. **Perímetro do lote em coordenadas**: vértices editáveis em metros/lat-lng (além de pixels), entradas/saídas, recuos e calçadas como camadas do editor.
3. **Ruas editáveis**: o OSM continua sendo a fonte; cada via pode receber correção (traçado, largura, sentido, pavimento, calçada) ou ser criada manualmente quando faltar no OSM, gravada como sobreposição por empreendimento (o dado original fica intacto). Turf.js para buffers/interseções no editor.
4. **Torres**: transformação independente (x, z, rotação, elevação, largura, profundidade) no editor da fase 2, sem tocar pavimentos e unidades.
5. **Estacionamento e acessos**: fileiras de vagas parametrizadas (início, direção, quantidade, passo, lado) ou manuais, aprovadas no editor; o visualizador instancia carros só nas vagas aprovadas. A detecção automática atual vira sugestão inicial.
6. **Lazer**: cada ponto (1 a 14 no Union Vista) com ID, nome, coordenada, tipo de modelo, ícone, fotos e descrição; posição sempre pela coordenada cadastrada, nunca pela ordem.
7. **Fachadas e materiais**: materiais PBR configuráveis por torre (cor, roughness, metalness, normal map, AO), mantendo a geometria comercial (apartamentos clicáveis) separada da visual.
8. **Iluminação, paisagismo e níveis de qualidade**: Econômico, Equilibrado, Alto e Ultra, com redução automática no celular.
9. **Comparar implantação**: arte original à esquerda e vista superior ortográfica da cena à direita, com sobreposição transparente, camadas (perímetro, torres, ruas, lazer, pontos de controle) e marcação de divergências, cada elemento como confirmado ou a revisar.
10. **Versões**: cada publicação da configuração geográfica (calibração, perímetro, ruas, vagas, torres, lazer, câmera) gera uma versão restaurável no MySQL.
