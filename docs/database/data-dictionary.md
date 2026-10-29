# Dicionário de dados

> Gerado por `scripts/docs/gen-database.mjs` a partir de `docs/database/generated/schema.json`, extraído por `scripts/docs/introspect-schema.sh` (migrations `apps/server/migrations/001–007` aplicadas em um PostgreSQL 16 descartável; nenhum dado real). **Não edite à mão**: altere o gerador.

Convenções: toda tabela de negócio tem `tenant_id` (FK para `tenants`), RLS **habilitada e forçada** e a política `tenant_isolation` (`tenant_id = app_tenant_id()`); `tenants` usa `tenant_self`. Tipos enumerados são `text` com `CHECK` (não há `ENUM` nativo).

## Índice de tabelas

- [`activity_assignments`](#activity_assignments)
- [`activity_types`](#activity_types)
- [`agent_connections`](#agent_connections)
- [`agent_presence`](#agent_presence)
- [`agent_queues`](#agent_queues)
- [`agents`](#agents)
- [`announcement_reads`](#announcement_reads)
- [`announcement_revisions`](#announcement_revisions)
- [`announcement_sectors`](#announcement_sectors)
- [`announcements`](#announcements)
- [`audit_events`](#audit_events)
- [`auth_sessions`](#auth_sessions)
- [`company_command_receipts`](#company_command_receipts)
- [`conversation_events`](#conversation_events)
- [`conversation_reads`](#conversation_reads)
- [`conversations`](#conversations)
- [`dispositions`](#dispositions)
- [`internal_conversations`](#internal_conversations)
- [`internal_messages`](#internal_messages)
- [`internal_participants`](#internal_participants)
- [`internal_reads`](#internal_reads)
- [`login_rate_limits`](#login_rate_limits)
- [`messages`](#messages)
- [`presence_intervals`](#presence_intervals)
- [`queues`](#queues)
- [`schema_migrations`](#schema_migrations)
- [`sector_members`](#sector_members)
- [`sector_queues`](#sector_queues)
- [`sector_supervisors`](#sector_supervisors)
- [`sectors`](#sectors)
- [`site_queues`](#site_queues)
- [`site_service_windows`](#site_service_windows)
- [`sites`](#sites)
- [`sla_policies`](#sla_policies)
- [`sla_policy_clocks`](#sla_policy_clocks)
- [`survey_definitions`](#survey_definitions)
- [`survey_responses`](#survey_responses)
- [`tenants`](#tenants)
- [`visitor_sessions`](#visitor_sessions)
- [`visitors`](#visitors)

## activity_assignments

Alocações de atividade a agentes (no máximo uma ativa por agente).

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` | PK |
| `tenant_id` | uuid | não |  | FK → tenants.id |
| `agent_id` | uuid | não |  | FK → agents.id |
| `activity_type_id` | uuid | não |  | FK → activity_types.id |
| `assigned_by` | uuid | não |  | FK → agents.id |
| `started_at` | timestamptz | não | `now()` |  |
| `ended_at` | timestamptz | sim |  |  |
| `status` | text | não |  |  |

**Chave primária:** `id`

**Chaves estrangeiras:**
- `activity_type_id` → `activity_types(id)`
- `agent_id` → `agents(id)`
- `assigned_by` → `agents(id)`
- `tenant_id` → `tenants(id)`

**Constraints (UNIQUE/CHECK):**
- `activity_assignments_check`: `CHECK ((((status = 'active'::text) AND (ended_at IS NULL)) OR ((status = 'finished'::text) AND (ended_at IS NOT NULL))))`
- `activity_assignments_status_check`: `CHECK ((status = ANY (ARRAY['active'::text, 'finished'::text])))`

**Índices:**
- `activity_assignments_agent_time`: `CREATE INDEX activity_assignments_agent_time ON public.activity_assignments USING btree (tenant_id, agent_id, started_at DESC)`
- `activity_assignments_one_active`: `CREATE UNIQUE INDEX activity_assignments_one_active ON public.activity_assignments USING btree (agent_id) WHERE (ended_at IS NULL)`
- `activity_assignments_pkey`: `CREATE UNIQUE INDEX activity_assignments_pkey ON public.activity_assignments USING btree (id)`

**Triggers:**
- `activity_assignments_agent`
- `activity_assignments_scope`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## activity_types

Catálogo de tipos de atividade (gerido por admin).

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` | PK |
| `tenant_id` | uuid | não |  | FK → tenants.id |
| `name` | text | não |  |  |
| `active` | boolean | não | `true` |  |
| `created_at` | timestamptz | não | `now()` |  |

**Chave primária:** `id`

**Chaves estrangeiras:**
- `tenant_id` → `tenants(id)`

**Constraints (UNIQUE/CHECK):**
- `activity_types_name_check`: `CHECK (((char_length(name) >= 1) AND (char_length(name) <= 120)))`
- `activity_types_tenant_id_name_key`: `UNIQUE (tenant_id, name)`

**Índices:**
- `activity_types_pkey`: `CREATE UNIQUE INDEX activity_types_pkey ON public.activity_types USING btree (id)`
- `activity_types_tenant_id_name_key`: `CREATE UNIQUE INDEX activity_types_tenant_id_name_key ON public.activity_types USING btree (tenant_id, name)`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## agent_connections

Conexões WebSocket ativas com heartbeat; base da conectividade (offline = sem conexão fresca).

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `socket_id` | text | não |  | PK |
| `agent_id` | uuid | não |  | FK → agents.id |
| `tenant_id` | uuid | não |  | FK → tenants.id |
| `connected_at` | timestamptz | não | `now()` |  |
| `last_heartbeat_at` | timestamptz | não | `now()` |  |

**Chave primária:** `socket_id`

**Chaves estrangeiras:**
- `agent_id` → `agents(id)`
- `tenant_id` → `tenants(id)`

**Índices:**
- `agent_connections_agent`: `CREATE INDEX agent_connections_agent ON public.agent_connections USING btree (agent_id, tenant_id)`
- `agent_connections_pkey`: `CREATE UNIQUE INDEX agent_connections_pkey ON public.agent_connections USING btree (socket_id)`

**Triggers:**
- `agent_connections_scope`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## agent_presence

Status desejado do agente (available, busy, away).

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `agent_id` | uuid | não |  | PK, FK → agents.id |
| `tenant_id` | uuid | não |  | FK → tenants.id |
| `desired_status` | text | não |  |  |
| `updated_at` | timestamptz | não | `now()` |  |

**Chave primária:** `agent_id`

**Chaves estrangeiras:**
- `agent_id` → `agents(id)`
- `tenant_id` → `tenants(id)`

**Constraints (UNIQUE/CHECK):**
- `agent_presence_desired_status_check`: `CHECK ((desired_status = ANY (ARRAY['available'::text, 'busy'::text, 'away'::text])))`

**Índices:**
- `agent_presence_pkey`: `CREATE UNIQUE INDEX agent_presence_pkey ON public.agent_presence USING btree (agent_id)`

**Triggers:**
- `agent_presence_scope`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## agent_queues

Filas que cada agente pode atender (N:N).

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `agent_id` | uuid | não |  | PK, FK → agents.id |
| `queue_id` | uuid | não |  | PK, FK → queues.id |
| `tenant_id` | uuid | não |  | FK → tenants.id |

**Chave primária:** `agent_id`, `queue_id`

**Chaves estrangeiras:**
- `agent_id` → `agents(id)`
- `queue_id` → `queues(id)`
- `tenant_id` → `tenants(id)`

**Índices:**
- `agent_queues_pkey`: `CREATE UNIQUE INDEX agent_queues_pkey ON public.agent_queues USING btree (agent_id, queue_id)`

**Triggers:**
- `agent_queues_tenant`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## agents

Usuário interno (agent, supervisor ou admin) com credencial local (hash argon2id).

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` | PK |
| `tenant_id` | uuid | não |  | FK → tenants.id |
| `email` | text | não |  | UNIQUE |
| `name` | text | não |  |  |
| `password_hash` | text | não |  |  |
| `role` | text | não |  |  |
| `created_at` | timestamptz | não | `now()` |  |
| `can_change_own_activity` | boolean | não | `false` |  |
| `membership_status` | text | não | `'active'::text` |  |
| `suspended_at` | timestamptz | sim |  |  |
| `suspension_reason` | text | sim |  |  |
| `auth_epoch` | bigint | não | `1` |  |

**Chave primária:** `id`

**Chaves estrangeiras:**
- `tenant_id` → `tenants(id)`

**Constraints (UNIQUE/CHECK):**
- `agents_auth_epoch_check`: `CHECK ((auth_epoch >= 1))`
- `agents_email_check`: `CHECK ((email = lower(email)))`
- `agents_email_key`: `UNIQUE (email)`
- `agents_email_len`: `CHECK (((char_length(email) >= 3) AND (char_length(email) <= 200)))`
- `agents_membership_pair`: `CHECK ((((membership_status = 'active'::text) AND (suspended_at IS NULL) AND (suspension_reason IS NULL)) OR ((membership_status = 'suspended'::text) AND (suspended_at IS NOT NULL) AND (suspension_reason IS NOT NULL) AND ((char_length(suspension_reason) >= 1) AND (char_length(suspension_reason) <= 200)))))`
- `agents_membership_status_check`: `CHECK ((membership_status = ANY (ARRAY['active'::text, 'suspended'::text])))`
- `agents_name_len`: `CHECK (((char_length(name) >= 1) AND (char_length(name) <= 120)))`
- `agents_role_check`: `CHECK ((role = ANY (ARRAY['agent'::text, 'supervisor'::text, 'admin'::text])))`

**Índices:**
- `agents_email_key`: `CREATE UNIQUE INDEX agents_email_key ON public.agents USING btree (email)`
- `agents_pkey`: `CREATE UNIQUE INDEX agents_pkey ON public.agents USING btree (id)`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## announcement_reads

Registro de leitura do anúncio por agente.

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `announcement_id` | uuid | não |  | PK, FK → announcements.id |
| `agent_id` | uuid | não |  | PK, FK → agents.id |
| `tenant_id` | uuid | não |  | FK → tenants.id |
| `read_at` | timestamptz | não | `now()` |  |

**Chave primária:** `announcement_id`, `agent_id`

**Chaves estrangeiras:**
- `agent_id` → `agents(id)`
- `announcement_id` → `announcements(id)`
- `tenant_id` → `tenants(id)`

**Índices:**
- `announcement_reads_pkey`: `CREATE UNIQUE INDEX announcement_reads_pkey ON public.announcement_reads USING btree (announcement_id, agent_id)`

**Triggers:**
- `announcement_reads_agent`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## announcement_revisions

Revisões (título/corpo) de um anúncio editado.

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` | PK |
| `tenant_id` | uuid | não |  | FK → tenants.id |
| `announcement_id` | uuid | não |  | FK → announcements.id |
| `editor_id` | uuid | não |  | FK → agents.id |
| `title` | text | não |  |  |
| `body` | text | não |  |  |
| `created_at` | timestamptz | não | `now()` |  |

**Chave primária:** `id`

**Chaves estrangeiras:**
- `announcement_id` → `announcements(id)`
- `editor_id` → `agents(id)`
- `tenant_id` → `tenants(id)`

**Índices:**
- `announcement_revisions_pkey`: `CREATE UNIQUE INDEX announcement_revisions_pkey ON public.announcement_revisions USING btree (id)`

**Triggers:**
- `announcement_revisions_scope`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## announcement_sectors

Setores-alvo de um anúncio.

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `announcement_id` | uuid | não |  | PK, FK → announcements.id |
| `sector_id` | uuid | não |  | PK, FK → sectors.id |
| `tenant_id` | uuid | não |  | FK → tenants.id |

**Chave primária:** `announcement_id`, `sector_id`

**Chaves estrangeiras:**
- `announcement_id` → `announcements(id)`
- `sector_id` → `sectors(id)`
- `tenant_id` → `tenants(id)`

**Índices:**
- `announcement_sectors_pkey`: `CREATE UNIQUE INDEX announcement_sectors_pkey ON public.announcement_sectors USING btree (announcement_id, sector_id)`

**Triggers:**
- `announcement_sectors_scope`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## announcements

Anúncio do quadro (público tenant ou setores; fixação, expiração, arquivamento).

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` | PK |
| `tenant_id` | uuid | não |  | FK → tenants.id |
| `author_id` | uuid | não |  | FK → agents.id |
| `title` | text | não |  |  |
| `body` | text | não |  |  |
| `pinned` | boolean | não | `false` |  |
| `audience` | text | não |  |  |
| `published_at` | timestamptz | não | `now()` |  |
| `expires_at` | timestamptz | sim |  |  |
| `archived_at` | timestamptz | sim |  |  |
| `updated_at` | timestamptz | não | `now()` |  |

**Chave primária:** `id`

**Chaves estrangeiras:**
- `author_id` → `agents(id)`
- `tenant_id` → `tenants(id)`

**Constraints (UNIQUE/CHECK):**
- `announcements_audience_check`: `CHECK ((audience = ANY (ARRAY['tenant'::text, 'sectors'::text])))`
- `announcements_body_check`: `CHECK (((char_length(body) >= 1) AND (char_length(body) <= 4000)))`
- `announcements_title_check`: `CHECK (((char_length(title) >= 1) AND (char_length(title) <= 160)))`

**Índices:**
- `announcements_pkey`: `CREATE UNIQUE INDEX announcements_pkey ON public.announcements USING btree (id)`
- `announcements_tenant_published`: `CREATE INDEX announcements_tenant_published ON public.announcements USING btree (tenant_id, published_at DESC)`

**Triggers:**
- `announcement_author_scope`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## audit_events

Trilha de auditoria de ações administrativas e de supervisão.

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` | PK |
| `tenant_id` | uuid | não |  | FK → tenants.id |
| `actor_id` | uuid | não |  | FK → agents.id |
| `action` | text | não |  |  |
| `resource_type` | text | não |  |  |
| `resource_id` | uuid | sim |  |  |
| `metadata` | jsonb | não | `'{}'::jsonb` |  |
| `created_at` | timestamptz | não | `now()` |  |

**Chave primária:** `id`

**Chaves estrangeiras:**
- `actor_id` → `agents(id)`
- `tenant_id` → `tenants(id)`

**Constraints (UNIQUE/CHECK):**
- `audit_events_action_check`: `CHECK (((char_length(action) >= 1) AND (char_length(action) <= 80)))`
- `audit_events_resource_type_check`: `CHECK (((char_length(resource_type) >= 1) AND (char_length(resource_type) <= 40)))`

**Índices:**
- `audit_events_pkey`: `CREATE UNIQUE INDEX audit_events_pkey ON public.audit_events USING btree (id)`
- `audit_events_tenant_action_time`: `CREATE INDEX audit_events_tenant_action_time ON public.audit_events USING btree (tenant_id, action, created_at DESC)`
- `audit_events_tenant_time`: `CREATE INDEX audit_events_tenant_time ON public.audit_events USING btree (tenant_id, created_at DESC)`

**Triggers:**
- `audit_events_scope`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## auth_sessions

Sessões opacas de agentes/supervisores/admin (apenas o hash SHA-256 do token).

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` | PK |
| `token_hash` | text | não |  | UNIQUE |
| `agent_id` | uuid | não |  | FK → agents.id |
| `tenant_id` | uuid | não |  | FK → tenants.id |
| `role` | text | não |  |  |
| `created_at` | timestamptz | não | `now()` |  |
| `expires_at` | timestamptz | não |  |  |
| `auth_epoch` | bigint | não | `1` |  |

**Chave primária:** `id`

**Chaves estrangeiras:**
- `agent_id` → `agents(id)`
- `tenant_id` → `tenants(id)`

**Constraints (UNIQUE/CHECK):**
- `auth_sessions_auth_epoch_check`: `CHECK ((auth_epoch >= 1))`
- `auth_sessions_role_check`: `CHECK ((role = ANY (ARRAY['agent'::text, 'supervisor'::text, 'admin'::text])))`
- `auth_sessions_token_hash_key`: `UNIQUE (token_hash)`

**Índices:**
- `auth_sessions_pkey`: `CREATE UNIQUE INDEX auth_sessions_pkey ON public.auth_sessions USING btree (id)`
- `auth_sessions_token_hash_key`: `CREATE UNIQUE INDEX auth_sessions_token_hash_key ON public.auth_sessions USING btree (token_hash)`

**Triggers:**
- `auth_sessions_revoke_notify`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## company_command_receipts



| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `tenant_id` | uuid | não |  | PK, FK → tenants.id |
| `actor_id` | uuid | não |  | PK, FK → agents.id |
| `request_id` | uuid | não |  | PK |
| `command_kind` | text | não |  |  |
| `payload_hash` | text | não |  |  |
| `status` | text | não |  |  |
| `applied_at` | timestamptz | sim |  |  |
| `created_at` | timestamptz | não | `now()` |  |
| `expires_at` | timestamptz | não | `(now() + '24:00:00'::interval)` |  |

**Chave primária:** `tenant_id`, `actor_id`, `request_id`

**Chaves estrangeiras:**
- `actor_id` → `agents(id)`
- `tenant_id` → `tenants(id)`

**Constraints (UNIQUE/CHECK):**
- `company_command_receipts_check`: `CHECK ((((status = 'in_flight'::text) AND (applied_at IS NULL)) OR ((status = 'applied'::text) AND (applied_at IS NOT NULL))))`
- `company_command_receipts_command_kind_check`: `CHECK (((char_length(command_kind) >= 1) AND (char_length(command_kind) <= 80)))`
- `company_command_receipts_expiry`: `CHECK ((expires_at >= created_at))`
- `company_command_receipts_payload_hash_check`: `CHECK ((payload_hash ~ '^[0-9a-f]{64}$'::text))`
- `company_command_receipts_status_check`: `CHECK ((status = ANY (ARRAY['in_flight'::text, 'applied'::text])))`

**Índices:**
- `company_command_receipts_expiry`: `CREATE INDEX company_command_receipts_expiry ON public.company_command_receipts USING btree (tenant_id, actor_id, expires_at)`
- `company_command_receipts_pkey`: `CREATE UNIQUE INDEX company_command_receipts_pkey ON public.company_command_receipts USING btree (tenant_id, actor_id, request_id)`

**Triggers:**
- `company_command_receipts_scope`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## conversation_events

Linha do tempo durável do atendimento (queued, assigned, released, transferred, classified, survey_submitted, closed, left).

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` | PK |
| `tenant_id` | uuid | não |  | FK → tenants.id |
| `conversation_id` | uuid | não |  | FK → conversations.id |
| `type` | text | não |  |  |
| `payload` | jsonb | não | `'{}'::jsonb` |  |
| `created_at` | timestamptz | não | `now()` |  |

**Chave primária:** `id`

**Chaves estrangeiras:**
- `conversation_id` → `conversations(id)`
- `tenant_id` → `tenants(id)`

**Índices:**
- `conversation_events_conversation_time`: `CREATE INDEX conversation_events_conversation_time ON public.conversation_events USING btree (conversation_id, created_at)`
- `conversation_events_pkey`: `CREATE UNIQUE INDEX conversation_events_pkey ON public.conversation_events USING btree (id)`
- `conversation_events_tenant_time`: `CREATE INDEX conversation_events_tenant_time ON public.conversation_events USING btree (tenant_id, created_at)`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## conversation_reads

Cursor de leitura do agente por atendimento.

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `conversation_id` | uuid | não |  | PK, FK → conversations.id |
| `agent_id` | uuid | não |  | PK, FK → agents.id |
| `tenant_id` | uuid | não |  | FK → tenants.id |
| `last_read_message_id` | uuid | não |  | FK → messages.id |
| `read_at` | timestamptz | não | `now()` |  |

**Chave primária:** `conversation_id`, `agent_id`

**Chaves estrangeiras:**
- `agent_id` → `agents(id)`
- `conversation_id` → `conversations(id)`
- `last_read_message_id` → `messages(id)`
- `tenant_id` → `tenants(id)`

**Índices:**
- `conversation_reads_pkey`: `CREATE UNIQUE INDEX conversation_reads_pkey ON public.conversation_reads USING btree (conversation_id, agent_id)`

**Triggers:**
- `conversation_reads_scope`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## conversations

Atendimento externo (visitante ↔ fila/agente). Máquina de estados por `status`.

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` | PK |
| `tenant_id` | uuid | não |  | FK → tenants.id |
| `site_id` | uuid | não |  | FK → sites.id |
| `queue_id` | uuid | não |  | FK → queues.id |
| `visitor_id` | uuid | não |  | FK → visitors.id |
| `agent_id` | uuid | sim |  | FK → agents.id |
| `status` | text | não |  |  |
| `disposition_id` | uuid | sim |  | FK → dispositions.id |
| `version` | integer | não | `0` |  |
| `created_at` | timestamptz | não | `now()` |  |
| `assigned_at` | timestamptz | sim |  |  |
| `ended_at` | timestamptz | sim |  |  |
| `queued_at` | timestamptz | não | `now()` |  |

**Chave primária:** `id`

**Chaves estrangeiras:**
- `agent_id` → `agents(id)`
- `disposition_id` → `dispositions(id)`
- `queue_id` → `queues(id)`
- `site_id` → `sites(id)`
- `tenant_id` → `tenants(id)`
- `visitor_id` → `visitors(id)`

**Constraints (UNIQUE/CHECK):**
- `conversations_status_check`: `CHECK ((status = ANY (ARRAY['queued'::text, 'assigned'::text, 'awaiting_survey'::text, 'closed'::text])))`

**Índices:**
- `conversations_one_open_per_visitor`: `CREATE UNIQUE INDEX conversations_one_open_per_visitor ON public.conversations USING btree (visitor_id) WHERE (status <> 'closed'::text)`
- `conversations_pkey`: `CREATE UNIQUE INDEX conversations_pkey ON public.conversations USING btree (id)`
- `conversations_queue_status`: `CREATE INDEX conversations_queue_status ON public.conversations USING btree (queue_id, status)`
- `conversations_tenant_status`: `CREATE INDEX conversations_tenant_status ON public.conversations USING btree (tenant_id, status)`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## dispositions

Classificações de encerramento de atendimento.

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` | PK |
| `tenant_id` | uuid | não |  | FK → tenants.id |
| `name` | text | não |  |  |
| `created_at` | timestamptz | não | `now()` |  |
| `status` | text | não | `'active'::text` |  |
| `retired_at` | timestamptz | sim |  |  |

**Chave primária:** `id`

**Chaves estrangeiras:**
- `tenant_id` → `tenants(id)`

**Constraints (UNIQUE/CHECK):**
- `dispositions_name_len`: `CHECK (((char_length(name) >= 1) AND (char_length(name) <= 120)))`
- `dispositions_status_check`: `CHECK ((status = ANY (ARRAY['active'::text, 'retired'::text])))`
- `dispositions_status_pair`: `CHECK ((((status = 'active'::text) AND (retired_at IS NULL)) OR ((status = 'retired'::text) AND (retired_at IS NOT NULL))))`
- `dispositions_tenant_id_name_key`: `UNIQUE (tenant_id, name)`

**Índices:**
- `dispositions_pkey`: `CREATE UNIQUE INDEX dispositions_pkey ON public.dispositions USING btree (id)`
- `dispositions_tenant_id_name_key`: `CREATE UNIQUE INDEX dispositions_tenant_id_name_key ON public.dispositions USING btree (tenant_id, name)`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## internal_conversations

Conversa do chat interno: `direct` (par) ou `group` (um por setor).

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` | PK |
| `tenant_id` | uuid | não |  | FK → tenants.id |
| `kind` | text | não |  |  |
| `sector_id` | uuid | sim |  | FK → sectors.id |
| `pair_key` | text | sim |  |  |
| `created_at` | timestamptz | não | `now()` |  |

**Chave primária:** `id`

**Chaves estrangeiras:**
- `sector_id` → `sectors(id)`
- `tenant_id` → `tenants(id)`

**Constraints (UNIQUE/CHECK):**
- `internal_conversations_check`: `CHECK ((((kind = 'group'::text) AND (sector_id IS NOT NULL) AND (pair_key IS NULL)) OR ((kind = 'direct'::text) AND (sector_id IS NULL) AND (pair_key IS NOT NULL))))`
- `internal_conversations_kind_check`: `CHECK ((kind = ANY (ARRAY['direct'::text, 'group'::text])))`

**Índices:**
- `internal_conversations_one_direct`: `CREATE UNIQUE INDEX internal_conversations_one_direct ON public.internal_conversations USING btree (tenant_id, pair_key) WHERE (kind = 'direct'::text)`
- `internal_conversations_one_group`: `CREATE UNIQUE INDEX internal_conversations_one_group ON public.internal_conversations USING btree (tenant_id, sector_id) WHERE (kind = 'group'::text)`
- `internal_conversations_pkey`: `CREATE UNIQUE INDEX internal_conversations_pkey ON public.internal_conversations USING btree (id)`

**Triggers:**
- `internal_conversations_scope`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## internal_messages

Mensagens do chat interno (idempotentes por `request_id`).

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` | PK |
| `tenant_id` | uuid | não |  | FK → tenants.id |
| `conversation_id` | uuid | não |  | FK → internal_conversations.id |
| `sender_id` | uuid | não |  | FK → agents.id |
| `request_id` | uuid | não |  |  |
| `body` | text | não |  |  |
| `created_at` | timestamptz | não | `now()` |  |

**Chave primária:** `id`

**Chaves estrangeiras:**
- `conversation_id` → `internal_conversations(id)`
- `sender_id` → `agents(id)`
- `tenant_id` → `tenants(id)`

**Constraints (UNIQUE/CHECK):**
- `internal_messages_body_check`: `CHECK (((char_length(body) >= 1) AND (char_length(body) <= 4000)))`
- `internal_messages_conversation_id_request_id_key`: `UNIQUE (conversation_id, request_id)`

**Índices:**
- `internal_messages_conversation_id_request_id_key`: `CREATE UNIQUE INDEX internal_messages_conversation_id_request_id_key ON public.internal_messages USING btree (conversation_id, request_id)`
- `internal_messages_order`: `CREATE INDEX internal_messages_order ON public.internal_messages USING btree (conversation_id, created_at, id)`
- `internal_messages_pkey`: `CREATE UNIQUE INDEX internal_messages_pkey ON public.internal_messages USING btree (id)`

**Triggers:**
- `internal_messages_scope`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## internal_participants

Participantes da conversa interna (remoção lógica por `removed_at`).

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `conversation_id` | uuid | não |  | PK, FK → internal_conversations.id |
| `agent_id` | uuid | não |  | PK, FK → agents.id |
| `tenant_id` | uuid | não |  | FK → tenants.id |
| `joined_at` | timestamptz | não | `now()` |  |
| `removed_at` | timestamptz | sim |  |  |

**Chave primária:** `conversation_id`, `agent_id`

**Chaves estrangeiras:**
- `agent_id` → `agents(id)`
- `conversation_id` → `internal_conversations(id)`
- `tenant_id` → `tenants(id)`

**Índices:**
- `internal_participants_agent`: `CREATE INDEX internal_participants_agent ON public.internal_participants USING btree (tenant_id, agent_id)`
- `internal_participants_pkey`: `CREATE UNIQUE INDEX internal_participants_pkey ON public.internal_participants USING btree (conversation_id, agent_id)`

**Triggers:**
- `internal_participants_scope`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## internal_reads

Cursor de leitura do chat interno por participante.

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `conversation_id` | uuid | não |  | PK, FK → internal_conversations.id |
| `agent_id` | uuid | não |  | PK, FK → agents.id |
| `tenant_id` | uuid | não |  | FK → tenants.id |
| `last_read_message_id` | uuid | não |  | FK → internal_messages.id |
| `read_at` | timestamptz | não | `now()` |  |

**Chave primária:** `conversation_id`, `agent_id`

**Chaves estrangeiras:**
- `agent_id` → `agents(id)`
- `conversation_id` → `internal_conversations(id)`
- `last_read_message_id` → `internal_messages(id)`
- `tenant_id` → `tenants(id)`

**Índices:**
- `internal_reads_pkey`: `CREATE UNIQUE INDEX internal_reads_pkey ON public.internal_reads USING btree (conversation_id, agent_id)`

**Triggers:**
- `internal_reads_agent`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## login_rate_limits

Contadores globais do limite de login; chaves são HMAC de IP e conta, sem dados em claro.

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `key_hash` | text | não |  | PK |
| `window_started_at` | timestamptz | não |  |  |
| `attempts` | integer | não |  |  |

**Chave primária:** `key_hash`

**Constraints (UNIQUE/CHECK):**
- `login_rate_limits_attempts_check`: `CHECK ((attempts > 0))`
- `login_rate_limits_key_hash_check`: `CHECK ((key_hash ~ '^[0-9a-f]{64}$'::text))`

**Índices:**
- `login_rate_limits_pkey`: `CREATE UNIQUE INDEX login_rate_limits_pkey ON public.login_rate_limits USING btree (key_hash)`
- `login_rate_limits_window`: `CREATE INDEX login_rate_limits_window ON public.login_rate_limits USING btree (window_started_at)`

**RLS:** não habilitada

## messages

Mensagens de um atendimento externo (idempotentes por `request_id`).

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` | PK |
| `tenant_id` | uuid | não |  | FK → tenants.id |
| `conversation_id` | uuid | não |  | FK → conversations.id |
| `sender_type` | text | não |  |  |
| `sender_id` | uuid | sim |  |  |
| `request_id` | uuid | não |  |  |
| `body` | text | não |  |  |
| `created_at` | timestamptz | não | `now()` |  |

**Chave primária:** `id`

**Chaves estrangeiras:**
- `conversation_id` → `conversations(id)`
- `tenant_id` → `tenants(id)`

**Constraints (UNIQUE/CHECK):**
- `messages_body_check`: `CHECK (((char_length(body) >= 1) AND (char_length(body) <= 4000)))`
- `messages_check`: `CHECK ((((sender_type = 'system'::text) AND (sender_id IS NULL)) OR ((sender_type <> 'system'::text) AND (sender_id IS NOT NULL))))`
- `messages_conversation_id_request_id_key`: `UNIQUE (conversation_id, request_id)`
- `messages_sender_type_check`: `CHECK ((sender_type = ANY (ARRAY['visitor'::text, 'agent'::text, 'system'::text])))`

**Índices:**
- `messages_conversation_id_request_id_key`: `CREATE UNIQUE INDEX messages_conversation_id_request_id_key ON public.messages USING btree (conversation_id, request_id)`
- `messages_conversation_order`: `CREATE INDEX messages_conversation_order ON public.messages USING btree (conversation_id, created_at, id)`
- `messages_pkey`: `CREATE UNIQUE INDEX messages_pkey ON public.messages USING btree (id)`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## presence_intervals

Histórico de intervalos de presença efetiva (inclui offline).

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` | PK |
| `tenant_id` | uuid | não |  | FK → tenants.id |
| `agent_id` | uuid | não |  | FK → agents.id |
| `status` | text | não |  |  |
| `started_at` | timestamptz | não | `now()` |  |
| `ended_at` | timestamptz | sim |  |  |

**Chave primária:** `id`

**Chaves estrangeiras:**
- `agent_id` → `agents(id)`
- `tenant_id` → `tenants(id)`

**Constraints (UNIQUE/CHECK):**
- `presence_intervals_status_check`: `CHECK ((status = ANY (ARRAY['available'::text, 'busy'::text, 'away'::text, 'offline'::text])))`

**Índices:**
- `presence_intervals_agent_time`: `CREATE INDEX presence_intervals_agent_time ON public.presence_intervals USING btree (tenant_id, agent_id, started_at)`
- `presence_intervals_one_open`: `CREATE UNIQUE INDEX presence_intervals_one_open ON public.presence_intervals USING btree (agent_id) WHERE (ended_at IS NULL)`
- `presence_intervals_pkey`: `CREATE UNIQUE INDEX presence_intervals_pkey ON public.presence_intervals USING btree (id)`

**Triggers:**
- `presence_intervals_agent`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## queues

Fila de atendimento externo do tenant.

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` | PK |
| `tenant_id` | uuid | não |  | FK → tenants.id |
| `name` | text | não |  |  |
| `created_at` | timestamptz | não | `now()` |  |

**Chave primária:** `id`

**Chaves estrangeiras:**
- `tenant_id` → `tenants(id)`

**Constraints (UNIQUE/CHECK):**
- `queues_name_len`: `CHECK (((char_length(name) >= 1) AND (char_length(name) <= 120)))`
- `queues_tenant_id_name_key`: `UNIQUE (tenant_id, name)`

**Índices:**
- `queues_pkey`: `CREATE UNIQUE INDEX queues_pkey ON public.queues USING btree (id)`
- `queues_tenant_id_name_key`: `CREATE UNIQUE INDEX queues_tenant_id_name_key ON public.queues USING btree (tenant_id, name)`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## schema_migrations

Controle das migrations aplicadas.

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `version` | text | não |  | PK |
| `applied_at` | timestamptz | não | `now()` |  |

**Chave primária:** `version`

**Índices:**
- `schema_migrations_pkey`: `CREATE UNIQUE INDEX schema_migrations_pkey ON public.schema_migrations USING btree (version)`

**RLS:** não habilitada

## sector_members

Membros do setor (remoção lógica por `removed_at`).

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `sector_id` | uuid | não |  | PK, FK → sectors.id |
| `agent_id` | uuid | não |  | PK, FK → agents.id |
| `tenant_id` | uuid | não |  | FK → tenants.id |
| `created_at` | timestamptz | não | `now()` |  |
| `removed_at` | timestamptz | sim |  |  |

**Chave primária:** `sector_id`, `agent_id`

**Chaves estrangeiras:**
- `agent_id` → `agents(id)`
- `sector_id` → `sectors(id)`
- `tenant_id` → `tenants(id)`

**Índices:**
- `sector_members_active_agent`: `CREATE INDEX sector_members_active_agent ON public.sector_members USING btree (tenant_id, agent_id) WHERE (removed_at IS NULL)`
- `sector_members_pkey`: `CREATE UNIQUE INDEX sector_members_pkey ON public.sector_members USING btree (sector_id, agent_id)`

**Triggers:**
- `sector_members_scope`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## sector_queues

Vínculo setor ↔ fila usado para limitar o escopo da supervisão.

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `sector_id` | uuid | não |  | PK, FK → sectors.id |
| `queue_id` | uuid | não |  | PK, FK → queues.id |
| `tenant_id` | uuid | não |  | FK → tenants.id |

**Chave primária:** `sector_id`, `queue_id`

**Chaves estrangeiras:**
- `queue_id` → `queues(id)`
- `sector_id` → `sectors(id)`
- `tenant_id` → `tenants(id)`

**Índices:**
- `sector_queues_pkey`: `CREATE UNIQUE INDEX sector_queues_pkey ON public.sector_queues USING btree (sector_id, queue_id)`

**Triggers:**
- `sector_queues_scope`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## sector_supervisors

Supervisores do setor (remoção lógica por `removed_at`).

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `sector_id` | uuid | não |  | PK, FK → sectors.id |
| `agent_id` | uuid | não |  | PK, FK → agents.id |
| `tenant_id` | uuid | não |  | FK → tenants.id |
| `created_at` | timestamptz | não | `now()` |  |
| `removed_at` | timestamptz | sim |  |  |

**Chave primária:** `sector_id`, `agent_id`

**Chaves estrangeiras:**
- `agent_id` → `agents(id)`
- `sector_id` → `sectors(id)`
- `tenant_id` → `tenants(id)`

**Índices:**
- `sector_supervisors_active_agent`: `CREATE INDEX sector_supervisors_active_agent ON public.sector_supervisors USING btree (tenant_id, agent_id) WHERE (removed_at IS NULL)`
- `sector_supervisors_pkey`: `CREATE UNIQUE INDEX sector_supervisors_pkey ON public.sector_supervisors USING btree (sector_id, agent_id)`

**Triggers:**
- `sector_supervisors_scope`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## sectors

Setor organizacional do tenant.

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` | PK |
| `tenant_id` | uuid | não |  | FK → tenants.id |
| `name` | text | não |  |  |
| `description` | text | não | `''::text` |  |
| `active` | boolean | não | `true` |  |
| `created_at` | timestamptz | não | `now()` |  |

**Chave primária:** `id`

**Chaves estrangeiras:**
- `tenant_id` → `tenants(id)`

**Constraints (UNIQUE/CHECK):**
- `sectors_description_check`: `CHECK ((char_length(description) <= 500))`
- `sectors_name_check`: `CHECK (((char_length(name) >= 1) AND (char_length(name) <= 120)))`
- `sectors_tenant_id_name_key`: `UNIQUE (tenant_id, name)`

**Índices:**
- `sectors_pkey`: `CREATE UNIQUE INDEX sectors_pkey ON public.sectors USING btree (id)`
- `sectors_tenant_active`: `CREATE INDEX sectors_tenant_active ON public.sectors USING btree (tenant_id, active)`
- `sectors_tenant_id_name_key`: `CREATE UNIQUE INDEX sectors_tenant_id_name_key ON public.sectors USING btree (tenant_id, name)`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## site_queues

Filas oferecidas por cada site (N:N).

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `site_id` | uuid | não |  | PK, FK → sites.id |
| `queue_id` | uuid | não |  | PK, FK → queues.id |
| `tenant_id` | uuid | não |  | FK → tenants.id |

**Chave primária:** `site_id`, `queue_id`

**Chaves estrangeiras:**
- `queue_id` → `queues(id)`
- `site_id` → `sites(id)`
- `tenant_id` → `tenants(id)`

**Índices:**
- `site_queues_pkey`: `CREATE UNIQUE INDEX site_queues_pkey ON public.site_queues USING btree (site_id, queue_id)`

**Triggers:**
- `site_queues_tenant`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## site_service_windows



| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `site_id` | uuid | não |  | PK, FK → sites.id |
| `tenant_id` | uuid | não |  | FK → tenants.id |
| `weekday` | smallint | não |  | PK |
| `start_minute` | smallint | não |  | PK |
| `end_minute` | smallint | não |  |  |

**Chave primária:** `site_id`, `weekday`, `start_minute`

**Chaves estrangeiras:**
- `site_id` → `sites(id)`
- `tenant_id` → `tenants(id)`

**Constraints (UNIQUE/CHECK):**
- `site_service_windows_check`: `CHECK ((end_minute > start_minute))`
- `site_service_windows_end_minute_check`: `CHECK (((end_minute >= 1) AND (end_minute <= 1440)))`
- `site_service_windows_start_minute_check`: `CHECK (((start_minute >= 0) AND (start_minute <= 1439)))`
- `site_service_windows_weekday_check`: `CHECK (((weekday >= 1) AND (weekday <= 7)))`

**Índices:**
- `site_service_windows_pkey`: `CREATE UNIQUE INDEX site_service_windows_pkey ON public.site_service_windows USING btree (site_id, weekday, start_minute)`
- `site_service_windows_tenant`: `CREATE INDEX site_service_windows_tenant ON public.site_service_windows USING btree (tenant_id, site_id)`

**Triggers:**
- `site_service_windows_scope`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## sites

Site/widget de um tenant, identificado por `public_id`; guarda origens permitidas e aparência do widget.

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` | PK |
| `tenant_id` | uuid | não |  | FK → tenants.id |
| `public_id` | text | não |  | UNIQUE |
| `name` | text | não |  |  |
| `allowed_origins` | text[] | não | `'{}'::text[]` |  |
| `created_at` | timestamptz | não | `now()` |  |
| `primary_color` | text | não | `'#0c7c73'::text` |  |
| `logo_url` | text | sim |  |  |
| `welcome_message` | text | não | `'Olá. Escolha uma fila para começar.'::text` |  |
| `require_visitor_name` | boolean | não | `false` |  |
| `accepting_chats` | boolean | não | `true` |  |
| `acceptance` | text | não | `'accepting'::text` |  |
| `pause_reason` | text | sim |  |  |

**Chave primária:** `id`

**Chaves estrangeiras:**
- `tenant_id` → `tenants(id)`

**Constraints (UNIQUE/CHECK):**
- `sites_acceptance_check`: `CHECK ((acceptance = ANY (ARRAY['accepting'::text, 'paused'::text])))`
- `sites_logo_url_https`: `CHECK (((logo_url IS NULL) OR (logo_url ~ '^https://'::text)))`
- `sites_name_len`: `CHECK (((char_length(name) >= 1) AND (char_length(name) <= 120)))`
- `sites_pause_reason_pair`: `CHECK ((((acceptance = 'accepting'::text) AND (pause_reason IS NULL)) OR ((acceptance = 'paused'::text) AND (pause_reason IS NOT NULL) AND ((char_length(pause_reason) >= 1) AND (char_length(pause_reason) <= 200)))))`
- `sites_primary_color_hex`: `CHECK ((primary_color ~ '^#[0-9a-fA-F]{6}$'::text))`
- `sites_public_id_check`: `CHECK ((public_id ~ '^[a-z0-9_-]+$'::text))`
- `sites_public_id_key`: `UNIQUE (public_id)`
- `sites_welcome_message_len`: `CHECK (((char_length(welcome_message) >= 1) AND (char_length(welcome_message) <= 300)))`

**Índices:**
- `sites_pkey`: `CREATE UNIQUE INDEX sites_pkey ON public.sites USING btree (id)`
- `sites_public_id_key`: `CREATE UNIQUE INDEX sites_public_id_key ON public.sites USING btree (public_id)`

**Triggers:**
- `sites_acceptance_sync`
- `sites_origins_when_accepting`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## sla_policies



| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` | PK |
| `tenant_id` | uuid | não |  | FK → tenants.id |
| `queue_id` | uuid | não |  | FK → queues.id |
| `status` | text | não |  |  |
| `effective_from` | timestamptz | não |  |  |
| `retired_at` | timestamptz | sim |  |  |
| `created_by` | uuid | não |  | FK → agents.id |
| `created_at` | timestamptz | não | `now()` |  |

**Chave primária:** `id`

**Chaves estrangeiras:**
- `created_by` → `agents(id)`
- `queue_id` → `queues(id)`
- `tenant_id` → `tenants(id)`

**Constraints (UNIQUE/CHECK):**
- `sla_policies_check`: `CHECK ((((status = 'active'::text) AND (retired_at IS NULL)) OR ((status = 'retired'::text) AND (retired_at IS NOT NULL) AND (retired_at >= effective_from))))`
- `sla_policies_status_check`: `CHECK ((status = ANY (ARRAY['active'::text, 'retired'::text])))`

**Índices:**
- `sla_policies_no_overlap`: `CREATE INDEX sla_policies_no_overlap ON public.sla_policies USING gist (queue_id, tstzrange(effective_from, retired_at, '[)'::text))`
- `sla_policies_one_active`: `CREATE UNIQUE INDEX sla_policies_one_active ON public.sla_policies USING btree (queue_id) WHERE (status = 'active'::text)`
- `sla_policies_pkey`: `CREATE UNIQUE INDEX sla_policies_pkey ON public.sla_policies USING btree (id)`
- `sla_policies_queue_effective`: `CREATE INDEX sla_policies_queue_effective ON public.sla_policies USING btree (tenant_id, queue_id, effective_from DESC)`

**Triggers:**
- `sla_policies_clocks_complete`
- `sla_policies_publication`
- `sla_policies_scope`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## sla_policy_clocks



| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `policy_id` | uuid | não |  | PK, FK → sla_policies.id |
| `tenant_id` | uuid | não |  | FK → tenants.id |
| `metric` | text | não |  | PK |
| `threshold_seconds` | integer | não |  |  |

**Chave primária:** `policy_id`, `metric`

**Chaves estrangeiras:**
- `policy_id` → `sla_policies(id)`
- `tenant_id` → `tenants(id)`

**Constraints (UNIQUE/CHECK):**
- `sla_policy_clocks_metric_check`: `CHECK ((metric = ANY (ARRAY['queue_wait'::text, 'first_response'::text])))`
- `sla_policy_clocks_threshold_seconds_check`: `CHECK (((threshold_seconds >= 1) AND (threshold_seconds <= 86400)))`

**Índices:**
- `sla_policy_clocks_pkey`: `CREATE UNIQUE INDEX sla_policy_clocks_pkey ON public.sla_policy_clocks USING btree (policy_id, metric)`

**Triggers:**
- `sla_policy_clocks_scope`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## survey_definitions

Definição da pesquisa de satisfação do tenant.

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` | PK |
| `tenant_id` | uuid | não |  | FK → tenants.id |
| `prompt` | text | não |  |  |
| `scale` | integer | não | `5` |  |
| `comment_enabled` | boolean | não | `true` |  |
| `active` | boolean | não | `true` |  |
| `created_at` | timestamptz | não | `now()` |  |

**Chave primária:** `id`

**Chaves estrangeiras:**
- `tenant_id` → `tenants(id)`

**Constraints (UNIQUE/CHECK):**
- `survey_definitions_scale_check`: `CHECK (((scale >= 1) AND (scale <= 5)))`

**Índices:**
- `survey_definitions_one_active`: `CREATE UNIQUE INDEX survey_definitions_one_active ON public.survey_definitions USING btree (tenant_id) WHERE (active = true)`
- `survey_definitions_pkey`: `CREATE UNIQUE INDEX survey_definitions_pkey ON public.survey_definitions USING btree (id)`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## survey_responses

Resposta da pesquisa (no máximo uma por atendimento).

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` | PK |
| `tenant_id` | uuid | não |  | FK → tenants.id |
| `conversation_id` | uuid | não |  | FK → conversations.id, UNIQUE |
| `survey_definition_id` | uuid | não |  | FK → survey_definitions.id |
| `score` | integer | não |  |  |
| `comment` | text | sim |  |  |
| `created_at` | timestamptz | não | `now()` |  |

**Chave primária:** `id`

**Chaves estrangeiras:**
- `conversation_id` → `conversations(id)`
- `survey_definition_id` → `survey_definitions(id)`
- `tenant_id` → `tenants(id)`

**Constraints (UNIQUE/CHECK):**
- `survey_responses_conversation_id_key`: `UNIQUE (conversation_id)`
- `survey_responses_score_check`: `CHECK (((score >= 1) AND (score <= 5)))`

**Índices:**
- `survey_responses_conversation_id_key`: `CREATE UNIQUE INDEX survey_responses_conversation_id_key ON public.survey_responses USING btree (conversation_id)`
- `survey_responses_pkey`: `CREATE UNIQUE INDEX survey_responses_pkey ON public.survey_responses USING btree (id)`
- `survey_responses_tenant_time`: `CREATE INDEX survey_responses_tenant_time ON public.survey_responses USING btree (tenant_id, created_at DESC)`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## tenants

Organização cliente (raiz do isolamento multi-tenant). Guarda limite de atendimentos simultâneos e política de histórico interno.

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` | PK |
| `slug` | text | não |  | UNIQUE |
| `name` | text | não |  |  |
| `created_at` | timestamptz | não | `now()` |  |
| `max_concurrent_assignments` | integer | não | `3` |  |
| `internal_history_policy` | text | não | `'retain_until_removed'::text` |  |
| `time_zone` | text | não | `'America/Sao_Paulo'::text` |  |

**Chave primária:** `id`

**Constraints (UNIQUE/CHECK):**
- `tenants_internal_history_policy_check`: `CHECK ((internal_history_policy = 'retain_until_removed'::text))`
- `tenants_max_concurrent_assignments_range`: `CHECK (((max_concurrent_assignments >= 1) AND (max_concurrent_assignments <= 100)))`
- `tenants_name_len`: `CHECK (((char_length(name) >= 1) AND (char_length(name) <= 120)))`
- `tenants_slug_check`: `CHECK ((slug ~ '^[a-z0-9-]+$'::text))`
- `tenants_slug_key`: `UNIQUE (slug)`
- `tenants_time_zone_len`: `CHECK (((char_length(time_zone) >= 1) AND (char_length(time_zone) <= 64)))`

**Índices:**
- `tenants_pkey`: `CREATE UNIQUE INDEX tenants_pkey ON public.tenants USING btree (id)`
- `tenants_slug_key`: `CREATE UNIQUE INDEX tenants_slug_key ON public.tenants USING btree (slug)`

**Triggers:**
- `tenants_time_zone`

**RLS:** habilitada e forçada — política `tenant_self` (ALL)

## visitor_sessions

Sessões opacas de visitantes (apenas o hash do token).

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` | PK |
| `token_hash` | text | não |  | UNIQUE |
| `visitor_id` | uuid | não |  | FK → visitors.id |
| `site_id` | uuid | não |  | FK → sites.id |
| `tenant_id` | uuid | não |  | FK → tenants.id |
| `created_at` | timestamptz | não | `now()` |  |
| `expires_at` | timestamptz | não |  |  |

**Chave primária:** `id`

**Chaves estrangeiras:**
- `site_id` → `sites(id)`
- `tenant_id` → `tenants(id)`
- `visitor_id` → `visitors(id)`

**Constraints (UNIQUE/CHECK):**
- `visitor_sessions_token_hash_key`: `UNIQUE (token_hash)`

**Índices:**
- `visitor_sessions_pkey`: `CREATE UNIQUE INDEX visitor_sessions_pkey ON public.visitor_sessions USING btree (id)`
- `visitor_sessions_token_hash_key`: `CREATE UNIQUE INDEX visitor_sessions_token_hash_key ON public.visitor_sessions USING btree (token_hash)`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)

## visitors

Visitante anônimo de um site.

| Coluna | Tipo | Nulo? | Padrão | Observação |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` | PK |
| `tenant_id` | uuid | não |  | FK → tenants.id |
| `site_id` | uuid | não |  | FK → sites.id |
| `created_at` | timestamptz | não | `now()` |  |
| `display_name` | text | sim |  |  |

**Chave primária:** `id`

**Chaves estrangeiras:**
- `site_id` → `sites(id)`
- `tenant_id` → `tenants(id)`

**Constraints (UNIQUE/CHECK):**
- `visitors_display_name_len`: `CHECK (((display_name IS NULL) OR ((char_length(display_name) >= 1) AND (char_length(display_name) <= 80))))`

**Índices:**
- `visitors_pkey`: `CREATE UNIQUE INDEX visitors_pkey ON public.visitors USING btree (id)`

**RLS:** habilitada e forçada — política `tenant_isolation` (ALL)
