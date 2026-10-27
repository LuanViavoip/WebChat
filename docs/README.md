# Documentação técnica — ViaVoip Webchat

**Versão documentada:** commit `d65d40d` (branch `docs/webchat-technical-documentation`), implementação até a **Fase 4**. Toda afirmação aqui foi conferida contra esse commit, não contra requisitos planejados.

> Existem alterações **não commitadas** de terceiros no código (correções dos achados F4-01/02/05 em andamento). Esta documentação **não** as descreve. Ao serem integradas, atualize conforme [MAINTENANCE.md](MAINTENANCE.md).

## Como ler

| Quero… | Leia |
|---|---|
| Saber o que está pronto, parcial ou planejado | [STATUS.md](STATUS.md) |
| Entender a arquitetura | [architecture/overview.md](architecture/overview.md), [multi-tenancy](architecture/multi-tenancy.md), [websocket](architecture/websocket.md) |
| Integrar o SM no futuro | [architecture/integration-sm.md](architecture/integration-sm.md) |
| Instalar o widget | [modules/widget.md](modules/widget.md) |
| Operar a central | [agent](modules/agent.md), [internal-chat](modules/internal-chat.md), [sectors](modules/sectors.md), [announcements](modules/announcements.md), [presence](modules/presence.md), [activities](modules/activities.md), [supervisor](modules/supervisor.md) |
| Consultar o banco | [database/overview.md](database/overview.md), [data-dictionary.md](database/data-dictionary.md), [relationships.md](database/relationships.md) |
| Ver os diagramas | [diagrams/README.md](diagrams/README.md) |
| Subir o ambiente | [deployment/local-setup.md](deployment/local-setup.md), [environments.md](deployment/environments.md) |
| Atualizar esta documentação | [MAINTENANCE.md](MAINTENANCE.md) |
| Publicar no Docs Helper | [docs-helper/PUBLICATION-BLOCKER.md](docs-helper/PUBLICATION-BLOCKER.md) |

Documentos anteriores do projeto, mantidos como estão: [architecture.md](architecture.md), [contracts.md](contracts.md) (contratos HTTP/WebSocket completos), [decisions.md](decisions.md), [local-development.md](local-development.md), [sm-integration.md](sm-integration.md) e [audits/](audits/).

## Glossário

| Termo | Significado |
|---|---|
| Tenant | Organização cliente; fronteira de isolamento de dados |
| Site | Instalação do widget de um tenant, identificada por `public_id` |
| Fila | Destino de atendimento externo (`queues`) |
| Atendimento / conversa | Conversa visitante ↔ agente (`conversations`) |
| Chat interno | Conversa entre usuários internos (`internal_conversations`), separada do atendimento externo |
| Setor | Agrupamento organizacional de agentes (`sectors`) |
| Presença | Estado do agente (available/busy/away), calculado no servidor |
| Conectividade | Existência de conexão WebSocket com heartbeat recente; sem ela a presença efetiva é `offline` |
| Atividade | Ocupação do agente (ex.: Treinamento), independente da presença |
| Ack | Resposta de um comando WebSocket, enviada só após o commit |
| SM | Sistema externo futuro; sem contrato definido |
