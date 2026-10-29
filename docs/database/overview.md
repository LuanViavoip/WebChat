# Banco de dados — visão geral

- **Tecnologia:** PostgreSQL 16 (imagem `postgres:16-alpine` no Compose). Acesso por `pg` direto, **sem ORM**.
- **Fonte da verdade:** migrations SQL em `apps/server/migrations/001…011_*.sql`, aplicadas em ordem por `apps/server/src/db/migrate.ts` (cada arquivo numa transação; versões registradas em `schema_migrations`).
- **Catálogo gerado:** 40 tabelas, 248 colunas, 206 constraints, 81 índices, 30 triggers, 38 políticas RLS e 32 funções do projeto (as funções da extensão `btree_gist` ficam de fora).
- **Como este documento foi produzido:** as 11 migrations foram aplicadas em um PostgreSQL 16 descartável e o catálogo foi lido por `scripts/docs/introspect-schema.sh` (sem dados reais). O [dicionário de dados](data-dictionary.md) é gerado desse resultado.

| Migration | Conteúdo |
|---|---|
| 001 | Núcleo: tenants, sites, filas, agentes, sessões, visitantes, atendimentos, mensagens, eventos, pesquisa; RLS, papel `webchat_app`, funções de lookup |
| 002 | Configuração do widget em `sites` e nome do visitante |
| 003 | Mesa do agente: presença, conexões, leitura de conversa, limite de atendimentos, `queued_at` |
| 004 | Organização: setores, membros, supervisores, `sector_queues`, auditoria, papel `admin` |
| 005 | Chat interno |
| 006 | Anúncios |
| 007 | Intervalos de presença, tipos de atividade e alocações |
| 008 | Limite compartilhado de login por chaves HMAC |
| 009 | Administração da empresa: fuso, suspensão de pessoas, `auth_epoch`, aceitação de sites, janelas de atendimento, políticas de SLA, recibos de comandos e `NOTIFY` de revogação ([detalhes](../deployment/migrations-009-011.md)) |
| 010 | Validade de 24 h dos recibos de comandos |
| 011 | Função `staff_sessions_alive` para a varredura de sessões |

## Convenções

- Chaves primárias `uuid` com `gen_random_uuid()` (tabelas de junção usam PK composta).
- As tabelas de negócio por tenant têm `tenant_id`; `login_rate_limits` é global e usa chaves HMAC.
- Datas em `timestamptz` com `default now()`.
- Enumerações são `text` + `CHECK` (não há `ENUM` nativo).
- Remoção lógica por `removed_at` (membros, supervisores, participantes) e `archived_at` (anúncios).
- Idempotência de mensagens: `UNIQUE (conversation_id, request_id)` (externa e interna).
- Versão otimista de atendimento: `conversations.version`.

## Multi-tenancy, integridade e segurança

Ver [architecture/multi-tenancy.md](../architecture/multi-tenancy.md). Resumo: RLS **habilitada e forçada** nas tabelas de negócio por tenant; `schema_migrations` e `login_rate_limits` são globais (RLS forçada em 38 das 40 tabelas), política `tenant_isolation`, papel `webchat_app` sem `BYPASSRLS`, funções `SECURITY DEFINER` apenas para lookups pré-tenant e varredura de conexões, grants por coluna, triggers `enforce_*` contra referências entre tenants.

Índices que sustentam regras de negócio (únicos parciais): `conversations_one_open_per_visitor`, `presence_intervals_one_open`, `activity_assignments_one_active`; únicos de conversa interna por `sector_id` (grupo) e `pair_key` (direta).

## Retenção

**Não há política de retenção, purge ou TTL de linhas.** Sessões expiradas são ignoradas na consulta, mas não apagadas. A única política registrada é `tenants.internal_history_policy = 'retain_until_removed'`.

## Lacunas (entidades planejadas ou inconsistentes)

- O catálogo foi atualizado até a migration 011.
- `conversation_events` ganhou índices de consulta na migration 009 (por atendimento e por tenant no tempo), para o relatório de qualidade.
- Sem tabelas de: outbox de eventos, retenção/arquivamento, ligação com entidades do SM.
- A senha do papel `webchat_app` e as do Compose são valores de desenvolvimento hardcoded (migration 001 / `docker-compose.yml`); **não reutilizar fora do ambiente local**.
