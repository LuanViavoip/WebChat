# Validação

Commit documentado: `d65d40d`.

## Testes do código (executados para esta documentação)

Executados em uma cópia exportada do commit (`git archive`), isolada das alterações não commitadas de terceiros, com `pnpm install --frozen-lockfile` e `pnpm test`, Docker acessível:

| Suíte | Resultado |
|---|---|
| packages/protocol | 5 passaram |
| packages/sm-adapter | 2 passaram |
| apps/console | 1 passou |
| apps/server (12 arquivos, Testcontainers) | 38 passaram |
| **Total** | **46 de 46, saída 0** |

Isso confirma o README do projeto e **não reproduz** o bloqueio F4-08 da auditoria (ambiente diferente; causa lá não estabelecida). Não há testes de widget nem E2E.

## Documentação

Ver o relatório gerado por `scripts/docs/validate.mjs` (cruzamento de tabelas, eventos, links, imagens e índice do Docs Helper) em [MAINTENANCE.md](../MAINTENANCE.md).
