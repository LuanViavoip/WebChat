# Desenvolvimento local

Requisitos: Node.js 22 ou superior, pnpm 12 e Docker.

```bash
cp .env.example .env
docker compose up --build
```

O Compose publica o servidor na porta 3000, a página demo na 8090, Redis na 6379 e Postgres na 5434 do host (5432 dentro da rede). A porta 5432 do host fica livre para outros projetos. Na subida o servidor aplica as migrations e o seed quando `SEED=true`.

Para iterar sem reconstruir a imagem:

```bash
docker compose up postgres redis
pnpm install
pnpm dev
```

`pnpm dev` sobe só a API, com `tsx`. Widget e console em desenvolvimento:

```bash
pnpm --filter @viavoip/widget dev
pnpm --filter @viavoip/console dev
```

O fluxo de aceite usa os artefatos servidos pelo servidor na porta 3000. Rode `pnpm build` antes disso se não estiver usando o Compose.

## Testes

```bash
pnpm test
```

O Postgres de teste é um container efêmero. O papel `webchat_app` não contorna RLS. O papel usado nas migrations é o superusuário do container e existe só para criar o schema e o seed.

## Variáveis

- `DATABASE_URL` — papel `webchat_app`
- `MIGRATE_DATABASE_URL` — papel que cria schema e seed
- `REDIS_URL` — vazio desliga o adapter; o Compose aponta para o Redis
- `SM_ADAPTER` — nesta fase o único valor aceito é `mock`
- `SEED` — `true` carrega `infra/seed/seed.sql`
- `SESSION_TTL_HOURS` — validade das sessões opacas
- `SESSION_CREATE_LIMIT`, `MESSAGE_LIMIT`, `RATE_WINDOW_MS` — limite em memória por processo. O padrão é 1000 ações em 60 segundos. Várias instâncias não compartilham esse contador.
- `PRESENCE_STALE_MS` — janela do heartbeat do agente. O padrão é 45000. O console envia `presence.heartbeat` a cada 15 segundos.

## Demonstração da central

Com o Compose no ar e o build publicado em `http://localhost:3000`:

1. Abra `http://localhost:8090` em duas janelas anônimas e entre na fila Suporte do Site A.
2. No console (`http://localhost:3000/console/`), entre como `ana@tenant-a.local` e, em outra janela, como `bruno@tenant-a.local`. Senha `demo-pass-123`.
3. Cada agente assume um visitante. As duas conversas seguem ao mesmo tempo. Uma mensagem na conversa que não está aberta aparece no contador.
4. Ana transfere o atendimento para Vendas e assume de novo nessa fila.
5. Ana encerra com uma classificação. O widget mostra a pesquisa. A devolução à fila e a transferência não mostram pesquisa.
6. Carla (`carla@tenant-b.local`) não vê a conversa do tenant A. Dois agentes que tentam assumir o mesmo visitante: só um recebe o atendimento.

O tenant B também tem Suporte e Vendas. O limite padrão é 3 atendimentos por agente. Transferência direta para outro agente continua fora desta fase.

As senhas de banco do `.env.example` são exclusivas do ambiente local.
