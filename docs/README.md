# Documentação técnica — ViaVoip Webchat

**Versão documentada:** Fase 5.5, commit `3d9e2cf`: console redesenhado sobre o design system ViaVoip, widget corrigido pela causa raiz e demo no site institucional, sobre a Fase 5 (`02f5373`, PR #2: gestão administrativa, configuração por empresa, qualidade operacional, auditoria e revogação de sessão) e a base da Fase 4. A entrega durável após falha de publicação continua pendente; ver [STATUS.md](STATUS.md).

## Como ler

| Quero… | Leia |
|---|---|
| Saber o que está pronto, parcial ou planejado | [STATUS.md](STATUS.md) |
| Entender a arquitetura | [architecture/overview.md](architecture/overview.md), [multi-tenancy](architecture/multi-tenancy.md), [websocket](architecture/websocket.md) |
| Integrar o SM no futuro | [architecture/integration-sm.md](architecture/integration-sm.md) |
| Instalar o widget | [modules/widget.md](modules/widget.md) e [geometria e correção do recorte](modules/widget-geometria.md) |
| Entender a interface do console | [navegação por papel, conectividade e presença](console/navegacao-e-papeis.md), [design system](fase-5.5/DESIGN_SYSTEM.md) |
| Operar a central | [agent](modules/agent.md), [internal-chat](modules/internal-chat.md), [sectors](modules/sectors.md), [announcements](modules/announcements.md), [presence](modules/presence.md), [activities](modules/activities.md), [supervisor](modules/supervisor.md) |
| Administrar a empresa (admin) | [papéis](gestao-administrativa/papeis-e-permissoes.md), [painel de administração](gestao-administrativa/painel-de-administracao.md), [configuração](gestao-administrativa/configuracao-por-empresa.md), [comandos idempotentes](gestao-administrativa/comandos-idempotentes.md), [auditoria](gestao-administrativa/auditoria.md), [revogação de sessão](gestao-administrativa/revogacao-de-sessao.md) |
| Medir a qualidade | [política de SLA](qualidade-operacional/politica-de-sla.md), [relatório](qualidade-operacional/relatorio-de-qualidade.md) |
| Consultar o banco | [database/overview.md](database/overview.md), [data-dictionary.md](database/data-dictionary.md), [relationships.md](database/relationships.md) |
| Ver os diagramas | [diagrams/README.md](diagrams/README.md) |
| Ver o webchat no site institucional e testar a interface | [demo local](fase-5.5/DEMO_SITE_LOCAL.md), [testes visuais](fase-5.5/testes-visuais.md), [relatório da Fase 5.5](fase-5.5/RELATORIO.md) |
| Subir o ambiente | [deployment/local-setup.md](deployment/local-setup.md), [environments.md](deployment/environments.md), [migrations 009–011](deployment/migrations-009-011.md) |
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
| Conectividade | Existência de conexão WebSocket com heartbeat recente; sem ela a presença efetiva é `offline`. No console aparece no chip do topo, separada do controle de presença |
| Loader | Script `widget.js` do site cliente; cria o iframe do widget, calcula sua geometria pelo viewport do site e expõe `window.ViaVoipWebchat.open()/close()` |
| `canChangeOwnActivity` | Campo de `GET /auth/me`: se a pessoa pode registrar a própria atividade (sempre verdadeiro para supervisão e administração) |
| Atividade | Ocupação do agente (ex.: Treinamento), independente da presença |
| Ack | Resposta de um comando WebSocket, enviada só após o commit |
| SM | Sistema externo futuro; sem contrato definido |
| Admin / Supervisor / Agente / Visitante | Papéis: admin gere a empresa e vê tudo; supervisor acompanha setores e filas sob seu escopo e consulta qualidade desse escopo; agente atende as filas atribuídas; visitante conversa pelo widget |
| `requestId` | UUID de idempotência de um comando de gestão; o recibo vale 24 h |
| SLA | Limites de espera na fila e de primeira resposta, por fila e com vigência |
| `auth_epoch` | Contador da pessoa; sessão com época antiga deixa de valer |
