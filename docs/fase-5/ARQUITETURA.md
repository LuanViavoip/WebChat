# Fase 5 — Gestão administrativa, configurações por empresa e qualidade operacional

Desenho. Nada neste documento está ligado ao processo que atende o widget. Os serviços, as rotas e o cálculo de qualidade lançam `throw new Error('not implemented')`. A migration proposta está em [migrations/009_company_admin.sql](migrations/009_company_admin.sql) e fica fora de `apps/server/migrations/` até a unidade 1 do plano.

O Luan manteve o armazenamento relacional, o reaproveitamento de `audit_events`, o isolamento por empresa e as 10 unidades. O ajuste abaixo incorpora as decisões dele. O Ciclo A é a sequência 1–4: cada unidade termina com teste verde antes da próxima.

## Escopo

Não há especificação anterior da Fase 5 no repositório. O nome da fase e o que a Fase 4 deixou pronto definem o corte abaixo. As escolhas que o Luan pode inverter estão no final, já decididas aqui para o desenho não ficar aberto.

Entra:

- Cadastro da empresa feito pelo administrador do próprio tenant: pessoas, filas, classificações, pesquisa, sites do widget, limite de atendimentos, fuso e política de SLA.
- Leitura de qualidade operacional sobre fatos que o atendimento já grava.
- Leitura da auditoria que a Fase 4 já escreve em `audit_events`, mais os comandos novos.

Fica de fora: operador acima do tenant, painel global, IdP, outbox da F4-07, rollup materializado, troca de e-mail nesta fase, contrato ou chamada ao SM, e qualquer mudança de widget, atendimento, chat interno, setores, atividades ou painel ao vivo do supervisor além do que as unidades citam. A invalidação imediata de socket na suspensão, na troca de permissão e na revogação de sessão entra. O outbox não entra.

A linha de base é o código em que a Fase 4 já tem RLS, papéis `agent` | `supervisor` | `admin`, `withTenant`, `audit_events` e o painel ao vivo `supervisor.metrics`. Esse painel continua sendo o retrato do instante. A Fase 5 acrescenta o histórico medido.

## Uso pelo chamador

O console já entra por `POST /auth/login` e guarda o token opaco. A Fase 5 não abre outro canal. Quatro funções em `apps/console/src/admin/company-desk.ts` são a superfície inteira:

```ts
loadCompanyDesk(session)            // GET /company/desk
applyCompanyCommand(session, command) // POST /company/commands
loadQualityReport(session, query)   // GET /quality/report
loadAuditPage(session, query)       // GET /audit/events
```

`session` é `{ token }`. Nenhum argumento leva `tenantId`. O servidor continua resolvendo a empresa pela sessão.

O administrador abre a mesa com `loadCompanyDesk`. A resposta é um `CompanyDesk`: perfil, sites, filas, classificações, pesquisa, pessoas e políticas de SLA. Para mudar alguma coisa ele envia um envelope `{ requestId, command }` e recebe a mesa inteira de novo. O console substitui o estado local por essa resposta. Não há mesclagem no cliente. O comando devolve o resultado depois do commit. Suspensão, troca de permissão e revogação desconectam os sockets da pessoa pelo adapter que já existe; não há evento de produto novo. No retry depois de timeout o console reenvia o mesmo `requestId`.

A supervisora não chama a mesa nem a auditoria. Ela chama `loadQualityReport` com escopo de setor ou de fila. O administrador pode pedir o tenant inteiro. O agente e o visitante não recebem essas seções.

O widget não fala com essas rotas. Ele continua em `GET /public/widgets/:publicId`. Quando a unidade 5 ligar `resolveAcceptance`, a abertura de conversa passa a usar a aceitação efetiva. Até lá, `sites.accepting_chats` segue sendo o que o atendimento lê hoje.

Exemplo, o administrador publica o SLA da fila Suporte e em seguida lê o relatório dos últimos sete dias:

```ts
await applyCompanyCommand(session, {
  requestId,
  command: {
    kind: 'sla.publish',
    queueId: suporte,
    effectiveFrom: '2026-10-28T15:00:00.000Z',
    queueWaitThresholdSeconds: 120,
    firstResponseThresholdSeconds: 60,
  },
});

await loadQualityReport(session, {
  scope: { kind: 'queue', queueId: suporte },
  from: '2026-10-21T00:00:00.000Z',
  to: '2026-10-28T00:00:00.000Z',
});
```

A query HTTP achata o escopo em `scopeKind`, `sectorId` e `queueId`. O chamador trabalha com a união `QualityScope`, não com a query string.

## Dois desenhos

### Desenho A — catálogo chave/valor e auditoria só por eventos

Cada configuração vira uma linha `(tenant_id, chave, valor jsonb, revisão)`. A chave é uma união fechada e o valor é validado no serviço. A auditoria permanece em `audit_events`. A qualidade é calculada na leitura.

A interface de armazenamento é genérica: `ler(chave)` e `gravar(chave, valor)`. O chamador, ou cada tela, precisa conhecer a chave, o default, a revisão e o formato. O módulo esconde pouco. Profundidade baixa.

Riscos: o `CHECK` por configuração some; o claim, que hoje lê `tenants.max_concurrent_assignments`, passaria a interpretar JSON; as colunas que já decidem o atendimento (`accepting_chats`, aparência do site, limite simultâneo) ficariam duplicadas ou teriam de ser migradas para o catálogo no caminho quente. Duas chaves editadas ao mesmo tempo pedem revisão por chave. Uma chave desconhecida só falha na aplicação.

### Desenho B — um documento JSON, um log de fotos e um rollup

Uma linha por empresa guarda o documento validado por um schema Zod, com revisão otimista. Cada mudança grava uma foto antes/depois numa tabela nova de log operacional, ao lado de `audit_events`. Um job horário materializa `quality_rollups`. O chamador lê o rollup.

A interface parece uma só: o documento. Na prática o chamador edita um blob largo, e SLA por fila, janela por site e pessoa por empresa são listas dentro desse blob. O banco não restringe cardinalidade nem vigência. O log de fotos e `audit_events` contam duas histórias. O rollup pode atrasar ou divergir do fato commitado, a mesma classe de falha da entrega pós-commit que a Fase 4 deixou em aberto.

