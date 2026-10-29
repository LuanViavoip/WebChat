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

## Interface (Fase 5.5)

Fontes: `apps/console/src/supervisor/` (`OverviewPanel.tsx`, `agents.ts`) e `apps/console/src/quality/`.

- **Visão geral**: cartões agrupados em *Presença*, *Fila* e *Operação*, com ícone, cor semântica e dica (`title`). "Maior espera" mostra "—" quando o servidor devolve `null` (ninguém na fila) e "0 s" quando é zero. "Atualizado às" usa o `generatedAt` do servidor.
- **Agentes**: tabela com badges separados de **Presença** e **Conectividade**.
- **Qualidade**: tela do relatório histórico, descrita abaixo e em [Relatório de qualidade](../qualidade-operacional/relatorio-de-qualidade.md).

### Tela de Qualidade

- **Escopo**: seletor com as opções permitidas ao papel. O administrador vê *Toda a empresa*, os setores ativos e as filas. O supervisor vê apenas os setores ativos em que é responsável e as filas disponíveis para ele; **nunca** a empresa. O espelho do servidor é `assertSupervisorQualityScope`; o servidor continua sendo a autoridade.
- **Período**: campos *De* e *Até* (fuso local) com atalhos de 24 h, 7 dias (padrão) e 31 dias. O limite é de **31 dias**: períodos maiores, invertidos ou vazios desabilitam "Gerar relatório" e mostram o motivo. O servidor rejeita períodos acima de 31 dias; o cliente repete o valor porque `MAX_QUALITY_WINDOW_MS` não é exportado pelo pacote de protocolo.
- **Conteúdo**: cartões de tempo (espera na fila, primeira resposta e TMA, com amostras, p50 e p90), abandonos, cobertura de primeira resposta, atendimentos classificados, pesquisa de satisfação, cumprimento de SLA e presença dos agentes no período.
- Usa somente `GET /quality/report`; sem escopo disponível, mostra "Nenhum escopo disponível".
