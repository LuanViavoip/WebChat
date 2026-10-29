# Central do Agente

Console em `/console/` (`apps/console`), namespace WebSocket `/agent`. A interface foi redesenhada na Fase 5.5 sobre o [design system ViaVoip](../fase-5.5/DESIGN_SYSTEM.md); a navegação por papel e a diferença entre conectividade e presença estão em [Interface do console](../console/navegacao-e-papeis.md).

## Autenticação

`POST /auth/login { email, password }` → `{ token, role, name }`; `GET /auth/me` devolve `selfId`, nome, papel, filas, classificações, `maxConcurrentAssignments` e `canChangeOwnActivity` (Fase 5.5: se a pessoa pode registrar a própria atividade; ver [Painel de administração](../gestao-administrativa/painel-de-administracao.md)); `POST /auth/logout` apaga a sessão. Login usa limite por IP e conta compartilhado no PostgreSQL. Logout e expiração encerram sockets; revogação entre réplicas exige Redis.

## Filas autorizadas

`agent_queues` define as filas do agente. `queue.subscribe` entra nas salas dessas filas. Ler um atendimento `queued` exige estar na fila; um atendimento `assigned` só é visível ao agente dono.

## Atendimentos simultâneos

Limite por tenant: `tenants.max_concurrent_assignments` (padrão 3, 1–100). Acima do limite o claim responde `capacity`. O console mantém vários atendimentos abertos e contadores de não lidas por conversa.

## Operações

| Operação | Regra |
|---|---|
| Assumir (`conversation.claim`) | Atendimento `queued`, agente da fila, presença efetiva `available`. `UPDATE` atômico; perdedor recebe `already_claimed` |
| Devolver (`conversation.release`) | Só o agente dono; volta a `queued`, reseta `queued_at` |
| Transferir (`conversation.transfer`) | Só para **fila**, e só para fila em que o agente está escalado; volta a `queued` |
| Encerrar (`conversation.close`) | Exige classificação; vai a `awaiting_survey` |
| Mensagem / leitura | Só o agente dono, com atendimento `assigned` |

Repetir o encerramento com a mesma classificação devolve o estado atual sem novo evento; classificação diferente → `conflict`. Transferência direta para outro agente **não existe**.

## Estados

`queued → assigned → awaiting_survey → closed`; `release` e `transfer` voltam a `queued`; `leave` (visitante) leva `queued` a `closed`. Diagrama: [attendance-states](../diagrams/rendered/attendance-states.svg).

## Permissões

Agentes não publicam anúncios, não gerem setores/tipos de atividade e não enviam mensagens como supervisor. Ver [STATUS.md](../STATUS.md).

## Interface da Central (Fase 5.5)

Seção **Atendimentos** do menu lateral. Fontes: `apps/console/src/desk/` (`Desk.tsx`, `QueueColumn.tsx`, `ConversationPane.tsx`, `DetailColumn.tsx`).

- **Fila**: cartões de fila com contagem; cada atendimento mostra avatar, prévia da última mensagem (das mensagens já carregadas, sem endpoint novo), horário, contador de não lidas e estado.
- **Conversa**: balões diferenciados para visitante e agente, separador de dia, quebras de linha preservadas, compositor com Enter para enviar e Shift+Enter para quebrar a linha.
- **Confirmações**: encerrar e devolver à fila passam por diálogo de confirmação. Encerrar continua exigindo classificação.
- **Detalhes**: seções *Visitante*, *Atendimento*, *Transferências* e *Ações* (fila de destino, classificação) em coluna própria, que vira gaveta em telas médias.
- **Responsivo**: três colunas, detalhes em gaveta ou telas separadas, conforme a largura da área de conteúdo ([Interface do console](../console/navegacao-e-papeis.md)). Em tela estreita, a conversa que sai da lista (encerrada ou devolvida) devolve o agente à lista. `100dvh` mantém o compositor visível com o teclado virtual.
- **Presença**: o seletor do topo (Disponível, Ocupado, Ausente) é independente do chip de conexão.
- **Minha atividade**: o formulário para registrar a própria atividade só aparece quando `canChangeOwnActivity` é verdadeiro ([Atividades](activities.md)).

As regras de negócio (claim, transferência, limites) não mudaram; o redesenho não alterou rotas do servidor nem o protocolo de atendimento.
