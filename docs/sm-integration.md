# Integração com o SM

O contrato HTTP do SM não faz parte desta fase. O servidor depende de `SMAdapter`:

- `onConversationQueued`
- `onConversationAssigned`
- `onConversationClosed`
- `onConversationReleased`
- `onConversationTransferred`

`createSMAdapter('mock')` devolve `MockSMAdapter`, que guarda as chamadas em memória e não abre conexão externa. Qualquer outro nome, inclusive um futuro adaptador ViaVoip, aborta a subida com `PendingSmContractError`.

A notificação acontece depois do commit. Falha do adaptador é registrada em log e não desfaz a conversa.

`onConversationTransferred` e `onConversationReleased` registram o que o webchat já decidiu. Não descrevem um endpoint do SM. Filas, agentes, conversas e mensagens continuam no Postgres.

Fora do contrato atual, de propósito:

- mensagem individual
- pesquisa de satisfação
- saída da fila pelo visitante (`conversation.leave`)
- autenticação de agente contra o SM
- presença (`available`, `busy`, `away`, `offline`), heartbeat e limite de atendimentos simultâneos
- cursor de leitura por agente e conversa

Esses pontos continuam internos ao webchat até o contrato real ser definido. Não há cliente HTTP, URL, credencial ou mapeamento de fila do SM no repositório.

## O que a fase 4 mantém fora do SM

Enquanto o contrato externo não chega, o servidor não ganha endpoint, evento nem campo especulativo no `SMAdapter`. Continuam só no webchat:

- setores, membros e supervisores responsáveis
- conversa direta e grupo do setor
- quadro de anúncios e leitura
- presença, intervalo de presença e alocação de atividade
- painel do supervisor

O atendimento externo segue notificando o mock nos métodos já existentes. Falha do mock não desfaz o Postgres e não bloqueia o chat interno.

## O que confirmar com a equipe do SM

- Como autenticar o servidor do webchat e o agente.
- Se fila, agente e classificação nascem no SM ou continuam no webchat.
- O identificador estável de fila, agente, conversa e site.
- Se transferência de fila e devolução para a fila disparam eventos no SM, e qual agente deve constar no payload.
- Se a saída do visitante antes do atendimento deve cancelar algo no SM.
- Se a pesquisa de satisfação permanece no webchat.
- Se presença `available`/`busy`/`away`/`offline` do agente existe no SM ou continua só no webchat.
- Se o limite de atendimentos simultâneos nasce no SM.
- Se a leitura de mensagem precisa ser espelhada no SM.
