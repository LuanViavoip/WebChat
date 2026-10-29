# Política de SLA

Código de referência: `02f5373`. Fontes: `apps/server/src/modules/company-commands.ts` (`publishSla`, `retireSla`), `apps/server/src/domain/quality-facts.ts`, migration `009_company_admin.sql`. Publicar e aposentar é exclusivo do administrador.

## Modelo

Uma política pertence a **uma fila** e tem dois relógios, ambos entre 1 e 86400 segundos:

| Relógio (`metric`) | Mede |
|---|---|
| `queue_wait` | Tempo entre entrar na fila e ser atribuído |
| `first_response` | Tempo até a primeira resposta de um agente |

Tabelas: `sla_policies` (fila, `status` `active` ou `retired`, `effective_from`, `retired_at`, autor) e `sla_policy_clocks` (chave `(policy_id, metric)` e `threshold_seconds`). O trigger de restrição adiado `sla_policies_clocks_complete` exige os dois relógios em toda política.

## Publicar e aposentar

- `sla.publish { queueId, effectiveFrom, queueWaitThresholdSeconds, firstResponseThresholdSeconds }`
  - `effectiveFrom` **não pode estar no passado** (`invalid_state`, "Publicação retroativa"; trigger `sla_policies_publication`). Não há como reescrever o histórico.
  - Se a fila já tem política ativa, ela é aposentada com `retired_at = effectiveFrom`; a nova começa nesse instante, sem lacuna.
  - Uma política futura que deixaria lacuna é recusada pelo banco.
- `sla.retire { queueId }` aposenta a política ativa: `retired_at` é o próprio `effective_from` se ela ainda não começou, ou agora. Sem política ativa, `not_found`.

Garantias do banco: no máximo uma política ativa por fila (índice único parcial `sla_policies_one_active`) e vigências que não se sobrepõem (restrição `EXCLUDE` com `tstzrange` sobre a extensão `btree_gist`).

## Como o relatório aplica a política

A política vigente é escolhida pelo **instante em que o fato começou** (entrada na fila ou instante da primeira resposta), e não pelo instante da consulta. Mudar o limite hoje não altera julgamentos de atendimentos já ocorridos. A comparação é `tempo <= limite` para **dentro** (`within`); acima disso, **violado** (`breached`).

| Relógio | Fato | Resultado |
|---|---|---|
| `queue_wait` | atribuído dentro do limite | `within` |
| `queue_wait` | atribuído acima do limite | `breached` |
| `queue_wait` | abandonado (visitante saiu) | `not_applicable` (`abandoned`) |
| `queue_wait` | ainda na fila | `not_applicable` (`still_open`) |
| `first_response` | respondido dentro / acima do limite | `within` / `breached` |
| `first_response` | encerrado sem resposta de agente | `breached` (sem tempo medido) |
| `first_response` | **transferido ou devolvido sem resposta** | `not_applicable` (`handed_off`), **não viola** |
| qualquer | fila sem política na data | `not_applicable` (`no_policy`) |
| qualquer | dado ilegível (fila ausente) | `not_applicable` (`unreadable`) |

Transferir ou devolver sem responder não conta como violação: o atendimento muda de dono e o relógio do primeiro agente deixa de valer. Esses casos aparecem no relatório em `firstResponseCoverage.transferredUnanswered` ([Relatório de qualidade](relatorio-de-qualidade.md)).

## Histórico de versões no console (Fase 5.5)

A seção SLA da Administração lista as versões de uma fila (vigente, agendada, vigente até a troca e encerrada). Ver [Painel de administração](../gestao-administrativa/painel-de-administracao.md).
