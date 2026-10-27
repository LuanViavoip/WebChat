# Multi-tenancy

Defesa em camadas; nenhuma depende só de filtros na consulta.

1. **Tenant derivado da sessão.** Nunca aceito do cliente; os payloads não contêm `tenantId`.
2. **`withTenant`** (`apps/server/src/db/tenant.ts`): abre transação, valida o UUID e executa `set_config('app.tenant_id', $1, true)` (local à transação).
3. **RLS forçada.** Todas as tabelas de negócio têm `ENABLE` e `FORCE ROW LEVEL SECURITY` e a política `tenant_isolation` (`tenant_id = app_tenant_id()`); `tenants` usa `tenant_self`. A única tabela sem RLS é `schema_migrations`.
4. **Papel restrito.** A aplicação conecta como `webchat_app` (NOSUPERUSER, NOBYPASSRLS). Migrations usam outro papel (`MIGRATE_DATABASE_URL`).
5. **Funções `SECURITY DEFINER`** para consultas anteriores ao tenant: `lookup_site_by_public_id`, `lookup_agent_by_email`, `lookup_auth_session`, `lookup_visitor_session`; e `sweep_stale_agent_connections` (varredura entre tenants).
6. **Grants por coluna:** `agents.password_hash`, `auth_sessions` e `visitor_sessions` não são legíveis livremente pelo papel da aplicação.
7. **Triggers de consistência** (`enforce_*`) impedem referências entre tenants (ex.: fila de outro tenant em `site_queues`).
8. **Salas WebSocket** incluem o tenant no nome.

Limites conhecidos: dentro de um tenant, o escopo do supervisor **não** é restrito por setor em atendimentos, transferência e métricas (F4-02); salas do chat interno têm falhas de reconciliação (F4-01, F4-05). Ver [STATUS.md](../STATUS.md).

Os testes `apps/server/test/isolation.test.ts` e `authz.test.ts` cobrem o isolamento entre tenants (execução: [VALIDATION.md](../docs-helper/VALIDATION.md)).
