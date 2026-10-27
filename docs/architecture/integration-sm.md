# Integração com o SM

**Estado:** o SM **não possui contrato definitivo**. O Webchat é independente dele nesta fase. Nada aqui descreve endpoints do SM: apenas a interface interna do Webchat.

## Interface implementada (`packages/sm-adapter`)

`SMAdapter` tem cinco métodos, todos `Promise<void>`:

| Método | Referência recebida (`SmConversationRef`) | Quando é chamado |
|---|---|---|
| `onConversationQueued` | `tenantId, conversationId, siteId, queueId` | conversa entra na fila |
| `onConversationAssigned` | + `agentId` | agente assume |
| `onConversationReleased` | + `agentId` | agente devolve à fila |
| `onConversationTransferred` | + `fromQueueId, agentId` | transferência para outra fila |
| `onConversationClosed` | + `agentId, dispositionId` | encerramento com classificação |

Pontos de atenção documentados pelo código:

- As chamadas ocorrem **após o commit**, dentro de `safeNotify`: falha é registrada e **ignorada**; não há outbox nem retry (F4-07).
- `conversation.leave` (visitante sai da fila) e o fechamento final pela pesquisa **não** notificam o SM.
- Em transferência feita por supervisor/admin, o `agentId` enviado é o do supervisor.

## Fábrica e MockSMAdapter

`createSMAdapter('mock')` devolve o `MockSMAdapter`, que guarda clones de cada chamada em `calls[]` e não abre conexão. Qualquer outro valor de `SM_ADAPTER` lança `PendingSmContractError` e **aborta a subida do servidor**. `SM_ADAPTER` é obrigatório.

## Responsabilidades do adaptador (futuro)

Traduzir eventos de ciclo de vida do atendimento para o SM, sem que o Webchat dependa do SM para atender. O adaptador **não** deve bloquear o commit do atendimento.

## Dependências pendentes e perguntas em aberto

Reproduzidas de [sm-integration.md](../sm-integration.md):

1. Fila, agente e classificação originam-se no SM ou no Webchat?
2. Quais identificadores estáveis serão trocados?
3. Transferência e devolução geram eventos no SM?
4. Sair da fila cancela algo no SM?
5. A pesquisa de satisfação permanece no Webchat?
6. Existe presença no SM?
7. O limite de atendimentos simultâneos vem do SM?
8. Confirmações de leitura são espelhadas?

## Requisitos para a integração real

Contrato (autenticação, versão, formato); mapeamento de filas/agentes/classificações; entrega confiável (outbox transacional + consumo idempotente, F4-07); política de falha e reprocessamento; testes de contrato; segredos fora do repositório.
