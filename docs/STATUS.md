# Status de implementação — Fase 5

Código de referência: commit `02f5373` (Fase 5, PR #2 na `main`). A contagem de testes da Fase 4 (62 passaram em 27 de outubro de 2026, com PostgreSQL e Redis descartáveis) **não foi refeita para esta documentação**; a Fase 5 acrescentou suítes no servidor, no protocolo, no widget e no console. Nada disso comprova entrega durável após falhas nem aprova o uso em produção.

| Área | Estado | Observações |
|---|---|---|
| Multi-tenancy | Implementado e testado | RLS nas tabelas de negócio; controles de tenant, participantes e setor. `login_rate_limits` é global com chaves HMAC e não contém tenant. |
| Autenticação e sessões | Implementado e testado | Argon2id, tokens opacos e limite compartilhado por IP e conta; logout distribuído depende do Redis. |
| Widget e central do agente | Implementados e testados | Filas, claim, transferência, encerramento, pesquisa e reconexão cobertos por testes existentes. |
| Chat interno | Implementado e testado | Histórico paginado, reconexão, participantes ativos e coordenação por advisory lock no PostgreSQL. |
| Setores e filas | Implementados e testados | Conceitos distintos; `sector_queues` limita o escopo de supervisão. Ambientes existentes precisam de vínculos corretos. |
| Anúncios e atividades | Implementados, validação parcial | Operações de backend e controles de interface presentes; não há suíte E2E de navegador. |
| Supervisor | Implementado e testado | Consultas e eventos limitados por setor/fila; administrador tem escopo do tenant. |
| Redis | Implementado e testado | Entrega interna e logout entre duas instâncias com Redis descartável. Obrigatório com mais de uma réplica (`REPLICAS` > 1). |
| Gestão administrativa | Implementado e testado | Painel da empresa, comandos idempotentes com recibo de 24 h, fuso, sites que nascem pausados e janelas de atendimento; exclusivo do administrador. Ver [Papéis e permissões](gestao-administrativa/papeis-e-permissoes.md). |
| Qualidade operacional | Implementado e testado | Políticas de SLA por fila e relatório histórico (p50/p90, abandonos, cobertura de primeira resposta, pesquisa, presença). Ver [Política de SLA](qualidade-operacional/politica-de-sla.md). |
| Auditoria | Implementado e testado | Consulta paginada por cursor, só para administrador; escrita e consulta cobrem as ações de gestão. |
| Revogação de sessão | Implementado e testado | Disconnect direto, Redis, `NOTIFY` e varredura em lote (padrão 10 s, teto 15 s). Ver [Revogação de sessão](gestao-administrativa/revogacao-de-sessao.md). |
| Entrega durável de eventos / SM | Pendente | Falha pós-commit pode deixar mensagem persistida sem reenviar o evento; não há outbox/retry. |
| Integração real com SM | Depende de contrato externo | Mock disponível; ausência do contrato real não é defeito desta fase. |

## Auditoria e limitações

As migrations 009 a 011 ([resumo](deployment/migrations-009-011.md)) acrescentam tabelas, colunas e a função de varredura de sessões. Os achados originais da Fase 4 são históricos; as correções e seus limites estão em [FASE4_REVIEW_POS_CORRECOES.md](audits/FASE4_REVIEW_POS_CORRECOES.md). A suíte passou, porém não substitui testes E2E em navegador nem validação de falha de infraestrutura em produção. A entrega pós-commit continua sem garantia durável (F4-07). Revogação entre réplicas exige Redis; a coordenação de mensagens de grupo requer PostgreSQL compartilhado. Eventos autorizados antes da remoção podem chegar posteriormente por atraso de transporte.
