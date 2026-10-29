# Central do Supervisor

Namespace `/supervisor` (papéis `supervisor` e `admin`). Seções do console: Visão geral, Agentes, **Qualidade**, Setores, Atendimentos, Atividades, Anúncios, Chat interno. O administrador tem ainda **Administração** ([gestão administrativa](../gestao-administrativa/papeis-e-permissoes.md)).

## Indicadores (`supervisor.snapshot { from?, to? }` e `supervisor.metrics`)

conectados, disponíveis, ocupados, ausentes, offline, em espera, em atendimento, aguardando pesquisa, atividades, maior espera (`longestWaitSeconds`) e encerrados no período (`closedInPeriod`). O servidor empurra `supervisor.metrics` a cada mudança.

## Escopo de acesso

Supervisores acessam agentes de seus setores e atendimentos das filas vinculadas por `sector_queues`. Listas, histórico, métricas, transferências e eventos respeitam esse escopo; administradores têm escopo do tenant.

## Operações

Monitorar: `conversation.list`, `conversation.watch` (grava auditoria), `history.sync`. Atuar: `conversation.transfer` para fila autorizada. Não envia mensagens nem encerra atendimentos. Gestão de setores, atividades e anúncios segue as permissões de cada módulo.

## Painel ao vivo × Qualidade

O painel ao vivo (`supervisor.snapshot`/`supervisor.metrics`, atendimentos supervisionados e escopo por setor/fila) é da **Fase 4** e não mudou na Fase 5. A seção **Qualidade** é da Fase 5: relatório histórico (`GET /quality/report`) com percentis, abandonos e cobertura de primeira resposta. O supervisor consulta só setor ou fila sob sua supervisão; o escopo da empresa é do administrador. Ver [Relatório de qualidade](../qualidade-operacional/relatorio-de-qualidade.md).

## Auditoria

`audit_events` registra `conversation.watch`, `sector.*`, `announcement.*` e `activity.*` (ator, ação, recurso, metadados). A consulta (`GET /audit/events`) existe desde a Fase 5, mas é **exclusiva do administrador**; o supervisor não a acessa. Ver [Auditoria](../gestao-administrativa/auditoria.md).