Profundidade aparente, vazamento real: a complexidade de concorrência, de vigência e de atraso continua visível para quem lê o relatório.

### Comparação

| | Desenho A | Desenho B | Escolhido |
|---|---|---|---|
| O que o chamador vê | chave, valor e revisão | documento inteiro e rollup | quatro operações e um comando discriminado |
| Onde mora a restrição | serviço | schema do documento | `CHECK`, índice único e trigger, mais Zod na borda |
| Auditoria | `audit_events` | tabela nova de fotos | `audit_events`, na mesma transação do comando |
| Qualidade | consulta aos fatos | tabela materializada | consulta aos fatos, julgada pela política vigente na hora |
| Custo de uma configuração nova | linha nova, sem migration | campo no documento | migration e uma variante de comando |
| Risco principal | caminho quente passa a ler JSON | duas verdades e rollup atrasado | relatório varre eventos dentro de uma janela curta |

## Desenho escolhido

A superfície é funda de propósito. O chamador conhece quatro operações. Atrás delas ficam o mapeamento para colunas que o atendimento já usa, a vigência do SLA, a reconstrução da espera a partir de `conversation_events`, o escopo do supervisor e o fato de `password_hash` continuar ilegível para `webchat_app`.

O armazenamento é relacional e estreito. O que já é coluna quente continua coluna: limite em `tenants.max_concurrent_assignments`, aparência e origens em `sites`, pesquisa em `survey_definitions`. O que tem outra cardinalidade ganha tabela própria: janelas do site, políticas de SLA e relógios da política. Não há catálogo chave/valor e não há documento JSON de empresa.

A auditoria continua um evento append-only em `audit_events`, escrito por `writeAudit` na mesma transação do comando. A migration revoga `UPDATE` e `DELETE` dessa tabela para `webchat_app`. Não há segunda tabela de log.

A qualidade é uma leitura. Não há job, não há outbox e não há linha de “violação” gravada no momento do atendimento. O mesmo fato, lido de novo, produz o mesmo julgamento enquanto as políticas não forem reescritas. As políticas são imutáveis: publicar cria outra linha; aposentar só preenche `retired_at`.

Estados novos são uniões discriminadas. Onde o dado carrega payload, a união tem o payload no ramo certo (`paused` tem motivo, `suspended` tem instante e motivo, `outside_service_window` tem `resumesAt`). Onde o estado não carrega payload, o contrato usa um enum fechado, no mesmo estilo de `role`: `enabled` | `disabled` no comentário da pesquisa. Flags booleanas novas não entram na API. Colunas booleanas que já existem permanecem no banco e são traduzidas na borda: `accepting_chats`, `can_change_own_activity`, `comment_enabled`, `survey_definitions.active`.

## Tipos de domínio

Os contratos de fio estão em `packages/protocol/src/company.ts`. Os fatos internos da qualidade, que não saem na API, estão em `apps/server/src/domain/quality-facts.ts`.

Mesa (`CompanyDesk`):

- `company`: nome, slug imutável, `timeZone`, `concurrencyLimit` de 1 a 100, histórico interno fixo em `{ policy: 'retain_until_removed' }`.
- `sites[]`: `appearance` (cor, `logo: { kind: 'none' } | { kind: 'https', url }`, saudação, `identity: anonymous_allowed | name_required`), `acceptance: accepting | { kind: 'paused', reason }`, `calendar: always_open | { kind: 'weekly', windows }`, origens.
- `queues[]`, `dispositions[]` com `publication: active | { status: 'retired', retiredAt }`.
- `survey`: `unpublished` ou `active` com prompt, escala 1–5 e comentário `enabled | disabled`.
- `agents[]`: e-mail, nome, `membership: active | { status: 'suspended', suspendedAt, reason }`, `placement`.
- `placement`: `{ role: 'agent', queueIds, activityAuthority }` ou `{ role: 'supervisor' }` ou `{ role: 'admin' }`. `activityAuthority` é `assigned_only | self_service` e só existe no ramo agente. É a tradução de `can_change_own_activity`.
- `slaPolicies[]`: relógio `queue_wait`, relógio `first_response`, vida `active` ou `retired`.

Comandos (`CompanyCommand`), um por pedido:

| Comando | Efeito |
|---|---|
| `agent.create` | Pessoa, senha inicial, placement. E-mail em minúsculas. |
| `agent.suspend` | Membership suspensa e sessões apagadas. |
| `agent.reactivate` | Volta a `active`. Não reabre sessão. |
| `agent.role_change` | Troca o placement e apaga as sessões. |
| `agent.queues_replace` | Filas de um agente. Recusado se o papel não for `agent`. |
| `agent.activity_authority` | Só para agente. |
| `agent.credential_reset` | Nova senha e sessões apagadas. A senha não entra na auditoria. |
| `agent.sessions_revoke` | Apaga `auth_sessions` da pessoa. |
| `queue.create`, `queue.rename` | Fila. Sem exclusão. |
| `disposition.create`, `disposition.rename`, `disposition.retire` | Classificação. Nome continua único, inclusive apos a aposentadoria. |
| `survey.publish` | Nova definição ativa. A anterior deixa de ser a ativa. |
| `company.rename`, `company.concurrency_limit`, `company.time_zone` | Perfil. O slug não tem comando. |
| `site.create` | Site com aparência padrão da migration 002, calendário `always_open`, origens vazias e aceitação `paused` com motivo `Aguardando origens permitidas`. `public_id` imutável. |
| `site.appearance_replace`, `site.acceptance_set`, `site.origins_replace`, `site.service_windows_replace` | Configuração do widget. |
| `sla.publish`, `sla.retire` | Política da fila. Limiares não se alteram na linha existente. |

Janela semanal: `weekday` 1 = segunda … 7 = domingo, minutos locais do fuso da empresa, `endMinute > startMinute`, sem atravessar a meia-noite, no máximo 21 janelas, sem sobreposição. O schema recusa janela invertida e sobreposta.

