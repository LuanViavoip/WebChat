# Contratos

Os schemas vivem em `packages/protocol` e rejeitam campos desconhecidos.

## HTTP

`GET /public/widgets/:publicId`

Devolve nome, filas, cor, logotipo, boas-vindas, se o nome é obrigatório e se o atendimento está aberto. Não cria visitante e não devolve token. O `publicId` não é credencial.

`POST /visitor/sessions`

```json
{ "sitePublicId": "site_a", "parentOrigin": "http://localhost:8090" }
```

`parentOrigin` precisa estar em `allowed_origins` do site. A allowlist reduz uso casual do identificador público; não autentica o site hospedeiro.

Resposta: `token`, `siteName`, `primaryColor`, `logoUrl`, `welcomeMessage`, `requireVisitorName`, `acceptingChats`, `allowedOrigins`, `queues`.

`GET /visitor/me` com `Authorization: Bearer` devolve a mesma configuração do site, sem token.

`POST /auth/login`

```json
{ "email": "ana@tenant-a.local", "password": "demo-pass-123" }
```

Resposta: `token`, `role`, `name`.

`GET /auth/me` devolve `selfId`, `name`, `role`, `queues`, `dispositions` e `maxConcurrentAssignments`.

`POST /auth/logout` encerra a sessão.

Erros: `{ "error": { "code", "message" } }`.

## Visitante

- `queue.list` `{}`
- `conversation.start` `{ queueId, displayName? }` — equivale a `visitor.join_queue`
- `conversation.leave` `{ conversationId }` — equivale a `visitor.leave_queue`; só em `queued`
- `message.send` `{ conversationId, requestId, body }`
- `history.sync` `{ conversationId, afterMessageId?, afterEventId? }`
- `survey.submit` `{ conversationId, score, comment? }`

## Agente

- `queue.subscribe` `{}`
- `conversation.claim` `{ conversationId }` — equivale a `agent.claim_conversation`
- `conversation.release` `{ conversationId }` — equivale a `agent.release_conversation`; só o agente dono
- `message.send`
- `conversation.transfer` `{ conversationId, queueId }`
- `conversation.close` `{ conversationId, dispositionId }`
- `history.sync`
- `presence.set` `{ status }` — `available`, `busy` ou `away`
- `presence.heartbeat` `{}`
- `message.read` `{ conversationId, messageId }`

## Supervisor e administrador

O administrador usa o mesmo canal `/supervisor`.

- `conversation.list` `{}`
- `conversation.watch` `{ conversationId }` — grava auditoria
- `conversation.transfer`
- `history.sync`
- `presence.heartbeat` `{}`
- `sector.list` `{}`
- `sector.save` `{ sectorId?, name, description?, active?, supervisorIds? }`
- `sector.member.add` `{ sectorId, agentId }`
- `sector.member.remove` `{ sectorId, agentId }`
- `internal.list` `{}`
- `internal.open` `{ peerId }`
- `internal.message.send` `{ conversationId, requestId, body }`
- `internal.history` `{ conversationId, beforeMessageId?, afterMessageId?, limit? }`
- `internal.message.read` `{ conversationId, messageId }`
- `announcement.list` `{ includeArchived? }`
- `announcement.publish` `{ title, body, pinned?, audience, sectorIds?, expiresAt? }`
- `announcement.update` `{ announcementId, title, body, pinned?, expiresAt? }`
- `announcement.archive` `{ announcementId }`
- `announcement.read` `{ announcementId }`
- `activity.catalog` `{}`
- `activity.type.save` `{ activityTypeId?, name, active? }`
- `activity.assign` `{ agentId, activityTypeId }`
- `activity.finish` `{ agentId }`
- `activity.history` `{ agentId? }`
- `supervisor.snapshot` `{ from?, to? }`

O agente recebe `sector.list`, o bloco `internal.*`, `announcement.list`, `announcement.read`, `activity.catalog`, `activity.assign`, `activity.finish` e `activity.history`. Os comandos de gestão respondem `forbidden` nesse canal.

