# Status de implementação (commit `d65d40d`)

Legenda: **Implementado**, **Parcial**, **Planejado**, **Depende do SM**.

| Área | Status | Observações |
|---|---|---|
| Multi-tenancy (RLS forçada, `withTenant`) | Implementado | 34 de 35 tabelas com RLS; `schema_migrations` sem RLS |
| Autenticação de agentes (sessão opaca, argon2id) | Implementado | Sem limite de tentativas no login (F4-04) |
| Sessões de visitante e allowlist de origens | Implementado | A allowlist não autentica o site hospedeiro |
| Widget ChatWeb (loader + iframe) | Implementado | Loader só trata `resize`; sem API JS de controle |
| Fila, claim, transferência para fila, devolução, encerramento em duas etapas | Implementado | Transferência direta a agente fora do escopo |
| Pesquisa de satisfação | Implementado | Uma resposta por atendimento |
| Reconexão do visitante (`history.sync`) | Implementado | Sem reenvio automático de mensagem falha |
| Central do agente (console) | Implementado | Atendimentos simultâneos limitados por tenant (padrão 3) |
| Chat interno (direto e grupo de setor) | Parcial | Sem paginação na UI; sem ressincronização da thread na reconexão (F4-09); falhas de sala F4-01/F4-05 |
| Setores | Parcial | UI cria setor e edita membros; não edita setor/supervisores (F4-06) |
| Anúncios | Parcial | UI publica sem fixar/expirar e sem editar/arquivar (F4-06); backend completo |
| Presença | Implementado | Calculada no servidor; heartbeat 15 s |
| Atividades e alocações | Parcial | Backend completo; UI sem gestão de tipos (F4-06) |
| Central do supervisor | Parcial | Escopo por setor limitado à lista de agentes; métricas e conversas são do tenant inteiro (F4-02) |
| Auditoria | Parcial | Gravada para conversation.watch, setores, anúncios e atividades; sem tela de consulta identificada |
| `sector_queues` (setor ↔ fila) | Planejado | Tabela existe; nenhum código a lê ou escreve neste commit |
| Redis | Implementado (opcional) | Apenas adapter do Socket.IO |
| Outbox / entrega confiável de eventos e SM | Planejado | F4-07 |
| Revogação de sockets no logout/expiração | Planejado | F4-03 |
| Retenção e purge de dados | Planejado | Não definidos |
| Integração real com o SM | Depende do SM | Apenas `MockSMAdapter` |

## Achados abertos da auditoria (documentados como limitações, não como comportamento esperado)

Fonte: [audits/FASE4_FINDINGS.md](audits/FASE4_FINDINGS.md) e [FASE4_CODE_REVIEW.md](audits/FASE4_CODE_REVIEW.md); veredito da auditoria: **REPROVADO** para avançar à Fase 5. Plano de correção: [audits/FASE4_CORRECTION_PLAN.md](audits/FASE4_CORRECTION_PLAN.md).

| ID | Sev. | Resumo | Confirmado no commit |
|---|---|---|---|
| F4-01 | P1 | Participante removido reentra na sala do chat interno via `internal.history` | sim (`staff-channel.ts` entra na sala) |
| F4-02 | P1 | Supervisor lê/transfere atendimentos e recebe eventos fora do seu setor | sim (`access.ts`: supervisor/admin sem restrição) |
| F4-03 | P1 | Logout/expiração não derrubam sockets abertos | não reverificado |
| F4-04 | P1 | `/auth/login` sem limitação de tentativas | sim (limiter só em `/visitor/sessions`) |
| F4-05 | P1 | Salas de grupo não acompanham mudanças de setor; admin não participante entra | não reverificado |
| F4-06 | P2 | UI corporativa incompleta | confirmado pela auditoria |
| F4-07 | P2 | Eventos e notificações ao SM fora da transação (sem outbox/retry) | sim (`safeNotify`) |
| F4-08 | P2 | Suíte de integração não verificável no ambiente da auditoria | ver abaixo |
| F4-09 | P2 | Chat interno não ressincroniza ao reconectar | confirmado pela auditoria |

**Testes:** o README do projeto afirma 46 testes passando; a auditoria não conseguiu executá-los. Ver o resultado da execução feita para esta documentação em [docs-helper/VALIDATION.md](docs-helper/VALIDATION.md).
