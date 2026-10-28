# Validação

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