Senha nova: 12 a 200 caracteres. Contas já existentes não são obrigadas a rotacionar.

Limites do contrato, iguais em espírito aos do protocolo atual: 20 sites, 50 filas, 50 classificações, 500 pessoas, 200 políticas na mesa, 20 origens. Estourar o teto na leitura é `conflict` com a mensagem `Limite do cadastro`.

Aceitação efetiva, calculada e não armazenada:

```ts
resolveAcceptance(acceptance, calendar, timeZone, nowIso): EffectiveAcceptance
```

Prioridade: `paused` vence o calendário. Calendário `always_open` com aceitação `accepting` resulta em `accepting`. Calendário semanal fora da janela resulta em `{ kind: 'outside_service_window', resumesAt }`. `resumesAt` é o instante absoluto da próxima abertura.

Exemplo travado para o teste da unidade 5: fuso `America/Sao_Paulo`, janela segunda 09:00–12:00 (`weekday: 1`, `startMinute: 540`, `endMinute: 720`), agora `2026-10-28T15:00:00.000Z` (quarta-feira 12:00 em São Paulo). Resultado: `resumesAt = 2026-11-02T12:00:00.000Z`.

Qualidade (`QualityReport`): escopo e janela de no máximo 31 dias. Três resumos de duração — espera (`queueWait`), primeira resposta (`firstResponse`) e atendimento (`handleTime`) — cada um com `samples`, `totalSeconds`, `averageSeconds`, `p50Seconds`, `p90Seconds` e `maxSeconds`, todos nulos quando `samples = 0`. A duração da primeira resposta só inclui quem respondeu. `firstResponseCoverage` traz `answered`, `unansweredClosed`, `stillOpen` e `unreadable`. Encerrado sem resposta entra em `unansweredClosed` e, na unidade 7, em `sla.firstResponse.breached` quando há política. Indicadores `queueWaits` (`completed`, `abandoned`, `open`, `unreadable`). `completions.classified` conta classificações. Pesquisa, dois tallys de SLA e segundos de presença. Sem drill-down. O cálculo fica na unidade 7; o contrato já está fechado.

Auditoria (`AuditEntry`): ator, instante, ação discriminada e recurso `{ presence: 'none', type }` ou `{ presence: 'id', type, id }`. Ação desconhecida na base vira `{ kind: 'unrecognized', raw }`. A página devolve no máximo 100 linhas e `nextCursor`.

Fatos internos, usados só pelo cálculo:

- `QueueWaitFact`: `completed | abandoned | open | unreadable`.
- `FirstResponseFact`: `answered | closed_without_reply | handed_off_without_reply | still_open | unreadable`. A devolução usa `end: released`; a transferência usa `end: transferred`.
- `HandleTimeFact`: `closed_segment | still_open | unreadable`.
- `SlaJudgement`: `within`, `breached` com `elapsed: measured | no_reply`, ou `not_applicable` com `no_policy | still_open | abandoned | handed_off | unreadable`. Encerrado sem resposta do agente é `breached` / `no_reply` quando há política. Aberto não é violação definitiva.

## Migrations propostas

O arquivo executável é [migrations/009_company_admin.sql](migrations/009_company_admin.sql). Resumo do que ele faz:

- `tenants.time_zone`, default `America/Sao_Paulo`, nome IANA que o PostgreSQL reconhece. Os instantes continuam `timestamptz` em UTC. O calendário converte o instante para esse fuso, inclusive horário de verão.
- `agents.auth_epoch` e `auth_sessions.auth_epoch`, ambos começando em 1.
- `agents.membership_status`, `suspended_at`, `suspension_reason`, com `CHECK` que amarra status e colunas.
- `sites.acceptance` e `sites.pause_reason`, preenchidos a partir de `accepting_chats`. O trigger `sync_site_acceptance` mantém os dois lados: quem grava `acceptance` atualiza o booleano; quem ainda grava `accepting_chats` (o teste da Fase 2 faz isso) atualiza `acceptance`. Pausa sem motivo recebe `Suspenso fora do cadastro`.
- `dispositions.status` e `retired_at`.
- `site_service_windows`, com sobreposição recusada pelo trigger.
- `sla_policies` e `sla_policy_clocks`. Um índice único parcial garante uma política `active` por fila. Um constraint trigger adiado exige os dois relógios. `webchat_app` pode atualizar só `status` e `retired_at` da política e não pode atualizar o relógio. `btree_gist` e uma `EXCLUDE` em `tstzrange(effective_from, retired_at, '[)')` por `queue_id` impedem sobreposição. O trigger `enforce_sla_publication` recusa `effective_from` anterior a `now()` e recusa buraco entre duas vigências futuras.
- `company_command_receipts`: recibo por `(tenant_id, actor_id, request_id)`, com `payload_hash` e `status` `in_flight | applied`. Não guarda mesa. RLS forçada. `webchat_app` insere e atualiza só `status` e `applied_at`.
- `NOTIFY webchat_session_revoke` depois de `DELETE` em `auth_sessions`, com `tenantId`, `agentId` e `sessionId`.
- Uma pesquisa `active` por tenant. Se houver mais de uma, a mais antiga permanece, que é a que `loadActiveSurvey` já escolhe, e as outras passam a `active = false`.
- Índices de leitura: `conversation_events` por conversa e por tenant/tempo, `survey_responses` por tenant/tempo, `audit_events` por tenant/ação/tempo.
- RLS forçada e política `tenant_isolation` nas três tabelas novas.
- `INSERT` em `agents` inclui `password_hash`, sem `SELECT` dessa coluna. `UPDATE` de pessoa cobre nome, papel, autoridade de atividade e membership. E-mail e `tenant_id` continuam sem `UPDATE`.
- `REVOKE UPDATE, DELETE` em `audit_events`. O `INSERT` e o `SELECT` permanecem.

