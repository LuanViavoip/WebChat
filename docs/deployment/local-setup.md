# Setup local

O guia operacional original está em [local-development.md](../local-development.md). Resumo:

```bash
cp .env.example .env
docker compose up --build        # server :3000, demo :8090, postgres :5434, redis :6379
```

Sem reconstruir a imagem: `docker compose up postgres redis`, `pnpm install`, `pnpm dev`.

## Testes

```bash
pnpm test
```

Os testes do servidor usam Testcontainers (exigem Docker acessível ao usuário). Resultado verificado para esta documentação: [VALIDATION.md](../docs-helper/VALIDATION.md).

## Regenerar esta documentação

Ver [MAINTENANCE.md](../MAINTENANCE.md) (requer Docker para o schema e os diagramas, e Node 22).
