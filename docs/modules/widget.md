# Widget ChatWeb

## Instalação

Cole no site do cliente (exemplo do ambiente de demonstração, `infra/demo/index.html`):

```html
<script async src="http://localhost:3000/widget.js" data-widget-id="site_a"></script>
```

- `data-widget-id` (ou o alias `data-site`) é o `public_id` do site. Não é credencial.
- A origem do `src` é a origem do servidor Webchat; o loader abre `{origem}/widget/?site=<id>` em um iframe.
- Não há outras opções de inicialização nem API JavaScript: toda a configuração vem do servidor (colunas de `sites`).
- Não publique tokens: o token do visitante é emitido em runtime e nunca vai no HTML.

## Loader (`apps/widget/src/loader.ts`)

Sem o atributo, não faz nada. Uma flag global (`__viavoipWebchat`) ignora segunda carga. Cria o iframe fixo no canto inferior direito (72×72 px, z-index alto). Só aceita `postMessage` cuja origem é a do script **e** cuja `source` é a janela do iframe; trata apenas `resize` (limites 64–480 × 64–720). O widget implementa `open`/`close` recebidos, mas o loader não os envia.

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
2. Define `parentOrigin` por `document.referrer` (ou `window.location.origin` se não estiver embutido). Se não estiver em `allowed_origins`: "Este site não está autorizado".
3. `POST /visitor/sessions { sitePublicId, parentOrigin }` valida a origem, cria visitante e sessão e devolve o token. O tenant é resolvido **no servidor** a partir do site.
4. Conecta em `/visitor` com `auth: { token }`.

> `allowed_origins` reduz uso casual do identificador público; **não autentica** o site hospedeiro (declarado em [contracts.md](../contracts.md)).

Token e id da conversa ficam em `sessionStorage` (`viavoip.visitorToken`, `viavoip.conversationId`). Na abertura tenta `GET /visitor/me`; se falhar, cria nova sessão.

## Fases e seleção de fila

`loading → queues → chat → survey → closed` (e `error`). O visitante escolhe a fila (e informa nome, se exigido) e o widget envia `conversation.start`, idempotente: havendo conversa aberta, retorna a existente (`created: false`). O banco garante uma conversa aberta por visitante (`conversations_one_open_per_visitor`). "Sair da fila" só aparece em `queued`.

## Mensagens e recuperação

`message.send` com `requestId` gerado no cliente (idempotência) e timeout de ack de 8 s. Ao reconectar, `history.sync` com `afterMessageId`/`afterEventId` e mesclagem por id. **Não há reenvio automático** de mensagem que falhou.

## Pesquisa de satisfação

Ao receber `survey.required` (ou snapshot `awaiting_survey`) mostra nota 1..`scale` e comentário opcional (conforme `survey_definitions`; usa a definição ativa mais antiga). `survey.submit` fecha a conversa; uma segunda resposta devolve `conflict`. Devolução à fila e transferência não geram pesquisa.

Diagrama: [sequência do atendimento externo](../diagrams/rendered/external-chat-sequence.svg).