A migration substitui `lookup_agent_by_email` e `lookup_auth_session` sem mudar as colunas de retorno. As duas passam a exigir `membership_status = active`. A de sessão também exige `auth_sessions.auth_epoch = agents.auth_epoch` e continua devolvendo o papel vivo de `agents`. Enquanto ninguém é suspenso e as épocas permanecem 1, o login e o handshake atuais seguem iguais. A unidade 4 grava a época corrente no `INSERT` da sessão no mesmo passo em que passa a incrementá-la.

Comprimentos de nome alinhados ao protocolo: 1–120 em tenant, agente, fila, classificação e site. E-mail até 200.

## Serviços e rotas

Assinaturas. Os corpos lançam `not implemented`. `registerCompanyHttp` também lança, então `buildApp` não monta essas rotas neste desenho.

```ts
class CompanyAdministrationService {
  load(principal: AgentPrincipal): Promise<CompanyDesk>;
  apply(principal: AgentPrincipal, envelope: CompanyCommandEnvelope): Promise<CompanyCommandResult>;
}

class OperationalQualityService {
  report(principal: AgentPrincipal, query: QualityQuery): Promise<QualityReport>;
}

class AuditQueryService {
  page(principal: AgentPrincipal, query: AuditQuery): Promise<AuditPage>;
}

assertCompanyAccess(client: PoolClient, principal: Principal, access: CompanyAccess): Promise<void>;
resolveAcceptance(acceptance, calendar, timeZone, nowIso): EffectiveAcceptance;
reconstructOperationalFacts({ events, agentReplies, window }): OperationalFacts;
policyAt(versions, queueId, at): SlaPolicyVersion | null;
judgeQueueWait(fact, policy): SlaJudgement;
judgeFirstResponse(fact, policy): SlaJudgement;
```

Catálogo HTTP em `companyHttpCatalog`:

| Método | Caminho | Corpo ou query | Resposta |
|---|---|---|---|
| `GET` | `/company/desk` | — | `CompanyDesk` |
| `POST` | `/company/commands` | `CompanyCommandEnvelope` `{ requestId, command }` | `CompanyCommandResult` `{ desk, receipt }` |
| `GET` | `/quality/report` | `scopeKind`, `sectorId?`, `queueId?`, `from`, `to` | `QualityReport` |
| `GET` | `/audit/events` | `from?`, `to?`, `action?`, `cursor?` | `AuditPage` |

Autenticação: o mesmo bearer de `/auth/me`. Ordem na implementação: autenticar, `assertCompanyAccess`, validar com o schema, executar dentro de `withTenant`. Erros de domínio usam `DomainError` e o `setErrorHandler` que já existe. Zod na borda recusa campo desconhecido, inclusive `tenantId`.

`apply` percorre `command.kind` com `default: never`, então um comando novo não compila enquanto não tiver ramo. A implementação troca o `throw` por esse ramo e grava um `audit_events.action` com o mesmo `kind`.

Regras de comando que a implementação precisa cumprir, porque o tipo sozinho não as carrega:

- Transação única: mutação, auditoria e, na suspensão ou troca de papel ou senha, `DELETE` das `auth_sessions` da pessoa. Falha na auditoria desfaz o comando.
- Lock consultivo por tenant na chave `company-admin:${tenantId}` em comando que muda papel ou membership, para dois administradores não se demitirem ao mesmo tempo.
- O ator não se suspende.
- O último administrador `active` não é suspenso nem rebaixado. Erro `invalid_state`, mensagem `A empresa precisa de um administrador ativo`.
- E-mail e `public_id` são únicos no banco inteiro. Conflito responde `409` com `E-mail indisponível` ou `Identificador público indisponível`, sem dizer se o dono é outra empresa.
- `agent.queues_replace` e `agent.activity_authority` exigem placement de agente. Caso contrário, `invalid_state`.
- Publicar SLA: `effectiveFrom >= now()` do banco. A linha anterior é imutável nos limiares e em `effective_from`. Se houver política em aberto, o serviço primeiro grava nela `retired_at = effectiveFrom` da nova e `status = retired`, e só então insere a nova. Os intervalos `[effective_from, retired_at)` se encostam e a `EXCLUDE` recusa sobreposição. Se a anterior já foi aposentada no passado, a próxima pode começar em qualquer instante `>= now()`: o vão é o fim deliberado, não um agendamento furado. Se a anterior ainda cobre o futuro, o começo da nova tem de ser exatamente o `retired_at` dela. Aposentar uma política já vigente usa `retired_at = now()`. Aposentar uma política que ainda não começou usa `retired_at = effective_from`, intervalo vazio. O julgamento usa a política cujo intervalo contém o início do segmento.
- Ativar o site (`acceptance` `accepting`) exige ao menos uma origem. Lista vazia não libera o widget. Esvaziar as origens de um site que está aceitando é `invalid_state`. O trigger `sites_origins_when_accepting` repete essa regra no banco, depois do sync com `accepting_chats`.
- Pesquisa: ao publicar, as outras definições do tenant ficam `active = false` e a nova entra ativa.
- Site novo nasce com os defaults visuais da migration 002 (`#0c7c73`, saudação padrão, sem logo, nome do visitante opcional), pausado, sem origens. O `public_id` não tem comando de troca. O e-mail do agente também não: a troca segura fica para uma fase posterior e, até lá, o `UPDATE` de e-mail continua sem grant.
- Auditoria de `agent.credential_reset` grava o id da pessoa e não grava a senha. O logger do Fastify não passa a serializar o corpo desse POST.
- Página de auditoria: 50 linhas, cursor opaco `(created_at, id)` crescente para trás. Sem `from`/`to`, as últimas 24 horas. Os dois limites vêm juntos e cabem em 31 dias.
- Todo comando administrativo carrega `requestId`. A regra de idempotência está na seção própria. Repetir o mesmo envelope não cria outra linha nem outra auditoria.

Códigos já existentes: `forbidden`, `not_found`, `invalid_payload`, `invalid_state`, `conflict`. Sem código novo.

## Mapa de módulos

Novos, neste desenho:

