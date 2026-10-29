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
- `LOGIN_RATE_LIMIT_SECRET` — obrigatório, ao menos 32 caracteres; use o mesmo segredo aleatório em todas as réplicas. O contador de login é persistido no Postgres e usa HMAC de IP/conta, sem gravar email ou IP em claro.
- `LOGIN_LIMIT`, `RATE_WINDOW_MS` — limite de login por IP e conta e janela compartilhada; padrão 20 tentativas em 60 segundos.
- `SESSION_CREATE_LIMIT`, `MESSAGE_LIMIT` — limites em memória por processo; várias instâncias não compartilham esses contadores.
- `PRESENCE_STALE_MS` — janela do heartbeat do agente. O padrão é 45000. O console envia `presence.heartbeat` a cada 15 segundos.

## Site institucional e dados de demonstração (Fase 5.5)

O site `Site_ViaVoip` usa a porta 3100 (`npx next dev -p 3100`), porque a 3000 é do Webchat. Com `NEXT_PUBLIC_WEBCHAT_URL` e `NEXT_PUBLIC_WEBCHAT_SITE_ID` em `Site_ViaVoip/.env.local`, o site carrega o widget no lugar do botão "Fale agora". É preciso autorizar `http://localhost:3100` e `http://127.0.0.1:3100` em Administração, Sites e Widgets. Roteiro completo: [fase-5.5/DEMO_SITE_LOCAL.md](fase-5.5/DEMO_SITE_LOCAL.md).

`node scripts/demo/populate.mjs` popula o servidor em execução usando só as interfaces públicas (opções `--base-url`, `--site`, `--origin`, `--no-keep-alive`, `--only-keep-alive`, `--fast`). Os scripts de navegador `scripts/verify-browser.mjs` e `scripts/verify-visual.mjs` exigem os containers descartáveis descritos em `.cursor/skills/verify/SKILL.md`; ver [fase-5.5/testes-visuais.md](fase-5.5/testes-visuais.md).

## Demonstração da central

Com o Compose no ar e o build publicado em `http://localhost:3000`:

1. Abra `http://localhost:8090` em duas janelas anônimas e entre na fila Suporte do Site A.
2. No console (`http://localhost:3000/console/`), entre como `ana@tenant-a.local` e, em outra janela, como `bruno@tenant-a.local`. Senha `demo-pass-123`.
3. Cada agente assume um visitante. As duas conversas seguem ao mesmo tempo. Uma mensagem na conversa que não está aberta aparece no contador.
4. Ana transfere o atendimento para Vendas e assume de novo nessa fila.
5. Ana encerra com uma classificação. O widget mostra a pesquisa. A devolução à fila e a transferência não mostram pesquisa.
6. Carla (`carla@tenant-b.local`) não vê a conversa do tenant A. Dois agentes que tentam assumir o mesmo visitante: só um recebe o atendimento.

O widget agora nasce fechado: clique no botão redondo antes de escolher a fila. O tenant B também tem Suporte e Vendas. O limite padrão é 3 atendimentos por agente. Transferência direta para outro agente continua fora desta fase.

As senhas de banco do `.env.example` são exclusivas do ambiente local.
