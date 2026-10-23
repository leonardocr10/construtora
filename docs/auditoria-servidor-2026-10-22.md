# Auditoria do visualizador publicado

Endereco examinado: http://66.94.100.166:4300/union-vista. Coleta em 22/10/2026 (horario de Brasilia).

## Causa confirmada da perda de qualidade

O acesso HTTP por IP remoto nao e contexto seguro. No Chrome de teste `isSecureContext=false` e `navigator.gpu` ausente. Localhost e uma excecao de desenvolvimento; nao e equivalente a esse endereco publico. WebGPU requer contexto seguro: https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips.

O bundle publicado usa WebGL como fallback e associa automaticamente esse motor ao modo de compatibilidade. Esse modo força `eco`, limita o buffer a 921.600 pixels e remove sombras, SSAO e o pipeline de pos-processamento. A escolha de qualidade e sobrescrita por `setQuality`. WebGL nao exige essa restricao visual; ela foi uma protecao do aplicativo apos o relato de piscadas de monitor, nao uma limitacao inerente do motor.

Teste publicado, viewport 1440 x 900:

| Verificacao | Resultado |
| --- | --- |
| Motor / qualidade | WebGL / eco |
| Compatibilidade | Ativa |
| Buffer real | 1214 x 758 |
| Sombras / SSAO / pipeline | Todos ausentes |
| Texturas da biblioteca | Baixa resolucao |
| Escolher Alta | Continua eco |
| GLB das quatro torres | HTTP 200; todos carregados |
| Erros de execucao | Nenhum |
| Falha HTTP | Apenas favicon 404 |

## Download e versao publicada

O servidor ja negocia gzip para JavaScript e GLB. As quatro torres detalhadas transferiram aproximadamente 2,29 MB no conjunto; portanto nao faltam os modelos e nao ha indicio de perda de geometria causada pela compressao. O backend publicado tem versoes de assets diferentes das locais; esta auditoria nao valida equivalencia geometrica entre esses arquivos.

A abertura registrou 167 recursos e aproximadamente 6,08 MB de transferencia. Os GLB das quatro torres foram baixados automaticamente. O bundle publicado (`index-Dy3IAT-f.js`) ainda nao contem a politica local de detalhes sob demanda. Os estaticos examinados responderam com `Cache-Control: no-cache`, diferente da politica local de cache imutavel para chunks com hash. Gzip existe; Brotli e cache longo nao foram observados nas respostas examinadas.

Primeira interacao em 22,1 s e termino em 31,0 s no Chrome headless com WebGL por software. Esses tempos NAO medem um celular ou GPU real e NAO devem ser comparados diretamente ao teste local de rede limitada. Captura e medidas brutas: `bench-out/server-audit/`. Reproducao: `node scripts/bench/server-audit.mjs`.

## Correcao recomendada, por prioridade

1. Separar modo de seguranca de qualidade: WebGL e celular nao devem significar obrigatoriamente qualidade minima. Manter modo seguro explicito e interrupcao em perda de contexto; evitar simplesmente obrigar Ultra ou recomendar `seguro=0` no aparelho que piscou.
2. Usar qualidade adaptativa com limites de pixels, sombras de custo controlado e preservacao dos materiais/proximidade. Reduzir primeiro entorno distante e efeitos caros, nao eliminar automaticamente o acabamento do empreendimento.
3. Publicar com HTTPS valido, preferencialmente dominio e proxy de producao. Isso permite WebGPU nos navegadores/aparelhos compativeis, mas nao garante suporte nem resolve sozinho o custo da cena ou a politica de qualidade no celular.
4. Publicar os ajustes de detalhes sob demanda e compressao/cache de estaticos. Eles reduzem rede; nao corrigem sozinhos a politica visual atual. Carros, vegetacao e shaders tambem participam do custo inicial.
5. Validar no mesmo celular, camera e rede: primeiro quadro, bytes, estabilidade de frames e captura comparativa. Nao usar apenas o numero de FPS do motor como medida de velocidade de carregamento.

Nenhuma configuracao remota, banco ou dado publicado foi alterado durante a auditoria. Apenas requisicoes publicas de leitura e um navegador de teste isolado.