| Arquivo | Responsabilidade |
|---|---|
| `docs/fase-5/ARQUITETURA.md` | Este desenho |
| `docs/fase-5/migrations/009_company_admin.sql` | Migration proposta, ainda não aplicada |
| `packages/protocol/src/company.ts` | Schemas e tipos do fio |
| `packages/protocol/test/company.test.ts` | O contrato recusa `tenantId`, pausa sem motivo, janela ruim, período longo e envelope sem `requestId`, e aceita `firstResponseCoverage` com duração vazia |
| `apps/server/src/domain/company-access.ts` | `assertCompanyAccess` |
| `apps/server/src/domain/acceptance.ts` | `resolveAcceptance` |
| `apps/server/src/domain/quality-facts.ts` | Fatos, vigência e julgamento |
| `apps/server/src/modules/company-administration.ts` | `load` e `apply` |
| `apps/server/src/modules/operational-quality.ts` | `report` |
| `apps/server/src/modules/audit-query.ts` | `page` |
| `apps/server/src/http/company-routes.ts` | Catálogo das quatro rotas |
| `apps/console/src/admin/company-desk.ts` | As quatro funções do chamador |

`packages/protocol/src/index.ts` só reexporta o módulo novo.

Ainda não se altera, e a unidade que pode alterar está entre parênteses: `app.ts` (10), `auth/sessions.ts`, `realtime/bind.ts` e `realtime/register.ts` (4), `modules/conversations.ts` (5), `console/src/shell/roles.ts` e `ConsoleApp.tsx` (9). O SQL de `lookup_agent_by_email` e `lookup_auth_session` está na migration da unidade 1. `modules/audit.ts` segue como está: os comandos novos chamam `writeAudit`. Widget, atendimentos, chat interno, setores, atividades, painel ao vivo do supervisor e o adaptador do SM permanecem como estão.

## Provisionamento da empresa

Não há painel global e não há papel acima do tenant. O administrador da empresa só alcança linhas do próprio `tenant_id`, por RLS e por `withTenant`. Quem cria a empresa e o primeiro administrador é um procedimento interno, com o mesmo papel que já aplica migrations e seed (`MIGRATE_DATABASE_URL`), fora do processo `webchat_app` e fora de qualquer rota HTTP.

1. Conectar com esse papel, que não é o da aplicação.
2. Inserir `tenants` (`slug`, `name`, `time_zone`).
3. Inserir um `agents` com `role = admin`, `membership_status = active`, `auth_epoch = 1` e `password_hash` argon2id. O hash é produzido fora do SQL, como o seed já faz.
4. Encerrar essa sessão. A partir daí o primeiro administrador cria pessoas, filas e sites pelos comandos da empresa. O papel de migração não fica disponível para o console.

O seed local (`apps/server/src/db/seed.ts` e `infra/seed/seed.sql`) continua sendo o único exemplo no repositório. Não se acrescenta rota, tela nem função `SECURITY DEFINER` de cadastro de tenant para o papel da aplicação.

## Idempotência dos comandos

Todo comando passa por `withCommandReceipt`. O corpo é `CompanyCommandEnvelope`: `requestId` UUID e `command`. O console gera o id ao disparar a ação e reutiliza o mesmo id no retry depois de timeout. A resposta é `CompanyCommandResult`: `{ desk, receipt }`, com `receipt` `{ requestId, replayed, appliedAt }`.

A tabela é `company_command_receipts`. A chave é `(tenant_id, actor_id, request_id)`. Não há coluna de mesa. O retry relê a mesa atual.

Hash: SHA-256 em hexadecimal do JSON canônico do `command` já validado, com chaves ordenadas em todos os níveis, sem o `requestId`. A senha entra no hash e não é gravada. O recibo permanece no Postgres e sobrevive a restart. Não há TTL nesta fase.

Na mesma transação de `withTenant`:

1. `pg_try_advisory_xact_lock` na chave. Se outra transação já segurou o mesmo pedido, `409` com a mensagem `Comando em andamento`.
2. Se o recibo existe com o mesmo hash e `status = applied`, relê a mesa e devolve `replayed: true`. Não grava outra auditoria.
3. Se o recibo existe com outro hash, ou ainda está `in_flight`, `409` com a mensagem `Comando já usado com outro conteúdo` ou `Comando em andamento`. Nada muda.
4. Se não existe, insere `in_flight`, executa o comando, grava `audit_events` uma vez, marca `applied` e devolve a mesa lida nessa transação com `replayed: false`. Falha em qualquer passo desfaz recibo, alteração e auditoria.

## Invalidação imediata no WebSocket

O que já existe:

- O handshake de `/agent` e `/supervisor` chama `authenticateAgent`, que lê `lookup_auth_session` (`apps/server/migrations/001_init.sql`). Essa função já devolve o papel vivo de `agents`, não a cópia em `auth_sessions.role`.
- `logout` apaga a linha da sessão e, em seguida, `routes.ts` chama `disconnectSockets` na sala `session:{sessionId}` dos namespaces `/agent` e `/supervisor`. A sala é `rooms.session` em `apps/server/src/realtime/rooms.ts`.
- Com `REDIS_URL`, `attachRedis` (`apps/server/src/realtime/redis.ts`) instala o adapter do Socket.IO. O `disconnectSockets` numa sala atravessa as instâncias. Sem Redis, esse caminho só alcança o processo local.
- `joinSessionRoom` (`apps/server/src/realtime/bind.ts`) consulta `isSessionActive` uma vez, guarda a promise em `socket.data.sessionValidation` e desconecta se a linha não existe. `bindSocket` espera essa mesma promise em cada evento. Não consulta o banco de novo. Quem foi revogado depois do connect continua no socket até o disconnect ou o timer de `expiresAt`.
- `isSessionActive` só olha existência e `expires_at`. Não olha membership nem época.
- As rooms de dados (`joinOwnRooms`) só são entrados depois dessa validação inicial.

O que a Fase 5 acrescenta, sem outbox. A revogação é híbrida:

