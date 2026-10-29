# Widget: geometria e correção do recorte

Código de referência: Fase 5.5. Fontes: `apps/widget/src/frame-geometry.ts`, `apps/widget/src/loader.ts`, `apps/widget/src/WidgetApp.tsx`, `apps/widget/src/panel-size.ts` e os testes `frame-geometry.test.ts` e `panel-size.test.ts`. Instalação e opções estão em [Widget ChatWeb](widget.md).

## O problema: painel cortado no canto

Antes da Fase 5.5 o widget aparecia cortado no canto inferior direito do site.

### Causa raiz

1. `WidgetApp` iniciava com `panelOpen = true`: o painel inteiro era desenhado já na carga.
2. O aviso de tamanho (`resize`) para o site só saía depois de `setParentOrigin`, que ocorria no fim de `boot()`, **depois de criar a sessão**.
3. Até esse momento, e **para sempre** se o boot falhasse (origem não autorizada, `referrer` vazio, erro de rede), o painel era desenhado dentro do iframe de 72×72 do loader. O resultado visível era o recorte no canto.

Agravantes: o widget medindo o próprio iframe (origem de um bug anterior, corrigido em `2cdc8a5`), nenhum recálculo ao redimensionar ou girar a tela, `.panel` sem `overflow`, nenhuma área segura e o anel de foco cortado pelo iframe justo ao botão.

### Correção

1. **O painel nasce fechado** quando embutido (`useState(!embedded)`).
2. **A origem é validada antes de qualquer sessão.** `authorizedParent` define `parentOrigin` logo depois de buscar a configuração do site, e essa é a única origem para a qual o widget posta. Sem origem válida o iframe continua do tamanho do botão e o botão fica inerte (`disabled`).
3. **O loader calcula a geometria pelo viewport do site**, com a função pura `frameGeometry`. O widget informa só aberto/fechado pelos eventos `open` e `close` que já existiam no protocolo. O schema de `resize` é estrito (`width` e `height`), então não ganhou um campo de modo.
4. **Recálculo contínuo**: `resize`, `orientationchange`, `visualViewport.resize` e mudanças de `style`/`class` no `<html>`.
5. **API e segurança do loader**: `window.ViaVoipWebchat.open()/close()`, estilos inline com `setProperty(..., 'important')`, guarda de instância única e validação de `event.origin` e `event.source`.

## Geometria do iframe

| Modo | Condição | Tamanho | Posição |
|---|---|---|---|
| Botão (`launcher`) | Painel fechado | **88×88 px** (botão de 72 px mais 8 px de folga por lado para sombra e foco) | O botão fica a `offset` das bordas; o iframe recua 8 px |
| Painel | Viewport de mais de 640 px de largura | `min(400, largura − direita − 16)` × `min(640, altura − base − 16)`, nunca abaixo de 200 px | Margens de pelo menos 16 px |
| Painel em tela cheia | Viewport de até 640 px de largura | `100vw` × `100dvh` | Colado às quatro bordas, sem raio e sem sombra |

O deslocamento efetivo é `data-offset-*` (padrão 16 px) mais o valor em px das variáveis CSS indicadas por `data-offset-*-var` e por `--viavoip-webchat-bottom`/`--viavoip-webchat-right`. No painel, o deslocamento nunca fica abaixo da margem de 16 px.

No modo tela cheia, a área segura (`env(safe-area-inset-*)`) é tratada **dentro** do widget.

## Mensagens entre site e widget

| Direção | `source` | `type` | Observação |
|---|---|---|---|
| Widget → site | `viavoip-webchat` | `ready` | O widget já sabe a origem do site; libera comandos pendentes |
| Widget → site | `viavoip-webchat` | `open` / `close` | Fonte do modo do iframe |
| Widget → site | `viavoip-webchat` | `resize` | Compatibilidade; só vale sem `open`/`close` |
| Site → widget | `viavoip-webchat-parent` | `open` / `close` | Enviado por `window.ViaVoipWebchat`, com `targetOrigin` = origem do iframe |

Cada lado confere a origem e a janela de quem enviou: o loader aceita só mensagens da origem do script e da janela do iframe; o widget aceita só mensagens da janela pai e da origem validada (`parentOrigin`).

## Cobertura de testes

`frame-geometry.test.ts` cobre a geometria, os estilos, os deslocamentos e o modo; `panel-size.test.ts` cobre o tamanho nominal. No navegador, `verify-visual.mjs` confere o botão de 88×88, o painel dentro do viewport nos cinco tamanhos e o caso de origem não autorizada ([Testes visuais](../fase-5.5/testes-visuais.md)).
