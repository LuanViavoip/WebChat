# Plano de correção — Fase 4

A auditoria não implementa correções. As prioridades abaixo são recomendações com critérios de aceite; a Fase 5 permanece bloqueada enquanto os itens P1 e os testes críticos não forem resolvidos.

## 1. P1 — Conter exposição e ações fora do escopo

1. **F4-01 e F4-05 — salas corporativas:** aplicar associação a salas apenas a participantes ativos; distinguir leitura histórica retida de assinatura ao vivo; reconciliar entradas e saídas após remoção, mudança de responsável, desativação e reconexão. Não usar público de notificações administrativas como lista de participantes. Testar duas abas, dois namespaces e, se aplicável, duas réplicas.
2. **F4-02 — supervisão:** centralizar política de escopo baseada em setores e relação setor–fila, aplicá-la a listagem, histórico, transferência, métricas e distribuição de eventos; definir tratamento de fila sem setor e privilégios de administrador. Testar dois setores e dois tenants com usuários e recursos sintéticos.
3. **F4-03 — ciclo de sessão:** mapear sockets por sessão, invalidar no logout e no vencimento e assegurar revogação entre réplicas. Testar sockets previamente conectados, ações, recebimento passivo e nova conexão.
4. **F4-04 — login:** implementar limitação de tentativas por conta e IP com estado compartilhado quando houver réplicas; testar evasão e recuperação após janela, sem permitir bloqueio fácil de conta legítima.

## 2. Validação de segurança e regressão

- Resolver F4-08 em CI isolado; rodar migrations em PostgreSQL novo, a suíte integral e testes adversariais de F4-01 a F4-05. Investigar erro de inicialização do Vitest antes de atribuir causa.
- Verificar RLS com usuário restrito, foreign keys/triggers e schema aplicado; testar IDs cruzados, evento indevido de visitante, concorrência de claim e de atividades, idempotência e múltiplas sessões.
- Reexecutar fluxos de widget, fila, claim, transferência, devolução, encerramento, pesquisa, histórico e reconexão. Registrar os resultados reais e cobrir navegador em cenários representativos.

## 3. P2 — Completar experiência e confiabilidade

- **F4-06/09:** expor controles corporativos previstos e paginação; sincronizar thread interno na reconexão e lidar com concorrência entre histórico e eventos.
- **F4-07:** decidir garantias de entrega e implementar outbox transacional e consumo idempotente caso necessária entrega confiável ao futuro SM; validar falha entre commit e publicação e recuperação após reinício.
- Medir consultas de snapshot, histórico e listas com volume representativo; avaliar índices e carga de atualização para múltiplos supervisores.

## Critérios de liberação

Nenhum P0/P1 aberto; testes de isolamento, escopo e revogação passando em ambiente descartável; migrations aplicadas em banco limpo e conferidas; regressões das fases 2 e 3 e fluxos corporativos essenciais validados; limitações restantes aprovadas de forma explícita. A inexistência do contrato SM real não bloqueia por si só o mock nem constitui defeito.