- `auth_epoch` na pessoa e na sessão. Suspender, trocar papel, trocar filas, trocar autoridade de atividade, resetar senha ou revogar sessões incrementa `agents.auth_epoch` e apaga as `auth_sessions` da pessoa na mesma transação do comando e da auditoria.
- O `DELETE` dispara `NOTIFY webchat_session_revoke`. Cada processo escuta o canal num cliente Postgres dedicado e chama `disconnectSockets` local. Esse é o caminho quando não há Redis.
- Depois do commit, `revokeRealtimeSessions({ sessionIds, agentId })` chama `disconnectSockets` nas salas `session:{id}` de `/agent` e `/supervisor`. Com Redis, o adapter leva o disconnect às outras réplicas.
- `REPLICAS` maior que 1 sem `REDIS_URL` faz o boot falhar. Uma instância pode subir sem Redis e depender do `NOTIFY` e da varredura.
- Antes de cada comando WebSocket, e a cada varredura periódica, o servidor relê `auth_epoch`, a sessão e o papel. Se divergir, desconecta e não entra em room de dados. A promise cacheada no connect deixa de ser a autorização.
- `lookup_auth_session` e `lookup_agent_by_email` recusam membership suspensa. A de sessão também recusa época diferente.
- Reativar não restaura sessão. A sessão nova copia a `auth_epoch` corrente.

Widget, visitante e o adaptador do SM não participam desse caminho.

## Permissões

| Capacidade | Visitante | Agente | Supervisor | Admin |
|---|---|---|---|---|
| `company.desk` e qualquer `company.command` | negado | negado | negado | permitido |
| `quality.report` com escopo `tenant` | negado | negado | negado | permitido |
| `quality.report` de setor ou fila que ele supervisiona | negado | negado | permitido | permitido |
| `quality.report` fora dos setores dele | negado | negado | negado | permitido |
| `audit.read` | negado | negado | negado | permitido |

A matriz vale no backend, em `assertCompanyAccess`, dentro da transação. Esconder uma seção no console não autoriza a rota. Papel errado é `forbidden`. O administrador configura, audita e mede a empresa inteira. O supervisor só mede setores e filas em que é responsável. Agente não chega à mesa, ao comando nem à auditoria. Visitante não chega a nenhum dos quatro caminhos. Identificador de outro tenant não aparece por causa do RLS e responde `not_found`. O supervisor usa a mesma relação já usada em `assertSupervisorQueueAccess`: `sector_supervisors` ativo, setor `active`, `sector_queues`. Fila sem setor não entra no escopo do supervisor.

Suspensão é da pessoa dentro da empresa. Não existe suspensão da empresa.

## Isolamento

- O tenant sai da sessão. Payload com `tenantId` falha no schema `.strict()`.
- Toda leitura e escrita de negócio passa por `withTenant`.
- Tabelas novas têm RLS forçada.
- Triggers `enforce_*` recusam site, fila, autor ou política de outro tenant, no mesmo estilo da Fase 4.
- E-mail e `public_id` únicos globalmente. O `INSERT` encosta na constraint e o serviço traduz `23505` (`isUniqueViolation`) em `conflict`, com mensagem que não cita a outra empresa. O detalhe do Postgres não é repassado ao cliente. Não se abre `SELECT` de `agents` fora do tenant.
- `password_hash` continua sem `SELECT` para `webchat_app`. O `INSERT` lista colunas e o `RETURNING` devolve só o `id`.
- Auditoria exige ator do mesmo tenant pelo trigger `enforce_audit_actor`, que já existe.
- O relatório filtra `tenant_id` e, para supervisor, as filas do escopo. Presença e pesquisa seguem o mesmo recorte.
- Não há papel de plataforma. Um administrador do tenant A não lista o tenant B.

## Qualidade operacional

Qualidade, neste produto, é o que dá para medir com as linhas que o atendimento já confirma no `COMMIT`. Não é log de infraestrutura, não é o painel ao vivo e não é uma nota guardada à parte.

Janela inclusiva no início e exclusiva no fim, no máximo 31 dias, `from < to`.

Espera na fila. A coluna `conversations.queued_at` é reescrita em devolução e transferência, então o histórico sai de `conversation_events`, em ordem `(created_at, id)`:

- `queued` abre um segmento na `queueId` do payload.
- `released` abre outro segmento na fila herdada do segmento anterior.
- `transferred` abre um segmento na `toQueueId`.
- `assigned` fecha o segmento aberto como `completed`, com duração até o `created_at` do evento.
- `left` fecha o segmento aberto como `abandoned`.
- Segmento ainda aberto no `to` da janela é `open`.
- Segmento cujo `queueId` não pode ser herdado é `unreadable` com motivo `missing_queue`. Não se inventa fila.

Só entram na duração da espera, e no SLA de espera, os `completed` cujo `assignedAt` cai na janela. `abandoned` incrementa `queueWaits.abandoned` e o SLA dessa amostra é `not_applicable` / `abandoned`. Espera longa que termina em saída não é violação. `open` incrementa `queueWaits.open` e é `not_applicable` / `still_open`. `unreadable` incrementa `queueWaits.unreadable` e é `not_applicable` / `unreadable`. Os quatro números saem no relatório mesmo quando não viram violação.

Primeira resposta. Para cada `assigned`, a resposta é a primeira `messages` com `sender_type = 'agent'`, `sender_id` igual ao agente do evento, `created_at` maior ou igual ao assign e menor que o próximo `released`, `transferred` ou `classified`. Duração desde o assign. O próximo evento decide o fato:

- mensagem do agente: `answered`. Entra na duração (total, média, p50, p90) e em `firstResponseCoverage.answered`. Com política, `within` ou `breached` medido.
- `classified` sem mensagem: `unansweredClosed`. Não entra na duração. Com política aplicável no início do segmento, o juízo é `breached` sem resposta. Sem política, `not_applicable` / `no_policy`, e o contador `unansweredClosed` mesmo assim sobe.
- `released` ou `transferred` sem mensagem: não entra em `unansweredClosed` nem em `breached`. Fica fora da cobertura até um campo próprio.
- segmento ainda aberto no fim da janela: `stillOpen`. Não vira violação definitiva.

Amostra da duração: só `answered` cujo assign cai na janela.

