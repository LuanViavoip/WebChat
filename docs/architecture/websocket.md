# Servidor WebSocket

Socket.IO 4, **somente** transporte `websocket`, `maxHttpBufferSize` 100 000. Contratos completos de payload: [contracts.md](../contracts.md) (fonte: `packages/protocol/src/events.ts`).

## Namespaces e autenticação

| Namespace | Aceita | Handshake |
|---|---|---|
| `/visitor` | sessão de visitante | `auth: { token }` |
| `/agent` | papel `agent` | `auth: { token }` |
| `/supervisor` | papéis `supervisor` e `admin` | `auth: { token }` |

O `auth` deve conter **exatamente** `{ token }` (20–200 caracteres); chave extra é rejeitada (`auth/handshake.ts`). O token é o obtido por `POST /visitor/sessions` ou `POST /auth/login`.

## Comandos (cliente → servidor) e ack

`realtime/bind.ts` associa cada evento a um schema Zod do namespace:

- evento fora do mapa do namespace → `{ ok: false, error: { code: "forbidden" } }`;
- payload inválido → `invalid_payload`;
- sucesso → `{ ok: true, ... }`, **enviado depois do commit**.

Erros HTTP/WS: `unauthorized` 401, `forbidden` 403, `not_found` 404, `invalid_payload` 400, `invalid_state`/`already_claimed`/`capacity`/`conflict` 409, `rate_limited` 429, `internal` 500.

| Namespace | Comandos |
|---|---|
| `/visitor` | `queue.list`, `conversation.start`, `conversation.leave`, `message.send`, `history.sync`, `survey.submit` |
| `/agent` | `queue.subscribe`, `conversation.claim`, `conversation.release`, `conversation.transfer`, `conversation.close`, `message.send`, `message.read`, `history.sync`, `presence.set`, `presence.heartbeat` + bloco comum |
| `/supervisor` | `conversation.list`, `conversation.watch`, `conversation.transfer`, `history.sync`, `presence.heartbeat`, `supervisor.snapshot`, `sector.save`, `sector.member.add`, `sector.member.remove`, `announcement.publish`, `announcement.update`, `announcement.archive`, `activity.type.save` + bloco comum |

**Bloco comum** (agente, supervisor, admin): `sector.list`, `internal.list`, `internal.open`, `internal.message.send`, `internal.history`, `internal.message.read`, `announcement.list`, `announcement.read`, `activity.catalog`, `activity.assign`, `activity.finish`, `activity.history`.

Observações verificadas no código: o supervisor **não** tem `message.send`, `message.read` nem `presence.set`. Comandos de gestão ausentes do mapa do agente respondem `forbidden` pelo `bindSocket`.

## Eventos (servidor → cliente)

`conversation.updated`, `message.new`, `survey.required`, `queue.position`, `presence.updated`, `message.read`, `sector.updated`, `internal.conversation.updated`, `internal.message.new`, `internal.message.read`, `announcement.published`, `announcement.updated`, `activity.updated`, `supervisor.metrics`.

Distinção: **comando** = pedido do cliente com ack; **evento** = notificação do servidor sem ack, que só avisa quem já está conectado e autorizado. O estado durável está sempre no PostgreSQL.

## Salas e fan-out (`realtime/rooms.ts`, `hub.ts`)

`tenant:{t}:conversation:{id}`, `queue:{id}`, `agent:{id}`, `supervisors`, `internal:{id}`, `sector:{id}`.

- `conversation.updated` → sala do atendimento (visitante), sala da fila (e da fila anterior em transferência), sala do agente dono e supervisores autorizados pela fila.
- `message.new` → visitante; fila se `queued`, agente dono se não; administradores e supervisores autorizados pela fila.
- `supervisor.metrics` é empurrado a cada mudança (`hub.touch` → `refreshSupervisors`).

## Reconexão

- Visitante: `history.sync { afterMessageId?, afterEventId? }` devolve conversa, mensagens e eventos posteriores, mais `lastReadMessageId`. Cursor desconhecido → `invalid_payload`.
- Mensagens usam `requestId` (UUID) gerado no cliente; reenvio com o mesmo `requestId` devolve `created: false` sem novo broadcast.
- Chat interno: o console usa `internal.history` com cursores e ressincroniza a conversa aberta ao reconectar.
- Fechar a conexão não retira o contato da fila.

## Limitações

Logout e expiração desconectam sockets; em múltiplas réplicas, a revogação distribuída depende do Redis. Eventos não passam por outbox (F4-07).
