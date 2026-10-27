# Ambientes

Somente o que é verificável no repositório (`Dockerfile`, `docker-compose.yml`, `.env.example`, `apps/server/src/config.ts`).

## Desenvolvimento / demonstração — verificável

`docker-compose.yml` define quatro serviços: `postgres` (16-alpine, porta do host 5434), `redis` (7-alpine, 6379), `server` (porta 3000, healthcheck em `/health`) e `demo` (nginx, 8090, serve `infra/demo`). Diagrama: [infrastructure](../diagrams/rendered/infrastructure.svg).

`Dockerfile`: `node:22-bookworm-slim`, `corepack` com pnpm 12.15.0, `pnpm install --frozen-lockfile`, `pnpm build`, `NODE_ENV=production`, porta 3000, `CMD pnpm --filter @viavoip/server start`.

O Compose usa credenciais de banco **de desenvolvimento** e `SEED=true`. Não as use fora do ambiente local.

## Variáveis de ambiente (apenas nomes e padrões)

| Variável | Obrig. | Padrão / efeito |
|---|---|---|
| `DATABASE_URL` | sim | Conexão do papel `webchat_app` |
| `MIGRATE_DATABASE_URL` | sim | Papel que aplica migrations e seed |
| `SM_ADAPTER` | sim | Só `mock`; outro valor aborta a subida |
| `REDIS_URL` | não | Vazio desliga o adapter do Socket.IO |
| `PORT` / `HOST` | não | 3000 / 0.0.0.0 |
| `SEED` | não | `true` carrega `infra/seed/seed.sql` |
| `SESSION_TTL_HOURS` | não | 12 |
| `SESSION_CREATE_LIMIT`, `MESSAGE_LIMIT`, `RATE_WINDOW_MS` | não | 1000, 1000, 60000 (por processo) |
| `PRESENCE_STALE_MS` | não | 45000 |
| `CORS_ORIGINS` | não | `http://localhost:3000,http://127.0.0.1:3000` |
| `SERVE_STATIC` | não | Ligado; `false` desliga servir widget/console (**ausente do `.env.example`**) |
| `LOG` | não | `false` desliga o logger (**ausente do `.env.example`**) |

## Produção — NÃO verificável

O repositório não contém Terraform, Kubernetes, CI/CD nem manifests de implantação, e nenhum ambiente de produção do Webchat foi inspecionado. Qualquer topologia de produção é **proposta futura**. Pontos a decidir antes de produzir: múltiplas instâncias exigem estado compartilhado para o limitador de taxa (hoje em memória) e Redis para o adapter do Socket.IO; TLS e CORS; segredos fora do repositório; política de backup e retenção (não definidas); observabilidade (não há métricas, tracing ou alertas).
