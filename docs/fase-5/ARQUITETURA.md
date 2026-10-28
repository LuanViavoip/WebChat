# Fase 5 — Gestão administrativa, configurações por empresa e qualidade operacional

Desenho. Nada neste documento está ligado ao processo que atende o widget. Os serviços, as rotas e o cálculo de qualidade lançam `throw new Error('not implemented')`. A migration proposta está em [migrations/009_company_admin.sql](migrations/009_company_admin.sql) e fica fora de `apps/server/migrations/` até a unidade 1 do plano.

## Escopo

Não há especificação anterior da Fase 5 no repositório. O nome da fase e o que a Fase 4 deixou pronto definem o corte abaixo. As escolhas que o Luan pode inverter estão no final, já decididas aqui para o desenho não ficar aberto.

Entra:

- Cadastro da empresa feito pelo administrador do próprio tenant: pessoas, filas, classificações, pesquisa, sites do widget, limite de atendimentos, fuso e política de SLA.
- Leitura de qualidade operacional sobre fatos que o atendimento já grava.
- Leitura da auditoria que a Fase 4 já escreve em `audit_events`, mais os comandos novos.

Fica de fora: operador acima do tenant, IdP, outbox da F4-07, rollup materializado, retenção, contrato real do SM, e qualquer mudança de chat interno, setores, anúncios ou atividades além de continuar auditando o que esses módulos já gravam.

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

O administrador abre a mesa com `loadCompanyDesk`. A resposta é um `CompanyDesk`: perfil, sites, filas, classificações, pesquisa, pessoas e políticas de SLA. Para mudar alguma coisa ele envia um único `CompanyCommand` e recebe a mesa inteira de novo. O console substitui o estado local por essa resposta. Não há mesclagem no cliente e não há evento Socket.IO novo: o comando já devolve o resultado depois do commit.

A supervisora não chama a mesa nem a auditoria. Ela chama `loadQualityReport` com escopo de setor ou de fila. O administrador pode pedir o tenant inteiro. O agente e o visitante não recebem essas seções.

O widget não fala com essas rotas. Ele continua em `GET /public/widgets/:publicId`. Quando a unidade 5 ligar `resolveAcceptance`, a abertura de conversa passa a usar a aceitação efetiva. Até lá, `sites.accepting_chats` segue sendo o que o atendimento lê hoje.

Exemplo, o administrador publica o SLA da fila Suporte e em seguida lê o relatório dos últimos sete dias:

```ts
await applyCompanyCommand(session, {
  kind: 'sla.publish',
  queueId: suporte,
  effectiveFrom: '2026-10-28T12:00:00.000Z',
  queueWaitThresholdSeconds: 120,
  firstResponseThresholdSeconds: 60,
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
| `site.create` | Site com aparência padrão da migration 002, aceitação `accepting`, calendário `always_open`, origens vazias. `public_id` imutável. |
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

Qualidade (`QualityReport`): escopo, janela, três resumos de duração (`queueWait`, `firstResponse`, `handleTime`) com `samples` e percentis nulos quando `samples = 0`, conclusões (`classified`, `leftWhileQueued`, `stillOpen`, `unreadable`), pesquisa, dois tallys de SLA (`within`, `breached`, `notApplicable`) e segundos de presença por estado `available | busy | away | offline`.

Auditoria (`AuditEntry`): ator, instante, ação discriminada e recurso `{ presence: 'none', type }` ou `{ presence: 'id', type, id }`. Ação desconhecida na base vira `{ kind: 'unrecognized', raw }`. A página devolve no máximo 100 linhas e `nextCursor`.

Fatos internos, usados só pelo cálculo:

- `QueueWaitFact`: `completed | abandoned | open | unreadable`.
- `FirstResponseFact`: `answered | unanswered | unreadable`.
- `HandleTimeFact`: `closed_segment | still_open | unreadable`.
- `SlaJudgement`: `within | breached | not_applicable`, e o ramo não aplicável diz `no_policy | still_open | abandoned | unanswered | unreadable`.

## Migrations propostas

O arquivo executável é [migrations/009_company_admin.sql](migrations/009_company_admin.sql). Resumo do que ele faz:

- `tenants.time_zone`, default `America/Sao_Paulo`, com trigger que rejeita nome que o PostgreSQL não reconhece.
- `agents.membership_status`, `suspended_at`, `suspension_reason`, com `CHECK` que amarra status e colunas.
- `sites.acceptance` e `sites.pause_reason`, preenchidos a partir de `accepting_chats`. O trigger `sync_site_acceptance` mantém os dois lados: quem grava `acceptance` atualiza o booleano; quem ainda grava `accepting_chats` (o teste da Fase 2 faz isso) atualiza `acceptance`. Pausa sem motivo recebe `Suspenso fora do cadastro`.
- `dispositions.status` e `retired_at`.
- `site_service_windows`, com sobreposição recusada pelo trigger.
- `sla_policies` e `sla_policy_clocks`. Um índice único parcial garante uma política `active` por fila. Um constraint trigger adiado exige os dois relógios. `webchat_app` pode atualizar só `status` e `retired_at` da política e não pode atualizar o relógio.
- Uma pesquisa `active` por tenant. Se houver mais de uma, a mais antiga permanece, que é a que `loadActiveSurvey` já escolhe, e as outras passam a `active = false`.
- Índices de leitura: `conversation_events` por conversa e por tenant/tempo, `survey_responses` por tenant/tempo, `audit_events` por tenant/ação/tempo.
- RLS forçada e política `tenant_isolation` nas três tabelas novas.
- `INSERT` em `agents` inclui `password_hash`, sem `SELECT` dessa coluna. `UPDATE` de pessoa cobre nome, papel, autoridade de atividade e membership. E-mail e `tenant_id` continuam sem `UPDATE`.
- `REVOKE UPDATE, DELETE` em `audit_events`. O `INSERT` e o `SELECT` permanecem.

A migration não altera `lookup_agent_by_email`. Por isso, sozinha, ela não muda o login. A unidade 4 altera a função e o login junto com a suspensão, antes de a rota HTTP existir.

Comprimentos de nome alinhados ao protocolo: 1–120 em tenant, agente, fila, classificação e site. E-mail até 200.

## Serviços e rotas

Assinaturas. Os corpos lançam `not implemented`. `registerCompanyHttp` também lança, então `buildApp` não monta essas rotas neste desenho.

```ts
class CompanyAdministrationService {
  load(principal: AgentPrincipal): Promise<CompanyDesk>;
  apply(principal: AgentPrincipal, command: CompanyCommand): Promise<CompanyDesk>;
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
| `POST` | `/company/commands` | `CompanyCommand` | `CompanyDesk` |
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
- Publicar SLA: a política `active` anterior da fila passa a `retired` com `retired_at = effectiveFrom` da nova, e `effectiveFrom` novo é maior ou igual ao anterior. A cobertura é o intervalo `[effective_from, retired_at)`. O status `active` marca a cabeça editável; o julgamento usa o intervalo, não o status. Aposentar sem substituta usa `retired_at = now()`.
- Pesquisa: ao publicar, as outras definições do tenant ficam `active = false` e a nova entra ativa.
- Site novo nasce com os defaults da migration 002 (`#0c7c73`, saudação padrão, sem logo, nome do visitante opcional).
- Auditoria de `agent.credential_reset` grava o id da pessoa e não grava a senha. O logger do Fastify não passa a serializar o corpo desse POST.
- Página de auditoria: 50 linhas, cursor opaco `(created_at, id)` crescente para trás. Sem `from`/`to`, as últimas 24 horas. Os dois limites vêm juntos e cabem em 31 dias.
- Comandos de criação não têm chave de idempotência. Repetir `agent.create` tenta criar de novo.

Códigos já existentes: `forbidden`, `not_found`, `invalid_payload`, `invalid_state`, `conflict`. Sem código novo.

## Mapa de módulos

Novos, neste desenho:

| Arquivo | Responsabilidade |
|---|---|
| `docs/fase-5/ARQUITETURA.md` | Este desenho |
| `docs/fase-5/migrations/009_company_admin.sql` | Migration proposta, ainda não aplicada |
| `packages/protocol/src/company.ts` | Schemas e tipos do fio |
| `packages/protocol/test/company.test.ts` | O contrato recusa `tenantId`, pausa sem motivo, janela ruim e período longo |
| `apps/server/src/domain/company-access.ts` | `assertCompanyAccess` |
| `apps/server/src/domain/acceptance.ts` | `resolveAcceptance` |
| `apps/server/src/domain/quality-facts.ts` | Fatos, vigência e julgamento |
| `apps/server/src/modules/company-administration.ts` | `load` e `apply` |
| `apps/server/src/modules/operational-quality.ts` | `report` |
| `apps/server/src/modules/audit-query.ts` | `page` |
| `apps/server/src/http/company-routes.ts` | Catálogo das quatro rotas |
| `apps/console/src/admin/company-desk.ts` | As quatro funções do chamador |

`packages/protocol/src/index.ts` só reexporta o módulo novo.

Ainda não se altera, e a unidade que pode alterar está entre parênteses: `app.ts` (10), `auth/sessions.ts` e `lookup_agent_by_email` (4), `modules/conversations.ts` (5), `console/src/shell/roles.ts` e `ConsoleApp.tsx` (9), `modules/audit.ts` (os comandos novos chamam `writeAudit` como os módulos atuais). Setores, anúncios, atividades, chat interno e o snapshot do supervisor permanecem como estão.

## Permissões

| Capacidade | Visitante | Agente | Supervisor | Admin |
|---|---|---|---|---|
| `company.desk` e qualquer `company.command` | negado | negado | negado | permitido |
| `quality.report` com escopo `tenant` | negado | negado | negado | permitido |
| `quality.report` de setor ou fila que ele supervisiona | negado | negado | permitido | permitido |
| `quality.report` fora dos setores dele | negado | negado | negado | permitido |
| `audit.read` | negado | negado | negado | permitido |

`assertCompanyAccess` roda dentro da transação e recebe o `PoolClient`, porque o recorte do supervisor é uma consulta. Papel errado é `forbidden`. Identificador de outro tenant não aparece por causa do RLS e responde `not_found`, como o restante do sistema. O administrador não fica limitado por setor. O supervisor usa a mesma relação já usada em `assertSupervisorQueueAccess`: `sector_supervisors` ativo, setor `active`, `sector_queues`. Fila sem setor não entra no escopo do supervisor.

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

Só entram no percentil de espera, e no SLA de espera, os `completed` cujo `assignedAt` cai na janela. `abandoned` incrementa `leftWhileQueued` e o SLA dessa amostra é `not_applicable` / `abandoned`. Espera longa que termina em saída não é violação. `open` incrementa `stillOpen` e é `not_applicable` / `still_open`. `unreadable` incrementa `unreadable` e é `not_applicable` / `unreadable`.

Primeira resposta. Para cada `assigned`, a resposta é a primeira `messages` com `sender_type = 'agent'`, `sender_id` igual ao agente do evento, `created_at` maior ou igual ao assign e menor que o próximo `released`, `transferred` ou `classified`. Duração desde o assign. Sem mensagem e com o segmento já fechado: `unanswered` / `segment_ended`, SLA `not_applicable` / `unanswered`. Segmento ainda aberto: `still_open`. Amostra do percentil: só `answered` com o assign na janela.

Tempo de trato. Do `assigned` até o próximo `released`, `transferred` ou `classified`. Só o segmento fechado entra no percentil. `classified` também incrementa `completions.classified` quando o evento cai na janela. A classificação continua sendo o fim operacional, como em `docs/decisions.md`. A pesquisa vem depois e não entra no tempo de trato.

Pesquisa. `survey_responses` com `created_at` na janela e conversa no escopo. `responses`, `averageScore` nulo quando não há resposta, comentários `none` ou `{ kind: 'some', count }`.

Presença. Soma, em segundos, da interseção de `presence_intervals` com a janela, só de pessoas com papel `agent` no escopo. Os quatro estados do intervalo viram quatro contadores.

SLA. `policyAt` escolhe a versão da fila com `effective_from <= instante` e (`retired_at` nulo ou `instante < retired_at`). Se houver mais de uma, vale a de `effective_from` maior. Sem versão: `not_applicable` / `no_policy`. Com versão, `elapsedSeconds <= thresholdSeconds` é `within`; acima é `breached`. O limiar de espera usa o relógio `queue_wait`. O de primeira resposta usa `first_response`. O instante de escolha da política é o início do segmento.

Percentis: ordenar as durações inteiras em segundos e tomar o índice `ceil(0.5 * n) - 1` e `ceil(0.9 * n) - 1`. Empate não interpola.

O que isso não é: `supervisor.metrics` (contagens do instante, já entregues na Fase 4), log do processo, trilha de acesso HTTP, e entrega de evento em tempo real. Uma falha depois do commit pode esconder um evento no socket e mesmo assim o relatório vê a linha, porque ele lê as tabelas.

## Plano de implementação

A unidade 1 aplica o schema. Da unidade 2 em diante, cada uma substitui `throw new Error('not implemented')` no ponto citado e deixa o sistema verificável sozinha. A anterior permanece verde. Comando dos testes de contrato: `pnpm --filter @viavoip/protocol test`. Comando de um teste de servidor, depois que o arquivo existir: `pnpm --filter @viavoip/server exec vitest run test/<arquivo>.test.ts`.

1. **Aplicar a migration.** Mover o SQL para `apps/server/migrations/009_company_admin.sql`. Critério: banco vazio e banco já migrado até a 008 aplicam o arquivo uma vez; a segunda subida não reaplica; `sla_policies`, `sla_policy_clocks` e `site_service_windows` têm RLS forçada; `webchat_app` não faz `SELECT password_hash` nem `UPDATE` de `audit_events`; site com `accepting_chats = false` fica `acceptance = paused`; há no máximo uma pesquisa ativa por tenant. A suíte atual continua passando, inclusive o teste que grava `accepting_chats` direto.

2. **Ler a mesa e a matriz de acesso.** Implementar `CompanyAdministrationService.load` e `assertCompanyAccess` por inteiro, inclusive o recorte de setor do supervisor na qualidade. Critério: o administrador do tenant A recebe a mesa equivalente ao seed; agente, supervisor e visitante recebem `forbidden` na mesa, no comando e na auditoria; o supervisor passa na qualidade da própria fila e recebe `forbidden` na fila do outro setor; nada do tenant B aparece. Arquivo sugerido: `apps/server/test/company-desk.test.ts`.

3. **Comandos sobre colunas que já existem.** Perfil, aparência, aceitação, origens, filas, classificações e pesquisa. Cada um grava auditoria na mesma transação. Critério: um caso por comando; o tenant B permanece igual; corpo com `tenantId` é `invalid_payload`; supervisor recebe `forbidden`; derrubar a auditoria desfaz a mudança.

4. **Pessoas, senha e login.** Implementar os comandos `agent.*`, traduzir violação única de e-mail em `conflict` e recusar o login de membership suspensa, alterando `lookup_agent_by_email` e `sessions.ts` juntos. Critério: suspenso não autentica e a mensagem continua `Credenciais inválidas`; o ator não se suspende; o último administrador ativo não é rebaixado; e-mail do tenant B é `conflict` sem devolver o id de lá; `password_hash` segue ilegível; reset apaga a sessão anterior.

5. **Calendário e aceitação efetiva.** Implementar `resolveAcceptance` e usá-lo em `conversations.start`, no lugar da leitura solta de `accepting_chats`. Critério: o exemplo de quarta-feira em `America/Sao_Paulo` recusa a abertura; segunda 10:00 no mesmo fuso aceita; pausa manual recusa mesmo dentro da janela; site sem janelas continua aceitando; `apps/server/test/phase2.test.ts` passa.

6. **SLA.** Implementar `sla.publish` e `sla.retire`. Critério: a segunda publicação aposenta a primeira com `retired_at` igual ao `effectiveFrom` novo; `UPDATE` de `threshold_seconds` pelo papel da aplicação falha; fila de outro tenant é `not_found`; política sem os dois relógios não commita.

7. **Relatório.** Implementar `reconstructOperationalFacts`, `policyAt`, os dois juízos e `OperationalQualityService.report`. Critério: um fixture com `queued → assigned → mensagem do agente → classified` produz espera, primeira resposta, trato e SLA `within` conhecidos; o mesmo fluxo com limiar menor produz `breached`; `released` seguido de novo `assigned` usa os eventos e ignora `queued_at`; `left` incrementa abandono e não incrementa `breached`; supervisor vê só a fila do próprio setor; agente recebe `forbidden`; janela de 32 dias é `invalid_payload`; o tenant B não entra na conta.

8. **Leitura da auditoria.** Implementar `AuditQueryService.page`. Critério: o administrador pagina os eventos dos comandos novos; supervisor recebe `forbidden`; ação legada desconhecida sai como `unrecognized`; o corpo não contém senha; cursor não repete nem pula a linha da fronteira.

9. **Console.** Acrescentar a seção Administração ao administrador e a seção Qualidade ao administrador e ao supervisor, em `roles.ts`, e implementar as quatro funções do chamador. Critério: `sectionsFor('agent')` não ganha essas seções; `pnpm --filter @viavoip/console test` e o `tsc` do console passam. A navegação nova só chama as funções; não duplica setor, anúncio ou atividade.

10. **Montar as rotas.** Trocar o `throw` de `registerCompanyHttp` por `app.get` / `app.post` usando `companyHttpCatalog`, e chamar o registro em `buildApp`. Critério: teste HTTP com o token de login cobre mesa, comando, relatório e auditoria; pedido sem token é `unauthorized`; a suíte `pnpm test` passa.

A unidade 4 antecede qualquer caminho em que a suspensão seja alcançável pelo HTTP. A unidade 10 é a primeira que expõe as rotas.

## Fora deste desenho

Operador de plataforma, convite por e-mail, SSO, troca de senha pelo próprio usuário, apagar fila ou site, política de histórico interno diferente de `retain_until_removed`, drill-down conversa a conversa, meta de ocupação, rollup, outbox, alteração do adaptador do SM, e tela de log do processo.

## Decisões já tomadas

Estas decisões fecham o desenho. Se o Luan escolher o outro lado, o contrato muda no ponto indicado.

| Decisão neste desenho | O que mudaria |
|---|---|
| Não há papel acima do tenant | Um principal novo e um caminho sem RLS de uma empresa só |
| Auditoria é só do administrador | `audit.read` para o supervisor, filtrado pelo setor |
| Abandono não é violação de SLA | `judgeQueueWait` passaria a devolver `breached` quando a espera abandonada supera o limiar |
| Fuso é um só por empresa, default `America/Sao_Paulo` | Coluna de fuso em `sites` e `resolveAcceptance` leria o fuso do site |
| E-mail e `public_id` são imutáveis | Comandos de troca e a revogação das sessões no caso do e-mail |
| O administrador cria site | `site.create` sai do catálogo e o site continua nascendo só no seed |
| Sem chave de idempotência | Um `requestId` no comando, no estilo das mensagens |
| Relatório só com agregados, janela de 31 dias | Um endpoint de amostras e, se a janela crescer, o rollup que este desenho evitou |
| A Fase 5 não trata a entrega pós-commit | A F4-07 continua pendência própria; o relatório não depende dela |
| Sessão de qualidade e de auditoria não empurra socket | Um evento `quality.ready` se a tela precisar atualizar sozinha |
