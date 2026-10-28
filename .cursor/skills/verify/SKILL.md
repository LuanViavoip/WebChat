---
name: verify
description: Sobe o WebChat só com Postgres e Redis locais e exercita isolamento, permissões, idempotência, revogação de sessão, calendário, SLA e regressão. Use para verificar a fase 5 ou repetir a prova ponta a ponta.
---

# Verificar o WebChat localmente

Não use ambiente real, produção, deploy nem merge. Postgres e Redis ficam na própria máquina. A suíte `pnpm test` sobe um Postgres descartável via Docker; o exercício manual usa o Postgres e o Redis instalados no host.

## Serviços

Postgres 16 e Redis 7 no host, sem systemd:

```bash
sudo pg_ctlcluster 16 main start
sudo redis-server --daemonize yes --bind 127.0.0.1 --port 6379 --protected-mode yes
```

O papel `postgres` local precisa de senha para conexão TCP. A migration cria `webchat_app`.

```bash
sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'postgres';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='webchat'" | grep -q 1 || sudo -u postgres createdb webchat
```

Variáveis, todas locais:

```bash
export DATABASE_URL=postgres://webchat_app:webchat_app@127.0.0.1:5432/webchat
export MIGRATE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/webchat
export REDIS_URL=redis://127.0.0.1:6379
export SM_ADAPTER=mock
export LOGIN_RATE_LIMIT_SECRET=local-only-shared-login-rate-limit-secret-change-before-deploy
export REPLICAS=2
export SESSION_REVOKE_SWEEP_MS=120000
```

## Suíte

Docker é necessário porque `apps/server/test/global-setup.ts` usa Testcontainers. Com o daemon no socket:

```bash
pnpm test
```

A suíte aplica todas as migrations, inclusive `009_company_admin.sql` e `010_receipt_expiry.sql`, e cobre o isolamento anterior mais os testes de HTTP, auditoria, qualidade e revogação entre réplicas.

## Exercício ponta a ponta

Com Postgres e Redis no ar e as dependências instaladas (`pnpm install`):

```bash
pnpm --filter @viavoip/server exec tsx scripts/verify-fase5.ts
```

O script:

1. Aplica as migrations e o seed se o banco estiver vazio. `migrate()` percorre `apps/server/migrations`. A 009 cria RLS, SLA, calendário, época de sessão e recibo. A 010 acrescenta `expires_at` ao recibo; o servidor grava essa coluna, então parar na 009 deixa o comando administrativo quebrado.
2. Sobe duas instâncias em `127.0.0.1:3000` e `127.0.0.1:3001`, com Redis e varredura de sessão em 120s, para a queda do socket não depender do timer.
3. Exercita widget, fila, chat interno, setores, atividades e o painel do supervisor, e confere que a outra empresa não recebe o evento.
4. Chama as rotas novas sem token, com visitante, agente, supervisora e administrador.
5. Dispara o mesmo `requestId` duas vezes ao mesmo tempo, reinicia a instância e repete o pedido.
6. Revoga a sessão de um agente pela instância 3000 e mede a queda do socket na 3001. O socket da outra empresa permanece.
7. Confere a próxima abertura em `America/New_York` na virada e no retorno do horário de verão, e recusa `conversation.start` fora da janela.
8. Lê `GET /quality/report` com uma amostra conhecida: esperas 10, 20 e 40 segundos (p50 20, p90 40) e mostra que a política posterior, de limiar 1s, não rejulga o período anterior. A auditoria sem `from`/`to` não devolve o evento de 48 horas nem a senha.

O script encerra as duas instâncias ao terminar. Saída diferente de zero é falha do exercício.