`internal.history` não aceita `beforeMessageId` e `afterMessageId` juntos. O limite padrão é 50 e o teto é 100. `message.send` continua exclusivo do atendimento externo.

Evento fora da lista do canal responde `{ ok: false, error: { code: "forbidden" } }`.

## Ack de mensagem

```json
{ "ok": true, "requestId": "...", "messageId": "...", "created": true }
```

`created: false` significa que o `requestId` já estava gravado. O broadcast não é repetido.

## Eventos do servidor

- `conversation.updated` — cobre atribuição, transferência e encerramento pelo `status`
- `message.new`
- `survey.required` — equivale a `survey.available`
- `queue.position` `{ conversationId, queueId, position }` — `position` é 1-based ou `null` fora da fila
- `presence.updated` `{ agentId, status }` — `available`, `busy`, `away` ou `offline`
- `message.read` `{ conversationId, agentId, messageId }`
- `sector.updated`
- `internal.conversation.updated`
- `internal.message.new`
- `internal.message.read`
- `announcement.published`
- `announcement.updated`
- `activity.updated`
- `supervisor.metrics` — retrato da supervisão no escopo de quem está conectado

O anúncio e a mensagem interna permanecem no Postgres. O evento só avisa quem já está conectado e autorizado.

`conversation.updated` inclui `visitorDisplayName` (só o nome já informado pelo visitante, ou `null`), `agentName` e `queuedAt`. O tempo de espera parte de `queuedAt`, regravado na entrada, na devolução e na transferência. O tempo de atendimento parte de `assignedAt`.

`history.sync` também devolve `lastReadMessageId`, o cursor de leitura do agente ou `null`.

Presença:

- `available`: há conexão com heartbeat recente, o agente escolheu disponível e está abaixo do limite. Só esse estado assume atendimento.
- `busy`: conexão fresca e escolha de ocupado, ou o limite de atendimentos foi atingido. As conversas atuais permanecem.
- `away`: conexão fresca e escolha de ausente. Não assume. As conversas atuais permanecem.
- `offline`: nenhuma conexão fresca. Não assume e não encerra conversas.

O servidor calcula o status. O console só exibe e pede a mudança. Heartbeat a cada 15 segundos. Conexão sem heartbeat além de `PRESENCE_STALE_MS` (padrão 45 segundos) expira. Fechar uma aba não publica `offline` enquanto outra conexão do mesmo agente seguir fresca. A última saída publica `offline`. Queda de rede não devolve a conversa.

`conversation.claim` acima do limite responde `capacity`. Assumir o mesmo contato que outro agente já levou responde `already_claimed`. Encerrar de novo com a mesma classificação devolve o estado atual sem outro evento. Classificação diferente responde `conflict`. Pesquisa repetida responde `conflict`. Transferência de agente só alcança fila em que ele está escalado; fila de outro tenant responde `not_found`.

O nome do evento Socket.IO é o discriminador. `requestId` correlaciona o envio da mensagem. O `id` da mensagem ou de `conversation_events` é o identificador durável. `createdAt` é o instante. O ack só sai depois do commit.

Nenhum desses payloads contém `tenantId`.

`history.sync` devolve a conversa, as mensagens posteriores a `afterMessageId` e os eventos posteriores a `afterEventId`. Um cursor desconhecido responde `invalid_payload`.

O corpo da mensagem rejeita caractere nulo. Acima do limite em memória, sessão e mensagem respondem `rate_limited`. O limite vale para o processo; várias instâncias não compartilham o contador.

## postMessage

Origem do widget: `viavoip-webchat`. Origem da página: `viavoip-webchat-parent`.

Widget → página: `ready`, `open`, `close`, `resize { width, height }`.

Página → widget: `open`, `close`.

O loader só aceita mensagens cuja `event.origin` é a origem do script e cujo `event.source` é a janela do iframe.
