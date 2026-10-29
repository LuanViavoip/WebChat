# Migrations 009 a 011

Código de referência: `02f5373`. Arquivos em `apps/server/migrations/`, aplicados em ordem por `migrate.ts` junto com `001` a `008`.

## 009_company_admin.sql — administração da empresa

**Colunas novas**

| Tabela | Colunas |
|---|---|
| `tenants` | `time_zone` (padrão `America/Sao_Paulo`) |
| `agents` | `membership_status` (`active`/`suspended`), `suspended_at`, `suspension_reason`, `auth_epoch` |
| `auth_sessions` | `auth_epoch` |
| `dispositions` | `status` (`active`/`retired`), `retired_at` |
| `sites` | `acceptance` (`accepting`/`paused`), `pause_reason` |

**Tabelas novas** (com RLS forçada por tenant)

| Tabela | Função |
|---|---|
| `site_service_windows` | Janelas semanais de atendimento do site |
| `sla_policies` | Políticas de SLA por fila, com vigência |
| `sla_policy_clocks` | Limites `queue_wait` e `first_response` de cada política |
| `company_command_receipts` | Recibos de idempotência dos comandos |

**Funções e triggers**: `sync_site_acceptance`, `enforce_site_origins_when_accepting`, `enforce_tenant_time_zone`, `enforce_site_service_window`, `enforce_sla_policy`, `enforce_sla_clock`, `enforce_sla_clocks_complete`, `enforce_sla_publication`, `enforce_company_command_actor` e `notify_auth_session_revoked` (trigger `auth_sessions_revoke_notify`, emite `webchat_session_revoke`). As funções `lookup_agent_by_email` e `lookup_auth_session` passam a recusar pessoas suspensas e sessões de época antiga.

**Outros efeitos**: extensão `btree_gist` e restrição `EXCLUDE` contra vigências de SLA sobrepostas; índice único de uma pesquisa ativa por empresa (as excedentes existentes são desativadas, mantendo a mais antiga); novos índices de consulta em `conversation_events`, `survey_responses` e `audit_events`; novas concessões de coluna ao `webchat_app`; `REVOKE UPDATE, DELETE ON audit_events`.

## 010_receipt_expiry.sql — validade dos recibos

Adiciona `company_command_receipts.expires_at` (padrão `now() + 24 h`, restrição `expires_at >= created_at`), o índice `company_command_receipts_expiry` e `GRANT DELETE` ao `webchat_app`. Ver [Comandos idempotentes](../gestao-administrativa/comandos-idempotentes.md).

## 011_staff_sessions_alive.sql — varredura de sessões

Cria a função `staff_sessions_alive(uuid[])` (`SECURITY DEFINER`, `search_path = public`), usada pela varredura em lote da revogação. Ver [Revogação de sessão](../gestao-administrativa/revogacao-de-sessao.md).

## Observações

- O servidor aplica as três migrations; o cabeçalho de `009_company_admin.sql` ainda traz o aviso da fase de desenho ("não é aplicada"), que está desatualizado.
- `docs/fase-5/migrations/` guarda só 009 e 010 como cópia histórica do desenho; a 011 existe apenas em `apps/server/migrations/`. A fonte de verdade é `apps/server/migrations/`.
- Regenere o [dicionário de dados](../database/data-dictionary.md) após mudar o schema ([Manutenção](../MAINTENANCE.md)).
