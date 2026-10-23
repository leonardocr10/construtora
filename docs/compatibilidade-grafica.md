# Tela branca, perda de contexto e modo seguro

Relato: a interface/rotulos aparecem sem a cena, e o monitor inteiro de outra maquina pisca ao abrir o 3D. Nao foi possivel inspecionar a GPU, o driver ou o navegador daquela maquina. Portanto nao se afirma que a causa do monitor foi diagnosticada ou resolvida remotamente.

## Problemas encontrados no aplicativo

- O carregador era removido assim que a geometria do terreno ficava pronta no CPU, antes de confirmar quadros desenhaveis. Agora espera dois quadros com malha visivel/pronta; os rotulos ficam ocultos antes disso. Ha timeout e aviso de falha em vez de uma interface aparentemente pronta sobre fundo branco.
- WebGL podia executar o mesmo pipeline pesado de HDR, SSAO, MSAA e sombras em cascata dos perfis altos. Uma preferencia Ultra antiga ainda podia ser aplicada ao novo dispositivo.
- O passeio criava um segundo contexto, buffer proporcional a DPR ate 2, MSAA 4x, sombra 2048 e ate 14 luzes por material. Pausar o exterior nao libera seus recursos.
- Durante o teste de perda de contexto, o ajuste de camera nos observables de projecao produziu `Maximum call stack size exceeded`. Protecoes de reentrada e buffer valido foram adicionadas ao exterior e ao interior.

## Comportamento novo

- Atualizacao: a abertura normal inicia sempre em Alta, inclusive WebGL/IP e celular, sem rebaixamento automatico. Preferencias antigas nao determinam a abertura. Compatibilidade agora exige `?seguro=1`: perfil Baixa, sem pos-processamento HDR/MRT, SSAO, bloom, MSAA ou sombras, com seletor limitado.
- Limite de aproximadamente 1280 x 720 pixels de area no buffer de compatibilidade, preservando a proporcao da janela. Os perfis normais ficam limitados a area Full HD. Isso nao altera o tamanho dos controles HTML.
- Compatibilidade: alvo de ate 30 quadros/s, mil arvores no entorno e uma torre detalhada carregada de cada vez. A renderizacao para em abas ocultas. Sao limites, nao garantias de FPS.
- Passeio: mesmo limite de resolucao, ate quatro luzes por material, sem pipeline/sombras no modo de compatibilidade. Caminho normal reduzido a oito luzes, MSAA 2x e sombra 1024. O carregador interno tambem espera quadros visiveis.
- Nao forca `high-performance` ao criar o contexto: WebGL usa a preferencia padrao; WebGPU solicita low-power. Isso nao controla diretamente o monitor nem permite garantir que um driver nao falhe.
- Ao perder o contexto WebGL: para de renderizar, cancela detalhes de torres ainda na fila e mostra recuperacao manual. Nao reconstruir automaticamente todos os buffers no mesmo contexto apos essa falha. Sem loop de recarga de pagina.

## Uso

Depois de publicar este build, acrescentar `?seguro=1` ao endereco, por exemplo:

`http://localhost:4300/union-vista?seguro=1`

Isso forca WebGL conservador mesmo em localhost/HTTPS com WebGPU disponivel. Sem parametro, o sistema abre em Alta tambem por IP/HTTP usando WebGL; `seguro=0` nao e mais necessario para liberar esse caminho. Na maquina que apresentou piscadas, usar `seguro=1` e investigar o driver antes de testar Alta novamente.

Se o monitor inteiro piscar novamente, fechar a aba e investigar navegador/GPU/driver antes de repetir testes. Nao desativar protecoes de timeout do driver ou forcar aceleracao como tentativa de conserto.

## Validacao

- `node scripts/bench/check-graphics-safety.mjs`: politica de compatibilidade, orcamento de pixels 4K/retina, dois quadros prontos, timeout, encerramento, perda de contexto e protecao contra recursao na projecao.
- `check-viewer-loading.mjs`, `check-unit-selection.mjs`, `check-interior.mjs`, `check-pilot-finishes.mjs`, `check-ground.mjs` e build do visualizador aprovados.
- Navegador headless isolado com ANGLE SwiftShader (WebGL por software, sem provocar falha real no driver do monitor): exterior e interior visiveis, perfil Baixa, buffer 1214 x 758 em janela 1280 x 800, sem pipeline/SSAO/sombras.
- Perda de contexto simulada com `WEBGL_lose_context` depois de fechar o interior: renderizacao interrompida, rotulos ocultos e link de recuperacao manual visivel, sem recursao da camera. Nao e uma reproducao da piscada fisica no computador do usuario.
- Capturas: `D:/construtora/_shots/safe-webgl-overview.png`, `safe-webgl-interior.png` e `safe-webgl-context-lost.png`.

Referencia: [boas praticas WebGL e buffers menores](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices) e [evento de perda de contexto](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/webglcontextlost_event).
