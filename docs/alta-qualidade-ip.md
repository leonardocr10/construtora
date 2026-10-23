# Alta por padrao no IP

Toda abertura normal inicia em Alta, independentemente de HTTP/HTTPS, WebGL/WebGPU, celular e preferencia antiga no navegador. Nao ha rebaixamento automatico para Media/Baixa. O visitante ainda pode trocar a qualidade durante a visita; recarregar retorna para Alta.

HTTP por IP continua sem WebGPU nos navegadores que exigem contexto seguro; usa WebGL com sombras, materiais/texturas de alta resolucao, SSAO e pos-processamento. Nao e preciso dominio, flag insegura do navegador ou `seguro=0` para esse perfil.

Mantidos limites de recursos: buffer ate area Full HD (nao necessariamente 1920 x 1080, pois preserva proporcao e DPR), exterior com alvo de 30 FPS no celular, detalhes das torres sob demanda no celular, uma carga por vez nele, 400 arvores decorativas do entorno no celular e ate 1000 no computador. Esses limites nao alteram disponibilidade, unidades ou geometria dos GLB detalhados.

Excecao de seguranca: `?seguro=1` continua sendo uma escolha explicita de Baixa/WebGL conservador, sem efeitos caros. Falhas de contexto interrompem a renderizacao e oferecem recuperacao manual. O aparelho que teve piscadas de monitor deve usar esse link ate investigar GPU/driver; Alta nao e garantia de funcionamento em qualquer hardware.

## Publicar

Depois que os fontes forem enviados e atualizados no servidor, executar na raiz do projeto:

```sh
npm ci
npm run build:viewer
```

Reiniciar o processo do visualizador pelo gerenciador ja usado no servidor. Para iniciar o preview manualmente, o comando direto e:

```sh
npm run preview --workspace=@vistahub/viewer -- --host 0.0.0.0 --port 4300
```

Nao iniciar uma segunda instancia sobre a mesma porta. O preview serve para conferencia; em producao usar servidor estatico/proxy apropriado e negociar os arquivos compactados gerados pelo build. Depois de publicar, recarregar a pagina; nao e necessario limpar localStorage.

## Verificacao

```sh
node scripts/bench/check-graphics-safety.mjs
node scripts/bench/check-viewer-loading.mjs
```

QA local em IP da rede, HTTP sem contexto seguro e `navigator.gpu` ausente: WebGL, perfil high, compatibilidade falsa, sombras/SSAO/pipeline ativos, texturas da biblioteca sem reducao, seletor Alta efetivo. Teste com Chrome headless e GPU por software; nao mede velocidade em celular fisico. A validacao nao publica ou altera o servidor remoto.

Celular emulado, 390 x 844 e DPR 2, rede limitada a ~2 Mbit/s: Alta confirmada, buffer 585 x 1266, nenhum GLB de torre na abertura e apenas uma torre baixada apos selecionar. Card e selecao de unidade aprovados, sem erros de console. Essa execucao por software levou 42,3 s para a abertura, com cerca de 4,00 MB em recursos; nao interpretar como garantia de velocidade em hardware real. Alta elevou custo de shaders/texturas em relacao ao perfil eco historico. Mantida a prioridade visual solicitada, sem prometer que qualidade e velocidade serao iguais em todos os aparelhos.
