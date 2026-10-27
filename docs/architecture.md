# Arquitetura

O monorepo tem três aplicações e dois pacotes:

- `apps/server` — Fastify, Socket.IO, Postgres e Redis
- `apps/widget` — interface do visitante e o `widget.js`
- `apps/console` — painel mínimo de agente e supervisor
- `packages/protocol` — schemas Zod dos payloads
- `packages/sm-adapter` — interface do SM e implementação mock

Um processo HTTP serve a API, os sockets, o widget, o console e o loader. Postgres é a fonte da verdade. Redis só replica eventos do Socket.IO entre instâncias.

## Isolamento

O cliente nunca informa `tenantId`. O servidor resolve o tenant pela sessão:

- o visitante apresenta o `public_id` do site; a função `lookup_site_by_public_id` devolve o tenant
- agente e supervisor entram com e-mail e senha; a sessão guarda o tenant do cadastro

Cada request roda numa transação com `SELECT set_config('app.tenant_id', ..., true)`. As tabelas de negócio têm RLS forçado usando esse valor. A conexão volta ao pool sem tenant residual porque o setting é local à transação.

A autorização de papel fica nas queries: agente lê a fila em que está escalado e a conversa que assumiu; supervisor lê o próprio tenant; visitante lê só as próprias conversas.

## Canais

Namespaces Socket.IO, transporte exclusivo WebSocket, token opaco no handshake:

- `/visitor`
- `/agent`
- `/supervisor`

O handshake aceita somente `{ token }`. Qualquer campo extra, inclusive `tenantId`, derruba a conexão.

## Atendimento

`queued` → `assigned` → `awaiting_survey` → `closed`

O console do agente é a central: filas autorizadas, contatos aguardando, atendimentos próprios e a conversa selecionada. A presença e o limite simultâneo são decididos no servidor. A queda do socket do visitante não tira o contato da fila; só `conversation.leave` encerra um atendimento ainda `queued`.

O claim é um único `UPDATE` condicionado a `status = 'queued'` e à fila do agente. A mensagem entra com `ON CONFLICT (conversation_id, request_id) DO NOTHING` e o ack só sai depois do `COMMIT`. Reconexão pede `history.sync` e o cliente deduplica por `messageId`.

## Widget

`widget.js` (também publicado como `loader.js`) cria um iframe para `/widget/?site=...`. O script ignora uma segunda carga. A ponte `postMessage` usa `targetOrigin` explícito. O widget só cria sessão quando a origem do `document.referrer` está em `sites.allowed_origins`. O token fica em `sessionStorage` do iframe, que é a origem do webchat.

As rooms são montadas só no servidor e incluem o tenant: `tenant:{tenantId}:queue:{queueId}`, `tenant:{tenantId}:conversation:{conversationId}`, `tenant:{tenantId}:agent:{agentId}` e `tenant:{tenantId}:supervisors`.
