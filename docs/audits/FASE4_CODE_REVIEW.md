# Revisão técnica independente — ViaVoip Webchat, fases 1–4

Data: 2026-10-27. Parecer: **REPROVADO — CORREÇÕES OBRIGATÓRIAS**. A revisão identificou falhas de autorização intratenant e de revogação de sessões que impedem considerar a Fase 4 pronta para a Fase 5. Os achados e suas condições estão em [FASE4_FINDINGS.md](FASE4_FINDINGS.md). A revisão é limitada pelo ambiente descrito em [FASE4_TEST_RESULTS.md](FASE4_TEST_RESULTS.md).

## Base examinada

Monorepo pnpm, Node.js/TypeScript, Fastify, Socket.IO, PostgreSQL com SQL manual e Redis opcional; console React/Vite, widget React/Vite, pacote de protocolo Zod e pacote de adaptador SM. Foram inspecionados código de autenticação, autorização, rotas, namespaces, emissão, salas, serviços corporativos, transações e migrations 001–007, além de testes e interfaces relevantes. Não há ORM: o código usa consultas SQL e tipos TypeScript. O build usa typecheck em todos os pacotes.

O Git do checkout não estava disponível nesta sessão; não foi possível verificar histórico, diff, autoria Cursor ou mudanças locais. O contexto compartilhado estava sujo e `ctx-sync pull` recusou; a continuação sem sincronização foi autorizada pelo usuário. Não foi encontrado projeto ViaVoip na listagem local do contexto compartilhado. Não foram acessados bancos ou ambientes produtivos.

## Matriz funcional

Estados: **Implementada e validada** requer execução relevante nesta auditoria; **Implementada, mas não validada** indica caminhos presentes sem execução integrada; **Parcial** inclui lacuna confirmada; **Ausente** exige ausência comprovada; **Bloqueada por dependência externa** aplica-se somente a dependências do produto, não ao Docker local.

| Capacidade | Estado | Evidência e limites |
|---|---|---|
| Protocolo e fábrica do mock SM | Implementada e validada | 5 testes de protocolo e 2 do adaptador passaram; não validam integração completa. |
| Autenticação HTTP/WS e isolamento entre tenants | Implementada, mas não validada | Sessões, namespaces e RLS existem; integração com Postgres não executada. Revogação de socket e login têm falhas F4-03/04. |
| Widget, filas, atendimento, histórico e pesquisa | Implementada, mas não validada | Código e testes para fases 2–3 existem; regressão integrada não executada. |
| Assumir, transferir, devolver e classificar | Implementada, mas não validada | Serviços e operações existem; concorrência e fluxo com banco não foram executados. Escopo de supervisor tem falha F4-02. |
| Chat interno direto e grupo, persistência e não lidas | Parcial | Serviços e tela existem; remoção de participante e salas falham (F4-01/05); paginação e reconexão do console são incompletas (F4-06/09). |
| Setores e responsáveis | Parcial | Modelo, criação, membros e operações no backend; edição e gestão de responsáveis não expostas na tela (F4-06), sincronização de salas insegura (F4-05). |
| Anúncios, públicos e leitura | Parcial | Serviço e tela de publicação/leitura; controles de fixação, expiração e edição não expostos (F4-06). Autorização integrada não executada. |
| Presença e histórico | Implementada, mas não validada | Estados e intervalos implementados; comportamento com várias sessões e reconexão não validado neste ambiente. |
| Atividades | Parcial | Alocação, encerramento e histórico presentes; gestão de tipos não exposta na tela (F4-06); conflitos não testados. |
| Supervisão e monitoramento | Parcial | Snapshot e filtros locais existentes; dados de atendimentos e eventos excedem o escopo (F4-02). |
| SM real | Bloqueada por dependência externa | Contrato externo ainda não definido, conforme premissa do produto. A ausência da integração real não é finding. |

## Arquitetura, segurança e banco

O backend separa chat externo e interno em serviços, tabelas e eventos próprios. Setores e filas são entidades distintas, relacionadas por `sector_queues` (`apps/server/migrations/004_organization.sql`). Apesar disso, a política de supervisão do atendimento externo não utiliza consistentemente essa relação (F4-02). O protocolo usa schemas Zod; SQL examinado usa parâmetros. Não foi observada renderização explícita de HTML arbitrário nas telas examinadas, mas não foi feita auditoria exaustiva de XSS e logs.

`withTenant` usa transação e `set_config` local; migrations definem RLS forçada, políticas por tenant, chaves, índices e triggers para diversas relações. Restrições únicas protegem mensagem idempotente, atividade ativa e intervalo de presença aberto. Isso é evidência de desenho, não prova de isolamento efetivo ou consistência de schema: não foi possível aplicar as migrations a um PostgreSQL descartável nem inspecionar schema real. A auditoria não confirma ausência de defeitos intertenant.

A interface `SMAdapter` e sua injeção em `buildApp` separam o domínio do mock, mas a fábrica atualmente só oferece mock e rejeita outros nomes, o que corresponde ao contrato pendente. Eventos pós-commit sem entrega durável (F4-07) precisam de decisão antes de uma integração que exija confiabilidade. Não se concluiu que o sistema esteja pronto para integração real.

Há sinais de preocupação com concorrência, incluindo bloqueios, versões e índices únicos; sem testes executados não se atesta ausência de corridas. Em tempo real, a persistência antecede o envio, mas não há atomicidade entre commit e publicação; reconexão interna não sincroniza o thread selecionado. Os testes existentes não demonstram que as fases anteriores seguem funcionando nesta execução.

## Respostas finais

1. **Fase 4 completa?** Não: há falhas P1 e funcionalidades parciais.
2. **Antes da Fase 5:** corrigir F4-01 a F4-05; validar a suíte integrada e regressões; tratar F4-06/09 para completar o fluxo corporativo e decidir garantia de entrega de F4-07.
3. **Multi-tenancy/permissões:** falhas de permissão intratenant comprovadas estaticamente. Vazamento entre tenants não foi demonstrado nem descartado dinamicamente.
4. **Banco consistente?** Não é possível atestar: migrations e mecanismos foram examinados, mas banco efetivo e execução não puderam ser verificados.
5. **Preparação para SM:** abstração inicial existe; contrato externo e garantias de entrega ainda estão pendentes.
6. **Regressões anteriores:** não foi possível concluir; suíte integrada bloqueada.
7. **Apto para Fase 5?** Não, até as correções obrigatórias e validações de segurança e regressão.
