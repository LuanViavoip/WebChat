# Revogação de sessão

Código de referência: `02f5373`. Fontes: `apps/server/src/app.ts`, `realtime/revoke.ts`, `realtime/revoke-sweep.ts`, `auth/sessions.ts`, `config.ts`, migrations `009` e `011`.

## O que dispara

Os comandos `agent.suspend`, `agent.role_change`, `agent.queues_replace`, `agent.activity_authority`, `agent.credential_reset` e `agent.sessions_revoke` removem as sessões da pessoa (`auth_sessions`) e incrementam sua `auth_epoch`. Sessões antigas, mesmo que sobrevivam, deixam de valer: a sessão guarda a época em que nasceu e só é aceita enquanto for igual à da pessoa. Suspensão também invalida a sessão (`membership_status = 'active'` é condição de `lookup_auth_session`).

## Quatro camadas para fechar o socket

1. **Disconnect direto.** Após o commit, a rota chama `revokeRealtimeSessions`, que desconecta os sockets da sessão nos namespaces `/agent` e `/supervisor` (sala `session:<id>`). Vale para réplicas conectadas ao mesmo Socket.IO.
2. **Redis.** Com `REDIS_URL`, o adapter do Socket.IO leva o `disconnectSockets` às demais réplicas.
3. **`LISTEN`/`NOTIFY`.** O trigger `auth_sessions_revoke_notify` emite `pg_notify('webchat_session_revoke', …)` a cada `DELETE` em `auth_sessions` (inclusive expurgo e logout). Cada réplica mantém um `LISTEN` e desconecta a sessão citada.
4. **Varredura em lote.** Periodicamente a réplica coleta as sessões dos sockets de equipe (`/agent`, `/supervisor`) e consulta `staff_sessions_alive(uuid[])` (migration 011, `SECURITY DEFINER`): a sessão precisa estar dentro da validade, com pessoa ativa, `auth_epoch` igual e papel igual ao do socket. Quem não passa é desconectado.

A varredura cobre perda de mensagem do `NOTIFY` e falha do Redis. Revogação, portanto, é efetiva em no máximo o intervalo da varredura (padrão 10 s; teto 15 s).

## Intervalo da varredura

| Variável | Padrão | Regra |
|---|---|---|
| `SESSION_REVOKE_SWEEP_MS` | 10000 | Valor acima de 15000 impede a subida, salvo `NODE_ENV=test` ou `ALLOW_SLOW_REVOKE_SWEEP=true` |

Se o `LISTEN` ou o Redis ficam indisponíveis, o intervalo cai para 2 s (`degradedSweepMs`) e volta ao normal quando recuperam. A saúde do Redis é verificada com `PING` a cada varredura.

## Limites conhecidos

- Os caminhos de revogação não se desligam por variável de ambiente; testes usam opções de construção do app.
- Entre o commit e a varredura, um evento já em trânsito pode ainda chegar ao socket.
- Com mais de uma réplica, `REDIS_URL` é obrigatório (ver [Ambientes](../deployment/environments.md)).
