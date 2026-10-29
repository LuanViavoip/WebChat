# Papéis e permissões

Código de referência: commit `02f5373` (Fase 5, PR #2). Fontes: `apps/server/src/domain/company-access.ts`, `apps/server/src/http/company-routes.ts`, `apps/console/src/shell/roles.ts`.

## Matriz

| Capacidade | Visitante | Agente | Supervisor | Admin |
|---|---|---|---|---|
| Conversar no widget | sim | não | não | não |
| Atender conversas das próprias filas | não | sim | sim | sim |
| Painel ao vivo, histórico e monitoramento ([Central do Supervisor](../central-do-supervisor/supervisor.html)) | não | não | escopo dos setores e filas | escopo da empresa |
| Painel de administração (`GET /company/desk`) | não | não | **não** | sim |
| Comandos de gestão (`POST /company/commands`) | não | não | **não** | sim |
| Relatório de qualidade, escopo `queue` ou `sector` | não | não | apenas fila ou setor sob sua supervisão | sim |
| Relatório de qualidade, escopo `tenant` | não | não | **não** | sim |
| Consulta de auditoria (`GET /audit/events`) | não | não | **não** | sim |

A regra única está em `assertCompanyAccess`: o papel `admin` passa; `supervisor` passa somente na capacidade `quality.report`, e mesmo ali com checagem de escopo; qualquer outro papel recebe `forbidden` ("Gestão exclusiva do administrador").

## Escopo do supervisor na qualidade

- Escopo `tenant`: recusado (`forbidden`, "Qualidade da empresa é exclusiva do administrador").
- Escopo `queue`: exige acesso à fila, pela mesma regra do painel ao vivo (`assertSupervisorQueueAccess`).
- Escopo `sector`: exige vínculo ativo em `sector_supervisors` (sem `removed_at`) e setor ativo.

## Seções do console por papel

| Papel | Seções |
|---|---|
| Supervisor | Visão geral, Agentes, **Qualidade**, Setores, Atendimentos, Atividades, Anúncios, Chat interno |
| Admin | Visão geral, Agentes, **Administração**, **Qualidade**, Setores, Atendimentos, Atividades, Anúncios, Chat interno |

"Administração" (`company`) e "Qualidade" (`quality`) são as duas seções novas da Fase 5. A interface apenas esconde o que o servidor já recusa; a autorização está no servidor.

## Autenticação

As quatro rotas exigem sessão de agente (`Authorization: Bearer`). Sem sessão válida a resposta é `unauthorized`.

## Salvaguardas de gestão

- O administrador não suspende a própria conta.
- A empresa mantém ao menos um administrador ativo: suspender ou rebaixar o último falha com `invalid_state` ("A empresa precisa de um administrador ativo").
- Filas são exclusivas do papel `agent`.
- `activity_authority` (`assigned_only` ou `self_service`) vale somente para agentes.
