# Validação

**Atualização de 29 de outubro de 2026 (Fase 5.5, commit `3d9e2cf`).** `pnpm test` na raiz passou com **192 testes**: protocol 11, adaptador SM 2, widget 18, console 61 e servidor 100 (25 arquivos, com PostgreSQL de Testcontainers). `pnpm build` terminou sem erros. Em containers descartáveis, `scripts/verify-browser.mjs` terminou com saída 0 e `scripts/verify-visual.mjs` registrou 155 verificações, 0 falhas e 0 erros de console, em cinco viewports ([Testes visuais](../fase-5.5/testes-visuais.md)). Ainda não há suíte de componentes React nem E2E no CI; os scripts de navegador são executados manualmente. A tabela abaixo é o registro histórico da Fase 4.

Estado de trabalho verificado em 27 de outubro de 2026. O responsável executou `pnpm test` em terminal com Docker, usando PostgreSQL e Redis descartáveis. O comando terminou com saída 0.

| Suíte | Resultado |
|---|---|
| Protocolo | 5 passaram |
| Adaptador SM | 2 passaram |
| Console | 3 passaram |
| Servidor | 52 passaram em 15 arquivos |
| **Total** | **62 passaram** |

Os testes incluem comunicação interna e logout entre réplicas via Redis. O teste de falha após commit confirma que o retry idempotente não reenvia o evento: não existe garantia de entrega durável. Não há suíte E2E de navegador. Build e checagem de tipos também passaram na sessão de revisão.

O dicionário foi regenerado após aplicar as onze migrations em PostgreSQL descartável. Ver [MAINTENANCE.md](../MAINTENANCE.md).
