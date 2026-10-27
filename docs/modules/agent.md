# Central do Agente

Console em `/console/` (`apps/console`), namespace WebSocket `/agent`.

## Autenticação

`POST /auth/login { email, password }` → `{ token, role, name }`; `GET /auth/me` devolve `selfId`, filas, classificações e `maxConcurrentAssignments`; `POST /auth/logout` apaga a sessão. Login usa limite por IP e conta compartilhado no PostgreSQL. Logout e expiração encerram sockets; revogação entre réplicas exige Redis.

## Filas autorizadas

`agent_queues` define as filas do agente. `queue.subscribe` entra nas salas dessas filas. Ler um atendimento `queued` exige estar na fila; um atendimento `assigned` só é visível ao agente dono.

## Atendimentos simultâneos

Limite por tenant: `tenants.max_concurrent_assignments` (padrão 3, 1–100). Acima do limite o claim responde `capacity`. O console mantém vários atendimentos abertos e contadores de não lidas por conversa.

## Operações

| Operação | Regra |
|---|---|
| Assumir (`conversation.claim`) | Atendimento `queued`, agente da fila, presença efetiva `available`. `UPDATE` atômico; perdedor recebe `already_claimed` |
| Devolver (`conversation.release`) | Só o agente dono; volta a `queued`, reseta `queued_at` |
| Transferir (`conversation.transfer`) | Só para **fila**, e só para fila em que o agente está escalado; volta a `queued` |
| Encerrar (`conversation.close`) | Exige classificação; vai a `awaiting_survey` |
| Mensagem / leitura | Só o agente dono, com atendimento `assigned` |

Repetir o encerramento com a mesma classificação devolve o estado atual sem novo evento; classificação diferente → `conflict`. Transferência direta para outro agente **não existe**.

## Estados

`queued → assigned → awaiting_survey → closed`; `release` e `transfer` voltam a `queued`; `leave` (visitante) leva `queued` a `closed`. Diagrama: [attendance-states](../diagrams/rendered/attendance-states.svg).

## Permissões

Agentes não publicam anúncios, não gerem setores/tipos de atividade e não enviam mensagens como supervisor. Ver [STATUS.md](../STATUS.md).
