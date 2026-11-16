# Fusão ViaVoip WebChat + sm-webchat: plano (v1.1)

> v1.1 de 16/11/2026 (a v1.0 anterior não está neste repositório). **Aprovado pelo Luan**, com os padrões de Q1 a Q10 aceitos. **Só leitura e plano.** Sem commit, push, PR, comentário no GitHub ou acesso à VPS.
> - `LuanViavoip/WebChat` lido na `main` @ `d94be4a` (merge do PR #6, 10/11), clone de leitura.
> - `Luanzzzz/sm-webchat` lido na `main` @ `db9b221` (merge do PR #11, 16/11), clone de leitura.
> - Os dois repos foram acessíveis com o token do box. Nada ficou sem leitura.
> - Plano do chat interno: plano v2.2 do sm-webchat, que não está neste repositório.

---

## Mudanças desde a v1.0

| # | Tema | v1.0 | v1.1 |
|---|---|---|---|
| 1 | Perguntas Q1–Q10 | abertas, com padrão | **Decisões fixadas D1–D10 (16/11/2026)**, com o padrão que já estava no plano (§5). A Q7 (HTTPS no hml) saiu. A D11 (`/sm-webchat/`), nova na v1.1, também está decidida |
| 2 | HTTPS no hml | "o hml roda em HTTP" (inferido do commit `3fd580b`) | **conferido pelo Maestro na VPS:** o hml roda em HTTPS (nginx na 443 para `hml.viavoipsolutions.com.br`). O `randomUUID` do `3fd580b` vira **hipótese**: acesso direto pela porta 3010 em HTTP. C11 e F10 deixam de estar travados no hml |
| 3 | Nome do container | "não bate com o compose; nome padrão seria `viavoip-webchat-server-1`" | Revisei o `docker-compose.hml.yml` de novo: ele **não** tem `container_name`, então a leitura do repo estava certa. O **nome real** `viavoip-webchat-server` (conferido pelo Maestro na VPS) vem de algo fora do repo (outro compose, `container_name` local ou `docker run`) |
| 4 | SHA que roda no hml | não tratado | **Risco novo:** `~/webchat` na VPS não é checkout git (conferido pelo Maestro), então não se sabe o SHA em execução. Mitigação na **F1.1**: `GIT_SHA` no build e `GET /version` (§4, §6) |
| 5 | sm-webchat publicado | não citado | **conferido pelo Maestro na VPS:** o sm-webchat está em `https://hml.viavoipsolutions.com.br/sm-webchat/`. Decidido (D11, §5): `/sm-webchat/` redireciona para `/chat/` na F7 |
| 6 | Linha de base de testes | "192 testes" (doc) | **193 testes** listados na `main` @ `d94be4a`: protocol 11, sm-adapter 2, widget **19** (o `uuid.test.ts` do PR #6 é o 19º), console 61, servidor 100. O detalhe do que rodou no box de leitura está no escopo da F0/F1, que não está neste repositório |
| 7 | Lint e typecheck | gate citava lint | O WebChat **não tem** script de lint nem ESLint, e o typecheck acontece dentro do `build` (`tsc`). A F1 cria `typecheck`; lint vira F1.2 opcional |

---

## 1. Mapa dos dois sistemas

### 1.1 Visão lado a lado

| Tema | WebChat (`LuanViavoip/WebChat`) | sm-webchat (`Luanzzzz/sm-webchat`) |
|---|---|---|
| Forma | Monorepo pnpm 12.15 (`pnpm-workspace.yaml`: `apps/*`, `packages/*`), Node ≥ 22 | App único, npm (`package-lock.json`) |
| Apps | `apps/server` (Fastify 5 + Socket.IO 4.8 + `pg` + zod 4), `apps/console` (React 19.3, Vite 8, base `/console/`), `apps/widget` (React, loader `widget.js`) | `src/` React 19.2 + Vite 6 |
| Pacotes | `@viavoip/protocol` (`packages/protocol/src/{events,models,company,http,errors}.ts`, schemas zod), `@viavoip/sm-adapter` (`packages/sm-adapter/src/types.ts`, só mock) | domínio puro em `src/domain/*`, contrato em `src/transport/ChatTransport.ts` |
| TypeScript / testes | TS 7.0.2, Vitest 5.0.5; servidor contra Postgres descartável (`apps/server/test/global-setup.ts`); scripts de navegador `scripts/verify-browser.mjs` e `verify-visual.mjs` | TS 5.9 strict, Vitest 3.2, fast-check 4 (dev), Playwright 1.65 com 4 projects (1366/1920/2560/390) e axe |
| CI | **Nenhum** (`.github/` não existe; `docs/deployment/environments.md` confirma) | `.github/workflows/ci.yml`: lint, typecheck, test, build, e2e |
| Backend | Real: Postgres 16 com **RLS** por `app.tenant_id` (`migrations/001_init.sql`), Redis para réplicas (`src/realtime/redis.ts`), advisory locks, idempotência por `request_id`, recibos de comando (`009`), auditoria (`audit_events`) | **Mock**: `src/transport/mock/{MockServer,MockStore,MockBackend,TabSync}.ts`, estado em `localStorage` e sincronização por `BroadcastChannel` |
| Auth | Senha Argon2id, **token opaco** (só o hash no banco), `POST /auth/login`, `GET /auth/me`, `POST /auth/logout` (`src/http/routes.ts`), Bearer no HTTP e `auth.token` no handshake (`src/auth/handshake.ts`), `auth_epoch` e revogação distribuída (`src/realtime/revoke*.ts`). Console guarda o token em `sessionStorage` (`apps/console/src/ConsoleApp.tsx`) | "Entrar como" (`src/ui/LoginScreen.tsx`, `ChatTransport.loginGroups()`, só mock). `ConnectRequest = { tenantId, userId }`. `session-ended` por desativação |
| Tenant | `tenants` (uuid, slug, name, `time_zone` desde `009`), `tenant_id` em toda tabela, RLS `FORCE` | `Tenant { id, name, timeZone }` (`src/domain/tenant.ts`), `tenantId` em toda entidade e evento; teste de propriedade `tenantIsolation.property.test.ts` |
| Papéis | `agents.role ∈ agent/supervisor/admin` (`004`), principal `AgentPrincipal.kind` (`src/domain/types.ts`). **Matriz fixa por papel** (`src/domain/access.ts`, `company-access.ts`). Vários admins permitidos (só "pelo menos um ativo", `company-commands.ts:499`); `agent.role_change` aceita `admin` | `Role = admin/supervisor/agent/client` (`src/domain/identity.ts`). **Capacidades por usuário** com teto por papel (`src/domain/capabilities.ts`: `CAPABILITIES`, `ROLE_CEILING`, `canGrantIn`, `canAssignRole`), **um admin por empresa** (`validateDirectory`: `multiple-admins`), sem cascata, `grantLog` |
| Escopo do supervisor | `sector_supervisors` → `sector_queues` (`assertSupervisorQueueAccess`). Supervisor **não** gerencia pessoas (`assertCompanyAccess`: só `quality.report`) | Ilhas: `Ilha.supervisorId` (1 supervisor) e `Agent.ilhaId` (1 ilha). Supervisor cadastra, move, desativa e concede só a agentes das ilhas dele (`inManagementScope`, `outside-islands`) |
| Setores / ilhas | `sectors`, `sector_members` (N:N, `removed_at`), `sector_supervisors` (N:N), `sector_queues` (`004`); `docs/modules/sectors.md` | `Ilha` (`identity.ts`), N agentes, 1 supervisor; agente em exatamente uma ilha |
| Canal do cliente | Widget (`apps/widget`), `/visitor` (Socket.IO), `conversations`/`messages`, filas, claim, transferência, encerramento, pesquisa, SLA, qualidade, `SMAdapter` mock | **Removido** na Etapa 3 (#8). Tag `cliente-widget-v1` @ `9306a81` |
| Chat interno | `internal_conversations` (`direct` por `pair_key`, `group` **um por setor**, automático), `internal_participants`, `internal_messages` (**só texto**, 1–4000), `internal_reads` (cursor) — `005`, `src/modules/internal-chat.ts`, UI `apps/console/src/internal/InternalChat.tsx`. **Agente↔agente proibido** (`assertCanDirect`) | Multi-conversa por conexão; `DirectConversation` (`dm:${tenant}:${a}:${b}`), `GroupConversation` só como tipo (Etapa 6); mensagens texto, imagem, áudio, vídeo, documento, sticker; ticks `sending/sent/delivered/read`; digitando; **agente↔agente permitido** |
| Mídia | **Não há** upload nem storage | Upload com progresso e cancelamento (`ChatTransport.upload`), limites do WhatsApp (`src/domain/attachment.ts`), object URLs no mock |
| Anúncios / avisos | `announcements` (título, corpo **texto**, `pinned`, `audience ∈ tenant/sectors`, `expires_at`, `archived_at`), `announcement_revisions`, `announcement_reads` (`006`); publicar "tenant" só admin; supervisor só nos setores dele; eventos só para quem está conectado. UI `apps/console/src/announcements/AnnouncementsPanel.tsx` | Planejado (Etapas 8–9): público `all/groups/people` com foto, anexos, **visualização ≠ ciência**, revisão material, primeiro login do dia, alerta vermelho, comentários, reações, encaminhamento por referência |
| Notificações | Não há Notification API; eventos em tempo real só com o console aberto | Planejado (Etapa 7): sistema + som + visual, aba aberta ou minimizada |
| Presença e atividades | `presence_intervals`, `activity_types`, `activity_assignments` (`007`), heartbeat | Não há (só "online" no mock) |
| Supervisão | Central do Supervisor: fila, monitoramento, métricas (`src/modules/supervisor.ts`, `apps/console/src/supervisor/`) | Não há (fora do escopo do chat interno) |
| Administração | Console "Administração" com 8 seções (`apps/console/src/admin/sections/*`: Empresa, Usuários, Filas, Sites, Classificações, Pesquisa, SLA, Auditoria), `POST /company/commands` idempotente | Console admin (`src/ui/admin/AdminConsole.tsx`, `PermissionsPanel.tsx`, `GrantLogList.tsx`): supervisores, agentes, ilhas, permissões |
| Layout | Console com sidebar por papel e rotas por hash; `height: 100dvh` (`apps/console/src/ui/ui.css`), tokens em `apps/console/src/ui/tokens.css` | WhatsApp Web em 2 colunas (≥ 901 px) e lista/chat alternados (≤ 900 px), `100dvh`, tokens em `:root` de `src/styles/chat.css` com testes de contraste |

### 1.2 Onde se sobrepõem

1. **Chat interno:** os dois têm. O WebChat tem o backend real com regras mais restritas; o sm-webchat tem a UI e as regras que o Luan quer.
2. **Anúncios vs avisos:** mesmo conceito. O WebChat é a versão 1 (texto, leitura simples, público tenant/setores); o sm-webchat planeja a versão 2.
3. **Setores vs ilhas:** mesmo conceito com cardinalidade diferente (N:N no WebChat, 1 supervisor e 1 ilha por agente no sm-webchat).
4. **Administração de pessoas:** os dois cadastram, suspendem e mudam papel. O WebChat amarra isso a filas e credenciais; o sm-webchat, a ilhas e capacidades.
5. **Papéis:** os mesmos três nomes, com modelos de autorização diferentes (matriz fixa vs capacidades).
6. **Tenant:** mesmo modelo lógico (`tenant_id` em tudo, fuso na empresa). O WebChat garante no banco (RLS); o sm-webchat, no domínio e em teste de propriedade.

---

## 2. Arquitetura-alvo

### 2.1 Base principal: **o monorepo WebChat**

Motivos:
- tem o que o sm-webchat **não** tem e é caro refazer: Postgres com RLS, auth real com revogação, Socket.IO com Redis, idempotência, auditoria, migrations, Docker e o ambiente de homologação;
- já atende o acesso 1 (cliente pelo site) e é o único lugar onde o bot futuro faz sentido (o `SMAdapter` e a máquina `queued → assigned → closed`);
- o sm-webchat foi desenhado para isso: o `ChatTransport` é o contrato que "o SM implementa depois" (`docs/plano-v2.md` §2.9). Trocar o mock por um backend real é o caminho previsto, não um desvio;
- o domínio do sm-webchat é **puro** (sem React, sem I/O), então roda no servidor Node do WebChat sem adaptação.

O sm-webchat entra de três formas, cada uma no seu lugar:
1. **Novo app `apps/internal`** (a UI WhatsApp Web), servido em `/chat/` pelo mesmo Fastify. Não substitui o console: o console continua sendo a central de atendimento, supervisão e administração da empresa.
2. **Novo pacote `packages/internal-domain`** (`@viavoip/internal-domain`) com `src/domain/*` do sm-webchat: `tenant`, `identity`, `capabilities`, `permissions`, `conversation`, `directoryOps`, `message`, `attachment`, `result`. É importado pelo app **e pelo servidor**. Assim a regra "as mesmas funções puras rodam no cliente e no servidor" deixa de ser promessa e vira import.
3. **Troca do mock pelo backend real via `ChatTransport`**: `SocketTransport implements ChatTransport` no app, falando com um namespace novo `/internal` no servidor. O `MockTransport` fica como dublê de teste e modo dev, validado pela **mesma suíte de contrato**.

Descartado:
- *sm-webchat como base:* exigiria reconstruir banco, auth, RLS, Redis e todo o canal do cliente.
- *sm-webchat como pacote npm publicado:* acrescenta versionamento e publicação sem ganho; o monorepo já resolve com `workspace:*`.
- *Reescrever a UI do sm-webchat dentro do console:* perde o layout WhatsApp Web, os testes de layout e 5 etapas de trabalho revisado.

### 2.2 Onde ficam os dois acessos

```
                 ┌──────────── Fastify :3000 (hml :3010) ────────────┐
site do cliente  │ /widget.js, /widget/   → apps/widget              │  Socket.IO /visitor
                 │                                                   │
equipe           │ /console/              → apps/console             │  /agent, /supervisor
(atendimento,    │   atendimento, fila, supervisão, qualidade,       │
 supervisão,     │   administração da empresa                        │
 admin)          │ /chat/                 → apps/internal  (NOVO)    │  /internal (NOVO)
                 │   chat interno WhatsApp Web, avisos, equipe       │
                 │ /auth/*  (um login para console e chat)           │
                 │ /internal/uploads, /internal/media/:id (NOVO)     │
                 └───────────────────────────────────────────────────┘
                       Postgres (RLS por tenant)  ·  Redis (réplicas)
```

- **Acesso 1, cliente:** `widget.js` no site → `/visitor`. Atendido no console (`/agent`). O bot futuro entra aqui, como um ator do canal externo, e **nunca** no `/internal`.
- **Acesso 2, interno:** `/chat/` → `/internal`. Admin, supervisor e agente da empresa.
- O console ganha um link "Chat interno" que abre `/chat/`. As seções antigas "Chat interno" e "Anúncios" do console saem depois que o `/chat/` cobre o mesmo (Etapas F8 e F11).

### 2.3 Isolamento entre o chat de cliente e o interno

| Camada | Regra |
|---|---|
| Dados | Tabelas separadas: externo em `conversations`/`messages`/`visitors`; interno em `internal_*` e `announcement*`. Nenhuma FK cruza os dois domínios, exceto `agents` e `tenants`. RLS `FORCE` em todas as tabelas novas, com o mesmo `tenant_isolation` |
| Auth | Visitante usa `visitor_sessions`; equipe usa `auth_sessions`. O handshake do `/internal` só aceita `lookup_auth_session`. Um token de visitante nunca abre `/internal`, e um token de equipe nunca abre `/visitor`. Teste para os dois sentidos |
| Permissões | Interno: **capacidades** (`can`, `canGrantIn` do pacote de domínio). Externo: a matriz por papel atual (`access.ts`) continua; papel e escopo de setor seguem a mesma fonte (`agents.role`, `sector_*`) |
| Rotas | `/chat/` e `/internal/*` só para equipe. `/public/*` e `/visitor/*` só para visitante |
| Eventos | Namespaces separados (`/visitor`, `/agent`, `/supervisor`, `/internal`). Salas do `/internal` por `tenant:user`. Todo evento do `/internal` leva `tenantId` e passa por filtro de tenant **e** de participação antes do `emit` |
| SM / bot | Comandos internos não chamam o `SMAdapter` (já é assim, `docs/decisions.md` "Chat interno separado do atendimento") |
| Mídia | `/internal/media/:id` só entrega se o usuário participa da conversa ou está no público do aviso. Fora disso, `404` (indistinguível de inexistente) |

### 2.4 Tipos e contratos-chave (mínimo)

```ts
// packages/internal-domain: o que já existe no sm-webchat, com duas mudanças de cardinalidade (conflito C2)
export type Agent = UserBase & { role: 'agent'; ilhaIds: readonly [IlhaId, ...IlhaId[]] }; // era ilhaId
export type Ilha = { id: IlhaId; tenantId: TenantId; name: string;
                     supervisorIds: readonly UserId[] };                                 // era supervisorId
// Ilha === setor do WebChat: IlhaId é o uuid de sectors.id. Não existe tabela "ilhas".

export type GroupConversation = {
  kind: 'group'; id: ConversationId; tenantId: TenantId; title: string;
  origin: { kind: 'ilha'; ilhaId: IlhaId }          // grupo automático do setor (o que o WebChat já tem)
        | { kind: 'custom'; createdBy: UserId };    // grupo criado pelo admin/supervisor (Etapa 6)
  members: readonly [UserId, ...UserId[]];
};
```

```ts
// apps/internal/src/transport/ChatTransport.ts: separar o que é só do mock
export interface ChatTransport { /* connect, send, upload, markRead, openDirect, setTyping, subscribe, ... admin ops */ }
export interface DevLogin { loginGroups(): readonly LoginGroup[] }   // sai de ChatTransport; só MockTransport implementa

export type ConnectRequest =
  | { kind: 'token'; token: SessionToken }                // SocketTransport: o servidor resolve tenant e usuário
  | { kind: 'dev'; tenantId: TenantId; userId: UserId };  // MockTransport

// apps/internal/src/transport/SocketTransport.ts
export class SocketTransport implements ChatTransport { constructor(opts: { baseUrl: string; io: typeof import('socket.io-client').io }) }
```

```ts
// packages/protocol/src/internal-v2.ts: wire do namespace /internal (zod, como o resto do protocol)
export const internalV2ClientSchemas = {
  'internal.bootstrap': emptyObjectSchema,            // → Bootstrap (tenant, me com grants, directory, conversations, recent, unread)
  'internal.send': sendRequestSchema,                 // { conversationId, clientId, payload }  (clientId = requestId)
  'internal.read': markReadSchema,
  'internal.delivered': markReadSchema,               // cursor de entrega (tick "entregue")
  'internal.direct.open': openDirectSchema,
  'internal.typing': typingSchema,
  'internal.history': internalHistorySchema,          // reaproveita o cursor atual
  'internal.admin': internalAdminCommandSchema,       // registerAgent, moveAgent, setGrant, ... (com requestId, recibo de 009)
} as const;
export const internalV2ServerEvents = { 'internal.event': chatEventSchema } as const; // um envelope com a união ChatEvent
```

```sql
-- direção das migrations (nomes indicativos; cada uma no PR da sua etapa)
-- 012_internal_grants.sql
CREATE TABLE staff_grants (tenant_id uuid NOT NULL, agent_id uuid NOT NULL REFERENCES agents(id),
  capability text NOT NULL, granted_by uuid REFERENCES agents(id), granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, capability));                    -- + RLS; grantLog = audit_events (action 'grant.set'/'grant.revoke')
CREATE UNIQUE INDEX agents_one_admin_per_tenant ON agents (tenant_id) WHERE role = 'admin';
-- 013_internal_messages_v2.sql: internal_messages.kind + payload jsonb (texto continua em body), internal_deliveries (cursor)
-- 014_internal_groups.sql: internal_conversations.origin ('ilha'|'custom'), title, created_by; CHECK e índice únicos refeitos
-- 015_media.sql: media_objects (tenant, owner, mime, size, storage_key, conversation_id|announcement_id)
-- 016_announcements_v2.sql: audience 'all'|'groups'|'people', announcement_audience (foto), announcement_attachments,
--                           announcement_revisions.material, announcement_acks; reads = visualização
```

Notificações (Etapa 7) não têm contrato de servidor novo: consomem `ChatEvent` `message` e `announcement` no app.

---

## 3. Conflitos de modelo e de regra

Decisões do Luan que valem como restrição: supervisor gerencia só agentes das ilhas dele; um admin por empresa, que também cria grupos; sem revogação em cascata; avisos e notificações como no WhatsApp Web (aba aberta ou minimizada); layout WhatsApp Web, `100dvh`, cores só por tokens semânticos ViaVoip.

| # | Conflito | WebChat hoje | sm-webchat | Recomendação |
|---|---|---|---|---|
| **C1** | **Modelo de autorização** | Matriz fixa por papel (`access.ts`, `company-access.ts`) | Capacidades por usuário com teto, `canGrantIn` | Capacidades valem para o **interno** e para a **gestão de pessoas** (tabela `staff_grants`, backfill = `ROLE_DEFAULT` do papel). O canal do cliente mantém a matriz atual. Uma única tabela de verdade para papel e escopo (`agents.role`, `sector_*`) |
| **C2** | **Ilha vs setor (cardinalidade)** | Agente em N setores (Ana e Tiago no seed), setor com N supervisores (`sector_supervisors` N:N) | Agente em 1 ilha, ilha com 1 supervisor | Ilha **é** o setor (sem tabela paralela). O domínio passa a N:N (`ilhaIds`, `supervisorIds`). Regra do Luan preservada: o supervisor gerencia o agente se supervisiona **alguma** ilha dele. Mover de ilha vira adicionar/remover vínculo. Alternativa (D1): forçar 1:1 no banco, que quebra o seed e o vínculo setor–fila |
| **C3** | **Um admin por empresa** | Vários admins; `agent.role_change` promove a `admin`; tenant B do seed **não tem admin** | Exatamente um admin ativo, sem criação no app | Índice único parcial `agents(tenant_id) WHERE role='admin'`; tirar `admin` de `agentPlacementSchema` (só provisionamento); seed do tenant B ganha um admin. Migration verifica antes e aborta com mensagem se algum tenant tiver 2+ admins |
| **C4** | **Supervisor gerencia pessoas** | Não gerencia (gestão é exclusiva do admin) | Cadastra, move, desativa e concede a agentes das ilhas dele, dentro do teto | Comandos de pessoas passam por `canRegisterAgentIn`/`canSetActiveIn`/`canMoveAgentIn`/`canGrantIn`. Filas, credenciais, sites, SLA e demais seções continuam só do admin (D4) |
| **C5** | **Conversa direta** | Agente↔agente proibido (`assertCanDirect`, `docs/decisions.md`) | Permitido no mesmo tenant (decisão do Luan) | `assertCanDirect` passa a delegar ao `can(direct.open)` do pacote de domínio. O teste atual que espera `forbidden` muda de sinal (mudança intencional, registrada em `docs/decisions.md`) |
| **C6** | **Grupos** | Um grupo **automático** por setor, membros sincronizados | Grupos criados pelo admin/supervisor, ilha opcional para pré-selecionar | `origin: 'ilha' \| 'custom'`. Os grupos de setor existentes ficam (com histórico), membros só pela sincronização, sem edição manual. Os custom seguem a Etapa 6 (admin cria e edita qualquer um; supervisor, os que criou) |
| **C7** | **Anúncios vs avisos** | Texto, `tenant/sectors`, leitura única, `pinned`, `archived`; "tenant" só admin | Mídia, `all/groups/people` com foto, visualização ≠ ciência, revisão material, comentários, encaminhamento | Evoluir as tabelas do WebChat (não criar outro quadro): `tenant → all`, `sectors → groups` (os grupos de setor); `announcement_reads` vira a **visualização**; `announcement_acks` novo; `pinned` e `archived` ficam. Quem publica: capacidade `announcement.publish` (por padrão admin e supervisor). Restrição atual "tenant só admin" cai (D5) |
| **C8** | **Mensagem e mídia** | `internal_messages.body` texto 1–4000; sem storage | 6 tipos, upload com progresso, limites do WhatsApp | `kind` + `payload jsonb` em `internal_messages`; upload HTTP autenticado com `MEDIA_RULES` do pacote de domínio no servidor; storage atrás de uma interface (`MediaStore`: disco no hml, S3 depois). D3 |
| **C9** | **Ticks e digitando** | Só cursor de leitura; sem "digitando" | `sent/delivered/read` e digitando | Cursor `internal_deliveries` (igual ao de leitura). "Digitando" efêmero via Socket.IO (sem banco), limitado por taxa |
| **C10** | **Login** | Senha + token opaco em `sessionStorage` por aba | "Entrar como" | `/chat/` usa o mesmo `/auth/login`. "Entrar como" só no build dev/mock (`DevLogin`). Como `sessionStorage` é por aba, cada aba do chat pede login; padrão aceito (D6) |
| **C11** | **Notificações exigem contexto seguro** | O hml roda em **HTTPS** pelo nginx (conferido pelo Maestro na VPS). O acesso direto `http://<vps>:3010` continua em HTTP | Notification API e `AudioContext` destravado | A Notification API só funciona em contexto seguro. Testar e usar sempre pela URL HTTPS; o acesso pela 3010 serve só para diagnóstico. Hipótese: o `randomUUID` do `3fd580b` falhou por esse acesso direto. Recomendo, fora da fusão, deixar a 3010 só em `127.0.0.1` no compose do hml |
| **C12** | **Duas telas de pessoas** | Console > Administração > Usuários (credencial, papel, filas, atividade) | Console admin do sm-webchat (ilhas, permissões, grantLog) | Um só backend de comandos. UI: **Equipe** no `/chat/` cuida de pessoas, ilhas e permissões (o que o supervisor também usa); o console mantém só o que é do atendimento (filas, autoridade de atividade, redefinir credencial) e linka para Equipe. D4 |
| **C13** | **Toolchain** | TS 7, Vite 8, Vitest 5, pnpm | TS 5.9, Vite 6, Vitest 3, npm | Na F1 o app entra com as **versões dele** (pnpm aceita por pacote). Alinhar em PR próprio depois, com a suíte inteira como gate |
| **C14** | **Tokens de cor** | `apps/console/src/ui/tokens.css` (marca: `--color-primary #3740b0`, navy, accent) | `:root` de `src/styles/chat.css` + testes de contraste | Uma fonte de tokens de marca em `packages/tokens` (CSS) mais tarde. Na fusão, cada app mantém os próprios tokens semânticos e o gate de hex do sm-webchat continua no `apps/internal` |

Sem conflito (já iguais): sem revogação em cascata (o WebChat não tem grants, então nada a desfazer); fuso da empresa (`tenants.time_zone` ↔ `Tenant.timeZone`); idempotência por id do cliente (`request_id` ↔ `clientId`).

---

## 4. Etapas (uma por PR, sem quebrar o webchat atual)

Gate comum a todo PR no WebChat:
- `pnpm test` e `pnpm build` verdes, **sem perda** na contagem atual (193 testes listados em `d94be4a`; o doc ainda diz 192);
- `node scripts/verify-browser.mjs` com saída 0 quando tocar servidor ou console;
- migrations novas aplicadas do zero **e** sobre um banco com o seed (teste no estilo de `company-migration.test.ts`);
- no `apps/internal`: lint, typecheck, Vitest, build e Playwright nos projects atuais com axe, mais o gate de hex.

| Etapa | Escopo | Critério de aceite | Riscos |
|---|---|---|---|
| **F0. Doc e baseline** (WebChat, só docs) | ADR "fusão com o chat interno" em `docs/decisions.md`; este plano em `docs/fusao/`; corrigir `docs/STATUS.md` e `README.md`, que citam `3d9e2cf`, para `d94be4a` (inclui PR #5 e #6: UUID em HTTP, `require_visitor_name = true` no seed, `docker-compose.hml.yml`). Escopo detalhado no documento de escopo da F0/F1, que não está neste repositório | Revisão do Luan; `pnpm test` recontado e registrado (193 esperados) | Nenhum de código |
| **F1. CI no WebChat** | `.github/workflows/ci.yml`: `pnpm install --frozen-lockfile`, `pnpm typecheck` (script novo), `pnpm build`, `pnpm test`. **Sem services**: a suíte do servidor já sobe Postgres e Redis por Testcontainers (`apps/server/test/global-setup.ts`, `redis-replicas.test.ts`), e o runner do GitHub tem Docker | CI verde no PR da F1 com 193 testes; PR de teste com erro de tipo fica vermelho | Pull de imagens a cada run; erro de Docker mascarado pelo Vitest ("No test files found" + `charCodeAt`) |
| **F1.1. SHA rastreável (opcional, recomendado)** | `ARG GIT_SHA` no `Dockerfile` → `ENV GIT_SHA`; `GET /version` devolve `{ sha, builtAt }`; `docker-compose.hml.yml` passa `build.args.GIT_SHA` | `curl /version` no container local devolve o SHA do `git rev-parse HEAD`; sem `GIT_SHA` devolve `"unknown"` e não quebra o boot | O SHA só é confiável se quem faz deploy passar o arg; sem git na VPS, o deploy precisa gerar o valor na origem |
| **F2. Importar o sm-webchat como `apps/internal`** | `git subtree add --prefix apps/internal` do sm-webchat @ `db9b221` (preserva histórico); `package.json` vira `@viavoip/internal` no workspace; Vite `base: '/chat/'`; `registerStatic` serve `/chat/`; Dockerfile copia o app. Só `MockTransport`. CI ganha o job do app (o `ci.yml` atual do sm-webchat adaptado para pnpm) | Todos os testes do sm-webchat verdes dentro do monorepo, mesma contagem; Playwright verde; `docker build` ok; `GET /chat/` 200 no container; console e widget intocados (`verify-browser` 0) | Versões de toolchain diferentes no mesmo lock; `localStorage` do mock em `/chat/` |
| **F3. Pacote `@viavoip/internal-domain`** | Mover `apps/internal/src/domain/*` e seus testes para `packages/internal-domain`; o app importa do pacote. Sem mudança de comportamento | Mesma contagem de testes (agora divididos entre pacote e app); `rg "from '../domain" apps/internal/src` vazio | Imports relativos espalhados; build do pacote antes do app (mesmo padrão do `protocol`) |
| **F4. Reconciliar o modelo (C2, C6)** | No domínio e no mock: `Agent.ilhaIds`, `Ilha.supervisorIds`, `GroupConversation.origin`; `inManagementScope` com "alguma ilha"; geradores do fast-check para N:N | Propriedades P1 a P6 e isolamento verdes com o gerador N:N; matriz de `capabilities.test.ts` revista; `admin.spec.ts` adaptado | É a única etapa que muda tipos já entregues; manter nomes para limitar o diff |
| **F5. Servidor: identidade e permissões (C1, C3, C4)** | Migration `012`: `staff_grants` com backfill, índice de um admin por tenant, admin no tenant B do seed; `admin` sai de `agentPlacementSchema`; comandos `grant.set` e comandos de pessoas com escopo de ilha usando o pacote de domínio; `audit_events` como grantLog | Testes de servidor: supervisor concede a agente da ilha dele e recebe `forbidden` fora dela; ninguém concede o que não tem; self-grant e cross-tenant `forbidden`; 2º admin falha no banco; sem cascata; suíte atual verde, com as mudanças de sinal listadas no PR | Migração de dados em hml com mais de um admin; a regra "pelo menos um admin ativo" muda para "exatamente um" |
| **F6. Servidor: namespace `/internal` v2 (C5, C9)** | Schemas `internal-v2` no `protocol`; `/internal` com bootstrap, send (texto), read, delivered, direct.open (agente↔agente), typing, history, eventos `ChatEvent` com `tenantId`; migration `013`. Os eventos antigos `internal.*` do `/agent`/`/supervisor` continuam até a F8 | **Suíte de contrato única** (`apps/internal/src/transport/contract.suite.ts`) rodando contra `MockTransport` e contra um `SocketTransport` ligado ao servidor de teste; teste de isolamento: token de visitante recusado no `/internal`, evento de A nunca chega a B; `assertCanDirect` agente↔agente ok | Duas versões do chat interno convivendo; entrega pós-commit não durável (F4-07 do WebChat) continua |
| **F7. App no backend real (C10)** | `SocketTransport` vira o padrão do build; login real em `/chat/`; `DevLogin` só no modo mock; link no console | Playwright `two-users.spec.ts`, `tenant.spec.ts`, `login.spec.ts` contra o `docker compose` real, nos 4 viewports com axe; `verify-browser` 0 | E2E com servidor real fica mais lento; seed precisa de dados equivalentes aos do mock |
| **F8. Mídia real (C8) e subtração do chat antigo** | `POST /internal/uploads` (stream, limites do `MEDIA_RULES`), `GET /internal/media/:id` com checagem de participação; `MediaStore` em disco (volume no compose); migration `015`. Depois: a seção "Chat interno" do console vira link para `/chat/`, e saem `InternalChat.tsx`, `history-sync.ts` e os eventos `internal.*` antigos | `media.spec.ts` contra o real; download sem participação → 404; cross-tenant → 404; arquivo acima do limite → 413 sem gravar; contagem de testes do console cai só pelos arquivos removidos | Disco na VPS (cota, backup); antivírus fica residual |
| **F9 = Etapa 6 (grupos)** | Grupos custom (migration `014`), admin e supervisor criam; grupos de ilha só leitura de membros | Aceite da Etapa 6 do plano v2.2, rodando na suíte de contrato (mock e real) + `groups.spec.ts` real | Sincronização de membros dos grupos de ilha com advisory lock |
| **F10 = Etapa 7 (notificações)** | Igual à Etapa 7 do plano v2.2, só no app | Aceite da Etapa 7; teste manual no hml pela URL HTTPS | Acesso pela 3010 em HTTP não notifica (C11); Focus Assist do Windows |
| **F11 = Etapa 8 (avisos)** | Migration `016`, evolução das tabelas de anúncio (C7), quadro no `/chat/`; a seção "Anúncios" do console vira link | Aceite da Etapa 8; anúncios antigos aparecem migrados (`tenant → all`, `sectors → groups`) com visualização preservada | Migração de dados de anúncios existentes no hml |
| **F12 = Etapa 9 (interação e encaminhamento)** | Comentários, reações, encaminhamento por referência | Aceite da Etapa 9, mock e real | Checagem de público em cada render do card encaminhado (custo de consulta) |

### 4.1 Onde entram as Etapas 6 a 9 do sm-webchat

- **Etapas 6, 8 e 9: no backend real, depois da F6/F7.** Elas são sobretudo modelo de dados (grupos, público, ciência, revisões, anexos). Fazer no mock do sm-webchat antes significaria:
  1. persistir tudo duas vezes (mock e Postgres);
  2. desenhar sobre o modelo errado (ilha 1:1, grupo só custom, aviso novo), que a F4 e a C7 mudam. Os tipos de grupo e aviso seriam refeitos.
  Já o domínio puro e a UI dessas etapas não se perdem em nenhum caminho, e o mock continua acompanhando cada PR pela suíte de contrato.
- **Etapa 7 (notificações): pode ir antes, logo depois da F2, no mock dentro do monorepo.** Ela só consome `ChatEvent` e não tem contrato de servidor, então não há retrabalho em fazê-la cedo. Ela também pode correr em paralelo à F5/F6. Com o hml em HTTPS (conferido pelo Maestro na VPS), ela não fica travada no hml.
- **Nada novo no repo `sm-webchat` depois da F2.** O repo fica congelado (D2).

---

## 5. Decisões fixadas (16/11/2026)

Aprovadas pelo Luan em 16/11/2026, com o padrão que o plano v1.0 propunha. A antiga Q7 (HTTPS no hml) saiu: o hml já roda em HTTPS (conferido pelo Maestro na VPS).

| # | Tema | Decisão |
|---|---|---|
| D1 | Cardinalidade ilha/setor | **N:N**: agente em várias ilhas e ilha com vários supervisores, como o WebChat já tem. O supervisor gerencia o agente se supervisiona alguma ilha dele |
| D2 | Código do sm-webchat | Vai para o `LuanViavoip/WebChat` via `git subtree` com histórico. O `Luanzzzz/sm-webchat` fica congelado após a F2 e é arquivado após a F7 |
| D3 | Mídia | Volume em disco no hml atrás de `MediaStore`; S3 compatível em produção; sem antivírus nesta fase |
| D4 | Poderes do supervisor e dono do cadastro | Supervisor: cadastrar, mover, desativar/reativar e conceder `chat.use` a agentes das ilhas dele; sem filas nem senha. Dono do cadastro de pessoas: tela **Equipe** no `/chat/`. O console fica com filas, atividade e credencial |
| D5 | Aviso para "todos" | O supervisor publica para todos se tiver `announcement.publish` |
| D6 | Login | Cada aba do chat pede login (`sessionStorage`). "Lembrar sessão" fica como residual |
| D8 | Grupos automáticos por setor | Continuam, com membros só pela sincronização do setor |
| D9 | Anúncios existentes | Migrados (`tenant → all`, `sectors → groups`); a leitura antiga vira visualização, sem ciência |
| D10 | Admin | Seed ganha um admin no tenant B; a migration 012 aborta se achar 2+ admins numa empresa, para o Luan escolher |

(A D7 foi retirada porque o hml já roda em HTTPS (conferido na VPS; não verificável pelo repo), então as notificações do navegador funcionam lá. A numeração foi mantida para casar com a v1.0.)

**Decidida (nova na v1.1):**
- **D11. `/sm-webchat/` publicado no hml.** *Decisão:* fica como está até a F7. Na F7, `/sm-webchat/` redireciona para `/chat/` e a publicação estática antiga sai.

---

## 6. Indícios de que a VPS (hml) difere do GitHub

Eu não acessei a VPS. Os itens marcados **conferido pelo Maestro na VPS** são relato dele, que eu não verifiquei.

1. **A configuração do hml não está versionada.** O `docker-compose.hml.yml` (porta `3010:3000`) usa `env_file: .env.hml`, e `.env.*` está no `.gitignore`. `SEED`, `CORS_ORIGINS`, `SM_ADAPTER` e os segredos do hml não são verificáveis pelo repo.
2. **Nome do container.** O `docker-compose.hml.yml` do repo (revisto na v1.1) não tem `container_name`; com ele, o Compose v2 criaria `viavoip-webchat-server-1`. O container real se chama `viavoip-webchat-server` (conferido pelo Maestro na VPS). Então o hml **não sobe exatamente com o compose do repo**: há outro compose, um `container_name` local ou um `docker run`. A F1.1 propõe versionar o que de fato sobe.
3. **HTTPS.** O hml roda em HTTPS, com nginx na 443 para `hml.viavoipsolutions.com.br`, e o sm-webchat está em `https://hml.viavoipsolutions.com.br/sm-webchat/` (conferido pelo Maestro na VPS). **Hipótese** para o commit `3fd580b` ("O navegador em HTTP não oferece crypto.randomUUID"): o teste foi feito pelo acesso direto `http://…:3010`, que pula o nginx.
4. **SHA desconhecido (risco).** O `~/webchat` da VPS não é um checkout git (conferido pelo Maestro na VPS), então não dá para saber qual SHA roda. **Mitigação (F1.1):** `ARG GIT_SHA` no `Dockerfile`, `GET /version` com `{ sha, builtAt }` e o compose do hml passando `GIT_SHA=$(git rev-parse HEAD)` na máquina de origem do deploy. Até lá, comparar por conteúdo (por exemplo `sha256sum` de `infra/seed/seed.sql` e de `docker-compose.hml.yml`) é o único jeito.
5. **A documentação está atrás do código.** `README.md` e `docs/STATUS.md` citam o commit `3d9e2cf` (29/10). A `main` está em `d94be4a` (confirmado com `git fetch` em 16/11), com os PRs #5 (cabeçalho da 009) e #6 (UUID sem `crypto.randomUUID`, nome do visitante obrigatório no seed: `require_visitor_name = true`). O `docs/CHANGELOG.md` não registra o PR #6. A F0 corrige.
6. Não há tags, branch de homologação, notas de hotfix nem CI/CD no repo. As 4 branches remotas além da `main` estão 0 commits à frente dela.

---

## 7. Riscos transversais

- **Migrations em hml com dados reais de teste:** cada migration da fusão precisa de um teste "aplica sobre o seed" e de um plano de volta. Nenhuma deve apagar dado antigo; a remoção de colunas vem em PR separado.
- **Duas versões do chat interno convivendo (F6 a F8):** risco de mensagem enviada por um lado não aparecer no outro. Mitigação: as duas leem e gravam as mesmas tabelas; o evento novo é emitido nos dois namespaces até a F8.
- **Entrega pós-commit não durável** (F4-07 do WebChat) passa a afetar o chat interno com mídia e avisos. Fora do escopo da fusão, mas é a primeira coisa a resolver antes de produção (outbox).
- **Escalonamento de privilégio:** as funções de permissão passam a rodar no servidor a partir do pacote de domínio. A UI só esconde. A matriz e as propriedades P1–P6 viram testes de servidor também.
- **Tamanho do bundle e do container:** o app novo aumenta a imagem. Aceitável; medir na F2.