Tempo de trato. Do `assigned` até o próximo `released`, `transferred` ou `classified`. Só o segmento fechado entra no percentil. `classified` também incrementa `completions.classified` quando o evento cai na janela. A classificação continua sendo o fim operacional, como em `docs/decisions.md`. A pesquisa vem depois e não entra no tempo de trato.

Pesquisa. `survey_responses` com `created_at` na janela e conversa no escopo. `responses`, `averageScore` nulo quando não há resposta, comentários `none` ou `{ kind: 'some', count }`.

Presença. Soma, em segundos, da interseção de `presence_intervals` com a janela, só de pessoas com papel `agent` no escopo. Os quatro estados do intervalo viram quatro contadores.

SLA. `policyAt` escolhe a versão da fila com `effective_from <= início do segmento` e (`retired_at` nulo ou início `< retired_at`). Políticas antigas não são reescritas, então o mesmo segmento não muda de política numa leitura posterior. Sem versão: `not_applicable` / `no_policy`. Espera concluída compara a duração com `queue_wait`: `within` ou `breached` / `measured`. Abandono, espera aberta e evento ilegível não são violação de espera. Primeira resposta usa o relógio `first_response` e as regras do parágrafo anterior.

Duração. Total é a soma dos segundos das amostras. Média é o total dividido por `samples`. Percentis: ordenar as durações inteiras e tomar o índice `ceil(0.5 * n) - 1` e `ceil(0.9 * n) - 1`. Empate não interpola. Sem amostra, total, média e percentis são nulos.

Calendário. `weekday` e os minutos são o relógio local de `tenants.time_zone`. A comparação converte o instante UTC com a base IANA do fuso (`timezone(time_zone, instante)` no Postgres ou o equivalente em `Intl`), para o offset daquele instante, inclusive horário de verão. Não se grava hora local.

O que isso não é: `supervisor.metrics` (contagens do instante, já entregues na Fase 4), log do processo, trilha de acesso HTTP, e entrega de evento em tempo real. Uma falha depois do commit pode esconder um evento no socket e mesmo assim o relatório vê a linha, porque ele lê as tabelas.

## Plano de implementação

A unidade 1 aplica o schema. Da unidade 2 em diante, cada uma substitui `throw new Error('not implemented')` no ponto citado. A anterior permanece verde. Não se começa a unidade seguinte com teste vermelho. Comando dos testes de contrato: `pnpm --filter @viavoip/protocol test`. Comando de um teste de servidor, depois que o arquivo existir: `pnpm --filter @viavoip/server exec vitest run test/<arquivo>.test.ts`.

O Ciclo A é 1, depois 2, depois 3, depois 4. As unidades 5–10 só começam com o Ciclo A verde. Dependências: 2 usa o schema da 1; 3 usa a mesa e a matriz da 2 e o recibo da 1; 4 usa o recibo da 3 e as colunas de época e membership da 1; 5 usa calendário e aceitação da 1 e os comandos de site da 3; 6 usa filas da 3 e a `EXCLUDE` da 1; 7 usa o juízo e as políticas da 6; 8 lê a auditoria gravada na 3 e na 4; 9 só navega o que 2–8 já expõem no contrato; 10 monta as rotas quando os serviços das unidades anteriores existem. Nenhuma unidade chama o SM.

1. **Aplicar a migration.** Mover o SQL para `apps/server/migrations/009_company_admin.sql`. Critério: banco vazio e banco já migrado até a 008 aplicam o arquivo uma vez; a segunda subida não reaplica; `sla_policies`, `sla_policy_clocks`, `site_service_windows` e `company_command_receipts` têm RLS forçada; `webchat_app` não faz `SELECT password_hash` nem `UPDATE` de `audit_events`; o recibo não tem coluna de mesa; site com `accepting_chats = false` fica `acceptance = paused`; site `accepting` sem origem é recusado pelo trigger; há no máximo uma pesquisa ativa por tenant; duas políticas da mesma fila com intervalos sobrepostos não commitam; `effective_from` no passado não commita. A suíte atual continua passando, inclusive o teste que grava `accepting_chats` direto em site que já tem origem. Login e handshake do seed continuam válidos.

2. **Ler a mesa e a matriz de acesso.** Implementar `CompanyAdministrationService.load` e `assertCompanyAccess` por inteiro. Critério: o administrador do tenant A recebe a mesa equivalente ao seed; agente, supervisor e visitante recebem `forbidden` na mesa, no comando e na auditoria; o supervisor passa na qualidade da própria fila e recebe `forbidden` na fila do outro setor e no escopo `tenant`; nada do tenant B aparece. Arquivo: `apps/server/test/company-desk.test.ts`.

3. **Comandos de configuração, com idempotência.** Perfil, aparência, aceitação, origens, filas, classificações, pesquisa e `site.create`. Cada execução nova grava auditoria e recibo na mesma transação. Critério: um caso por comando; site novo nasce pausado e sem origens; aceitar com origem vazia é `invalid_state`; o tenant B permanece igual; corpo com `tenantId` é `invalid_payload`; supervisor recebe `forbidden`; o mesmo `requestId` e o mesmo payload devolve `replayed: true` com a mesa relida e não duplica fila, pesquisa nem auditoria; o mesmo `requestId` com outro payload é `conflict`; pedido igual ainda em andamento é `conflict`; derrubar a auditoria desfaz mutação e recibo. Arquivo: `apps/server/test/company-commands.test.ts`.

4. **Pessoas, sessão e socket.** Comandos `agent.*`, conflito de e-mail, época no `INSERT` da sessão, checagem fresca em `bindSocket` e no join, e disconnect das salas `session:{id}` nos dois namespaces. Critério: suspenso não autentica e a mensagem continua `Credenciais inválidas`; o handshake seguinte também falha; o ator não se suspende; o último administrador ativo não é rebaixado; e-mail do tenant B é `conflict` sem devolver o id de lá; não há comando de troca de e-mail; `password_hash` segue ilegível; o mesmo `requestId` de `agent.create` não cria a segunda pessoa nem a segunda auditoria; reset, suspensão, troca de papel, troca de filas e troca da autoridade de atividade apagam as sessões, incrementam `auth_epoch` e desconectam os sockets da pessoa; com duas instâncias e Redis, o socket na outra instância cai; um evento posterior na conexão que não recebeu o disconnect é `unauthorized` e derruba o socket; widget, chat interno e o painel do supervisor dos outros agentes seguem. Arquivos: `apps/server/test/company-agents.test.ts` e um caso ao lado de `apps/server/test/redis-replicas.test.ts`.

