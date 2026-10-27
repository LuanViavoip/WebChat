# Status de implementação — Fase 4

Estado verificado em 27 de outubro de 2026. O teste integrado fornecido pelo responsável terminou com 62 testes passando, incluindo PostgreSQL e Redis descartáveis. Isso não comprova entrega durável após falhas nem constitui aprovação irrestrita para produção.

| Área | Estado | Observações |
|---|---|---|
| Multi-tenancy | Implementado e testado | RLS nas tabelas de negócio; controles de tenant, participantes e setor. `login_rate_limits` é global com chaves HMAC e não contém tenant. |
| Autenticação e sessões | Implementado e testado | Argon2id, tokens opacos e limite compartilhado por IP e conta; logout distribuído depende do Redis. |
| Widget e central do agente | Implementados e testados | Filas, claim, transferência, encerramento, pesquisa e reconexão cobertos por testes existentes. |
| Chat interno | Implementado e testado | Histórico paginado, reconexão, participantes ativos e coordenação por advisory lock no PostgreSQL. |
| Setores e filas | Implementados e testados | Conceitos distintos; `sector_queues` limita o escopo de supervisão. Ambientes existentes precisam de vínculos corretos. |
| Anúncios e atividades | Implementados, validação parcial | Operações de backend e controles de interface presentes; não há suíte E2E de navegador. |
| Supervisor | Implementado e testado | Consultas e eventos limitados por setor/fila; administrador tem escopo do tenant. |
| Redis | Implementado e testado | Testes de entrega interna e logout entre duas instâncias com Redis descartável. |
| Entrega durável de eventos / SM | Pendente | Falha pós-commit pode deixar mensagem persistida sem reenviar o evento; não há outbox/retry. |
| Integração real com SM | Depende de contrato externo | Mock disponível; ausência do contrato real não é defeito desta fase. |

## Auditoria e limitações

Os achados originais são históricos; as correções e seus limites estão em [FASE4_REVIEW_POS_CORRECOES.md](audits/FASE4_REVIEW_POS_CORRECOES.md). A suíte passou, porém não substitui testes E2E em navegador nem validação de falha de infraestrutura em produção. A entrega pós-commit continua sem garantia durável (F4-07). Revogação entre réplicas exige Redis; a coordenação de mensagens de grupo requer PostgreSQL compartilhado. Eventos autorizados antes da remoção podem chegar posteriormente por atraso de transporte.
