# Central do Supervisor

Namespace `/supervisor` (papéis `supervisor` e `admin`). Seções do console: Visão geral, Agentes, Setores, Atendimentos, Atividades, Anúncios, Chat interno.

## Indicadores (`supervisor.snapshot { from?, to? }` e `supervisor.metrics`)

conectados, disponíveis, ocupados, ausentes, offline, em espera, em atendimento, aguardando pesquisa, atividades, maior espera (`longestWaitSeconds`) e encerrados no período (`closedInPeriod`). O servidor empurra `supervisor.metrics` a cada mudança.

## Escopo de acesso — limitação importante (F4-02)

No commit documentado:

- a **lista de agentes** é filtrada por setor para supervisores;
- **conversas, métricas de fila e transferência são do tenant inteiro**: `assertCanRead` não restringe supervisor/admin, `listForSupervisor` lista todas as conversas abertas e `message.new` chega a `supervisors` sem filtro de setor.

Ou seja, um supervisor enxerga e pode transferir atendimentos fora dos seus setores. Isto é um **defeito aberto**, não o comportamento desejado. A relação setor ↔ fila (`sector_queues`) ainda não é usada.

## Operações

Monitorar: `conversation.list`, `conversation.watch` (grava auditoria), `history.sync`. Atuar: `conversation.transfer` para qualquer fila do tenant. **Não** envia mensagens nem encerra atendimentos. Gestão: setores, atividades e anúncios conforme as regras de cada módulo.

## Auditoria

`audit_events` registra `conversation.watch`, `sector.*`, `announcement.*` e `activity.*` (ator, ação, recurso, metadados). O código não oferece consulta/tela de auditoria identificada.