5. **Calendário e aceitação efetiva.** Implementar `resolveAcceptance` e usá-lo em `conversations.start`. Critério: o exemplo de quarta-feira em `America/Sao_Paulo` recusa a abertura; segunda 10:00 no mesmo fuso aceita; pausa manual recusa mesmo dentro da janela; site sem janelas e com origens continua aceitando; um instante antes e outro depois da transição de horário de verão em `America/New_York` usam o offset daquele instante, não um deslocamento fixo; `apps/server/test/phase2.test.ts` passa. O widget público não ganha rota nova.

6. **SLA.** Implementar `sla.publish` e `sla.retire`. Critério: publicação com `effectiveFrom` anterior a `now()` é `invalid_state`; a segunda publicação futura aposenta a primeira exatamente nesse instante e a `EXCLUDE` aceita o par; um terceiro começo que deixe vão futuro é recusado; `UPDATE` de `threshold_seconds` pelo papel da aplicação falha; fila de outro tenant é `not_found`; política sem os dois relógios não commita; o mesmo `requestId` não publica duas políticas. O segmento de teste é julgado pela política vigente no início, não pela publicada depois.

7. **Relatório.** Implementar `reconstructOperationalFacts`, `policyAt`, os dois juízos e `OperationalQualityService.report`. Critério: `queued → assigned → mensagem do agente → classified` produz total, média, p50 e p90 de espera, primeira resposta e atendimento, e SLA `within`; limiar menor produz `breached` / `measured`; `classified` sem mensagem produz `firstResponseCoverage.unansweredClosed = 1`, duração com `samples = 0` e `breached` quando há política; `released` ou `transferred` sem mensagem não entra em `unansweredClosed` nem em `breached`; segmento aberto não incrementa `breached`; `left` incrementa `abandoned` e não incrementa `breached`; `released` seguido de novo `assigned` usa os eventos e ignora `queued_at`; supervisor vê só a fila do próprio setor; agente recebe `forbidden`; janela de 32 dias é `invalid_payload`; o tenant B não entra na conta. Sem endpoint de amostra por conversa.

8. **Leitura da auditoria.** Implementar `AuditQueryService.page`. Critério: o administrador pagina os eventos dos comandos novos; um retry idempotente não aparece duas vezes; supervisor e agente recebem `forbidden`; ação legada desconhecida sai como `unrecognized`; o corpo não contém senha; cursor não repete nem pula a linha da fronteira.

9. **Console.** Acrescentar a seção Administração ao administrador e a seção Qualidade ao administrador e ao supervisor, em `roles.ts`, e implementar as quatro funções do chamador, com `requestId` estável no retry. Critério: `sectionsFor('agent')` não ganha essas seções; a tela não libera o que o backend nega; `pnpm --filter @viavoip/console test` e o `tsc` do console passam. A navegação nova não reimplementa setor, anúncio, atividade nem o painel ao vivo.

10. **Montar as rotas.** Trocar o `throw` de `registerCompanyHttp` por `app.get` / `app.post` usando `companyHttpCatalog`, passar `io` para o disconnect já testado na unidade 4, e chamar o registro em `buildApp`. Critério: teste HTTP com o token de login cobre mesa, comando, relatório e auditoria; pedido sem token é `unauthorized`; a suíte `pnpm test` passa; nenhuma chamada ao SM foi adicionada.

A suspensão só fica alcançável por HTTP na unidade 10, e nessa altura a unidade 4 já recusa o login, o handshake e o evento. O Ciclo A prova isso no serviço e no socket antes da rota existir.

## Fora deste desenho

Operador de plataforma, convite por e-mail, SSO, troca de senha pelo próprio usuário, troca de e-mail, apagar fila ou site, política de histórico interno diferente de `retain_until_removed`, drill-down, meta de ocupação, rollup, outbox, qualquer chamada ou contrato do SM, e tela de log do processo.

## Decisões fechadas

O Luan fechou o que segue. A limitação explícita é a troca de e-mail, que esta fase não faz.

- Sem operador global. O primeiro administrador nasce pelo procedimento de provisionamento.
- Permissões só no backend, na matriz desta página.
- Abandono é indicador, não violação de SLA. O relatório também conta esperas concluídas, esperas abertas e eventos ilegíveis.
- Fuso IANA por empresa, padrão `America/Sao_Paulo`. Instante absoluto em UTC. Calendário no fuso, com horário de verão.
- `public_id` imutável. E-mail imutável nesta fase. Site novo nasce pausado e só aceita atendimento com origens explícitas. Lista vazia não é acesso livre.
- Comandos administrativos são idempotentes por `requestId` em `company_command_receipts`, com hash e lock. O retry relê a mesa e marca `replayed: true`. Não há snapshot.
- Revogação híbrida: `disconnectSockets` pelo Redis depois do commit, `NOTIFY` como reserva, revalidação de `auth_epoch` em cada comando e na varredura. Mais de uma réplica exige Redis no boot.
- Relatório agregado até 31 dias, com total, média, p50 e p90 de espera, primeira resposta e atendimento.
- Outbox continua adiado. Suspensão, permissão e revogação derrubam o socket na hora, com época no banco, checagem no handshake e em cada evento ou join, e `disconnectSockets` pelo adapter Redis já existente.
- SLA sem efeito retroativo, política anterior imutável, julgamento no início do segmento, vigências futuras sem vão e sem sobreposição.
- Percentis de primeira resposta só com quem respondeu. `firstResponseCoverage` conta `answered`, `unansweredClosed`, `stillOpen` e `unreadable`. Encerrado sem resposta é `breached` quando há política. A implementação desse cálculo é a unidade 7.
