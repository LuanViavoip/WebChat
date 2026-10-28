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
export SESSION_REVOKE_SWEEP_MS=10000
```

## Suíte

Docker é necessário porque `apps/server/test/global-setup.ts` usa Testcontainers. Com o daemon no socket:

```bash
pnpm test
```

A suíte aplica todas as migrations, inclusive `009_company_admin.sql`, `010_receipt_expiry.sql` e `011_staff_sessions_alive.sql`, e cobre o isolamento anterior mais os testes de HTTP, auditoria, qualidade e revogação entre réplicas.

## Exercício ponta a ponta

Com Postgres e Redis no ar e as dependências instaladas (`pnpm install`):

```bash
pnpm --filter @viavoip/server exec tsx scripts/verify-fase5.ts
```

O script:

1. Aplica as migrations e o seed se o banco estiver vazio. `migrate()` percorre `apps/server/migrations`. A 009 cria RLS, SLA, calendário, época de sessão e recibo. A 010 acrescenta `expires_at` ao recibo; o servidor grava essa coluna, então parar na 009 deixa o comando administrativo quebrado.
2. Sobe duas instâncias em `127.0.0.1:3000` e `127.0.0.1:3001`, com Redis e a varredura desligada no `buildApp`, para a queda do socket provar o caminho imediato.
3. Exercita widget, fila, chat interno, setores, atividades e o painel do supervisor, e confere que a outra empresa não recebe o evento.
4. Chama as rotas novas sem token, com visitante, agente, supervisora e administrador.
5. Dispara o mesmo `requestId` duas vezes ao mesmo tempo, reinicia a instância e repete o pedido.
6. Revoga a sessão de um agente pela instância 3000 e mede a queda do socket na 3001. O socket da outra empresa permanece.
7. Confere a próxima abertura em `America/New_York` na virada e no retorno do horário de verão, e recusa `conversation.start` fora da janela.
8. Lê `GET /quality/report` com uma amostra conhecida: esperas 10, 20 e 40 segundos (p50 20, p90 40) e mostra que a política posterior, de limiar 1s, não rejulga o período anterior. A auditoria sem `from`/`to` não devolve o evento de 48 horas nem a senha.

O script encerra as duas instâncias ao terminar. Saída diferente de zero é falha do exercício.

## Página demo na porta 8090

O pacote `nginx` não sobe sozinho nesta VM: o `postinst` chama `invoke-rc.d`, e o `policy-rc.d` recusa o start porque não há runlevel do systemd. O binário está em `/usr/sbin/nginx`. Suba com a configuração do repositório, que escuta só em `127.0.0.1:8090` e serve `infra/demo`:

```bash
sudo apt-get install -y nginx
sudo nginx -c /workspace/infra/nginx-demo.conf
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8090/
```

Para trocar a configuração: `sudo nginx -c /workspace/infra/nginx-demo.conf -s reload`. Para encerrar: `sudo nginx -c /workspace/infra/nginx-demo.conf -s stop`.

O console e o widget saem do próprio servidor, em `http://127.0.0.1:3000/console/` e `/widget.js`. Antes disso, `pnpm --filter @viavoip/widget build` e `pnpm --filter @viavoip/console build`.

## Navegador

Com a demo e o servidor no ar:

```bash
mkdir -p /tmp/pw && cd /tmp/pw && npm install playwright@1.56.1 && npx playwright install chromium
node /workspace/scripts/verify-browser.mjs
```

O script abre `http://localhost:8090/`, confere o iframe do widget e grava capturas em `/opt/cursor/artifacts/screenshots/`. No console, Ana não vê Administração nem Qualidade; Sofia vê Qualidade e não vê Administração; Otávio vê as duas. Chamadas `fetch` feitas na página, com o token da sessão, recebem 403 no comando e na auditoria para a agente, e 403 no comando e no relatório da empresa para a supervisora. A fila que ela supervisiona responde 200.

O botão Criar fila usa `submitCompanyCommand`. A primeira `POST /company/commands` é abortada depois do timeout de 2s; a segunda leva o mesmo `requestId`. O banco fica com uma fila e um evento `queue.create`.

O mesmo script segue com três contextos ao mesmo tempo. O visitante abre Suporte na demo e manda uma mensagem. Ana vê o contato na fila, assume, responde e encerra com a classificação Resolvido. O widget mostra a resposta, a pesquisa e o texto de encerramento. Sofia, na Visão geral, vê Na fila, Em atendimento (Ana com 1 atendimento), Na pesquisa e Concluídos mudarem sem recarregar. O Postgres guarda a conversa `closed`, as duas mensagens e os eventos `queued`, `assigned`, `classified`, `survey_submitted` e `closed`. As capturas `01-fila-*` até `06-encerrado-*` ficam em `/opt/cursor/artifacts/screenshots/`.

O painel aberto pede 380×640. O iframe nasce com 72×72; medir essa largura faria o widget pedir de novo 72×72 e a conversa ficaria cortada. O loader limita o pedido à janela de verdade da página.

## Revogação isolada

Os caminhos de revogação não se desligam por variável de ambiente. O script sobe o processo com `scripts/boot-app.ts`: Redis sem `LISTEN` (`--no-notify --no-sweep`) e `NOTIFY` sem disconnect direto (`--no-direct --no-sweep`). Em produção os três caminhos ficam ligados.

```bash
pnpm --filter @viavoip/server exec tsx scripts/verify-revoke-paths.ts
```

1. Duas instâncias com Redis e sem listener. A revogação numa derruba o socket da outra. O número de `LISTEN webchat_session_revoke` não aumenta.
2. Uma instância sem `REDIS_URL` e sem o disconnect direto. Só o `NOTIFY` derruba o socket.

Nos dois casos o script mede a latência até o `disconnect`, abre uma conversa na fila e confirma que o socket revogado não recebe `conversation.updated`, recusa a reconexão com o mesmo token e mantém a Carla conectada, ainda dentro do chat interno. `auth_epoch` sobe uma unidade.
