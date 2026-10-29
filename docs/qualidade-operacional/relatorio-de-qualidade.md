# Relatório de qualidade

Código de referência: `02f5373`. Fontes: `apps/server/src/modules/operational-quality.ts`, `apps/server/src/domain/quality-facts.ts`, `packages/protocol/src/company.ts`. O console mostra o relatório na seção **Qualidade** (supervisor e administrador).

## Rota

`GET /quality/report?scopeKind=…&from=…&to=…`

| Parâmetro | Regra |
|---|---|
| `scopeKind` | `tenant`, `sector` ou `queue` |
| `sectorId` | obrigatório (e só) com `sector` |
| `queueId` | obrigatório (e só) com `queue` |
| `from` / `to` | ISO 8601; `from` menor que `to`; janela de no máximo 31 dias |

Escopo `tenant` é só do administrador; supervisor consulta setor ou fila sob sua supervisão ([Papéis e permissões](../gestao-administrativa/papeis-e-permissoes.md)). Combinação inválida resulta em `invalid_payload`.

## Origem dos números

Os números são **reconstruídos das tabelas** (`conversation_events`, mensagens do agente, `survey_responses`, `presence_intervals`), não de contadores gravados. É o retrato histórico; os indicadores do instante continuam em `supervisor.metrics` ([Central do Supervisor](../central-do-supervisor/supervisor.md)). Se a publicação de um evento em tempo real falhar depois do commit, o relatório ainda enxerga a linha.

## Conteúdo

| Campo | Significado |
|---|---|
| `queueWait`, `firstResponse`, `handleTime` | Resumo de duração: `samples`, `totalSeconds`, `averageSeconds`, **`p50Seconds`**, **`p90Seconds`**, `maxSeconds`. Sem amostras, todos os valores são `null` |
| `queueWaits` | `completed`, `abandoned`, `open`, `unreadable` |
| `firstResponseCoverage` | `answered`, `unansweredClosed`, **`transferredUnanswered`**, `stillOpen`, `unreadable` |
| `completions.classified` | Atendimentos encerrados com classificação |
| `survey` | `responses`, `averageScore` (1 a 5, `null` sem respostas) e `comments` (`none` ou `some` com contagem) |
| `sla.queueWait`, `sla.firstResponse` | `within`, `breached`, `notApplicable` ([Política de SLA](politica-de-sla.md)) |
| `presenceSeconds` | Segundos em `available`, `busy`, `away` e `offline` dos agentes no escopo |

## Percentis

p50 e p90 usam o método do posto mais próximo sobre as amostras ordenadas: `amostra[ceil(p × n) − 1]`. O resultado é sempre um valor realmente medido, sem interpolação. O tempo de atendimento (`handleTime`) soma segmentos encerrados por devolução, transferência ou classificação.

## Cobertura da primeira resposta

`firstResponseCoverage` explica por que `firstResponse.samples` pode ser menor que o total de atendimentos:

- `answered`: tiveram resposta e entram em `firstResponse`.
- `unansweredClosed`: encerrados sem resposta; contam como violação de SLA quando há política.
- `transferredUnanswered`: transferidos ou devolvidos sem resposta; **não** violam o SLA.
- `stillOpen`: ainda sem resposta.
- `unreadable`: sem fila identificável.

## Abandonos

`queueWaits.abandoned` conta visitantes que saíram da fila antes de ser atribuídos (evento `left`). Não entram no julgamento de SLA da espera.

## Limites

Sem pré-agregação: cada consulta lê os eventos do período. Não há exportação nem filtro por agente, e a janela máxima é de 31 dias.
