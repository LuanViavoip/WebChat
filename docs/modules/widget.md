# Widget ChatWeb

## Instalação

Cole no site do cliente (exemplo do ambiente de demonstração, `infra/demo/index.html`):

```html
<script async src="http://localhost:3000/widget.js" data-widget-id="site_a"></script>
```

- `data-widget-id` (ou o alias `data-site`) é o `public_id` do site. Não é credencial.
- A origem do `src` é a origem do servidor Webchat; o loader abre `{origem}/widget/?site=<id>` em um iframe.
- A aparência e o comportamento vêm do servidor (colunas de `sites`). No `<script>`, só o posicionamento é configurável (atributos `data-offset-*`, abaixo).
- O site pode abrir e fechar o painel pela API `window.ViaVoipWebchat.open()` e `.close()` (Fase 5.5).
- Não publique tokens: o token do visitante é emitido em runtime e nunca vai no HTML.

### Atributos opcionais do `<script>` (Fase 5.5)

| Atributo | Efeito |
|---|---|
| `data-offset-bottom`, `data-offset-right` | Distância do botão às bordas, em px (padrão 16). Aceita `80`, `80px` e `5rem`; valor inválido ou negativo volta ao padrão. |
| `data-offset-bottom-var`, `data-offset-right-var` | Nome de uma variável CSS do site (`--nome`) cujo valor em px é **somado** ao deslocamento. Serve para subir o botão acima de um banner de cookies, por exemplo `data-offset-bottom-var="--cookie-banner-height"`. |
| `--viavoip-webchat-bottom`, `--viavoip-webchat-right` | Variáveis que o site pode definir no `:root` com o mesmo efeito, sem atributo. |

O loader recalcula a posição quando a janela é redimensionada ou girada, quando o teclado virtual altera o `visualViewport` e quando o site muda `style` ou `class` do `<html>`.

### API JavaScript do site

```js
window.ViaVoipWebchat.open();   // abre o painel
window.ViaVoipWebchat.close();  // volta ao botão
```

Os comandos vão ao iframe por `postMessage`, com `targetOrigin` igual à origem do `src` do script, no formato `{ source: 'viavoip-webchat-parent', type: 'open' | 'close' }`. Se o iframe ainda não avisou que está pronto (`ready`), o último comando fica pendente e é enviado quando o aviso chega.

## Loader (`apps/widget/src/loader.ts`)

Sem o atributo, não faz nada. Uma flag global (`__viavoipWebchat`) ignora segunda carga. Cria um iframe `position: fixed` no canto inferior direito, com `z-index` alto, e aplica todos os estilos como inline `!important` para o CSS do site não sobrescrevê-los. Só aceita `postMessage` cuja origem é a do script **e** cuja `source` é a janela do iframe, com `source: 'viavoip-webchat'` na mensagem.

O widget informa apenas se está **fechado ou aberto**, pelos eventos `close` e `open`; o loader calcula a geometria do iframe a partir do viewport do **site** ([geometria e correção do recorte](widget-geometria.md)). O evento `resize` do protocolo é mantido por compatibilidade com loaders antigos e só vale enquanto nenhum `open`/`close` foi recebido.

## Configurações do site (servidor)

| Coluna (`sites`) | Efeito |
|---|---|
| `allowed_origins` | Origens autorizadas a criar sessão |
| `primary_color` | Cor (hex) |
| `logo_url` | Logotipo (somente `https://`) |
| `welcome_message` | Boas-vindas (1–300 caracteres) |
| `require_visitor_name` | Exige nome |
| `accepting_chats` | Falso mostra "atendimento fechado" |

## Identificação do tenant e conexão

1. O widget consulta `GET /public/widgets/:publicId` (sem criar sessão).
2. Define `parentOrigin` por `document.referrer` (ou `window.location.origin` se não estiver embutido). Se não estiver em `allowed_origins`: "Este site não está autorizado". Desde a Fase 5.5 isso acontece **logo depois de buscar a configuração e antes de criar qualquer sessão**, e a origem validada é a única para a qual o widget envia `postMessage`. Sem origem válida, nada é enviado, o iframe fica do tamanho do botão e o botão fica inerte.
3. `POST /visitor/sessions { sitePublicId, parentOrigin }` valida a origem, cria visitante e sessão e devolve o token. O tenant é resolvido **no servidor** a partir do site.
4. Conecta em `/visitor` com `auth: { token }`.

> `allowed_origins` reduz uso casual do identificador público; **não autentica** o site hospedeiro (declarado em [contracts.md](../contracts.md)).

Token e id da conversa ficam em `sessionStorage` (`viavoip.visitorToken`, `viavoip.conversationId`). Na abertura tenta `GET /visitor/me`; se falhar, cria nova sessão.

## Aparência (Fase 5.5)

Cabeçalho navy, botões índigo e `--brand` vindo da configuração do site (cor principal definida no console). O painel tem `overflow: hidden`, lista de mensagens com rolagem e compositor fixo no rodapé; a pesquisa de satisfação rola dentro do painel. Usa `100dvh` e `env(safe-area-inset-*)` e **não** faz requisições a fontes externas: Montserrat e Open Sans só entram se já estiverem instaladas no visitante. Ao carregar, o widget não rouba o foco do site: o foco só volta ao botão depois de o painel ter sido aberto.

## Fases e seleção de fila

`loading → queues → chat → survey → closed` (e `error`). O visitante escolhe a fila (e informa nome, se exigido) e o widget envia `conversation.start`, idempotente: havendo conversa aberta, retorna a existente (`created: false`). O banco garante uma conversa aberta por visitante (`conversations_one_open_per_visitor`). "Sair da fila" só aparece em `queued`.

## Mensagens e recuperação

`message.send` com `requestId` gerado no cliente (idempotência) e timeout de ack de 8 s. Ao reconectar, `history.sync` com `afterMessageId`/`afterEventId` e mesclagem por id. **Não há reenvio automático** de mensagem que falhou.

## Pesquisa de satisfação

Ao receber `survey.required` (ou snapshot `awaiting_survey`) mostra nota 1..`scale` e comentário opcional (conforme `survey_definitions`; usa a definição ativa mais antiga). `survey.submit` fecha a conversa; uma segunda resposta devolve `conflict`. Devolução à fila e transferência não geram pesquisa.

Diagrama: [sequência do atendimento externo](../diagrams/rendered/external-chat-sequence.svg).
