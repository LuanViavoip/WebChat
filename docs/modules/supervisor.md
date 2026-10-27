# Central do Supervisor

Namespace `/supervisor` (papéis `supervisor` e `admin`). Seções do console: Visão geral, Agentes, Setores, Atendimentos, Atividades, Anúncios, Chat interno.

## Indicadores (`supervisor.snapshot { from?, to? }` e `supervisor.metrics`)

conectados, disponíveis, ocupados, ausentes, offline, em espera, em atendimento, aguardando pesquisa, atividades, maior espera (`longestWaitSeconds`) e encerrados no período (`closedInPeriod`). O servidor empurra `supervisor.metrics` a cada mudança.

## Escopo de acesso

Supervisores acessam agentes de seus setores e atendimentos das filas vinculadas por `sector_queues`. Listas, histórico, métricas, transferências e eventos respeitam esse escopo; administradores têm escopo do tenant.

## Operações

Monitorar: `conversation.list`, `conversation.watch` (grava auditoria), `history.sync`. Atuar: `conversation.transfer` para fila autorizada. Não envia mensagens nem encerra atendimentos. Gestão de setores, atividades e anúncios segue as permissões de cada módulo.

## Auditoria

`audit_events` registra `conversation.watch`, `sector.*`, `announcement.*` e `activity.*` (ator, ação, recurso, metadados). O código não oferece consulta/tela de auditoria identificada.
