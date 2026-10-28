---
name: verify
description: Verifica o WebChat em ambiente local descartável, incluindo isolamento, supervisão, revogação e fluxo completo no navegador.
---

# Verificar o WebChat localmente

Use apenas banco, Redis e contas de demonstração descartáveis. Não use produção, deploy ou merge. O roteiro do navegador altera dados, suspende uma conta e cria filas: recrie os containers antes de cada execução. Não imprima nem registre tokens ou senhas. As evidências são dados sintéticos em `/tmp/webchat-verify-artifacts`.

## Serviços descartáveis

No diretório raiz, inicie containers locais sem volumes persistentes. Escolha uma senha temporária para `POSTGRES_PASSWORD` e guarde-a apenas na sessão do shell. Verifique que as portas 3000, 8090, 55439 e 56379 estão livres antes de começar.

```bash
export POSTGRES_PASSWORD='<senha-temporaria-local>'
docker run -d --rm --name webchat-verify-pg -e POSTGRES_PASSWORD -e POSTGRES_DB=webchat -p 127.0.0.1:55439:5432 postgres:16-alpine
docker run -d --rm --name webchat-verify-redis -p 127.0.0.1:56379:6379 redis:7-alpine
docker run -d --rm --name webchat-verify-nginx --network host -v "$PWD/infra/nginx-demo.conf:/etc/nginx/nginx.conf:ro" -v "$PWD/infra/demo:/workspace/infra/demo:ro" nginx:1.27-alpine
```

Configure `DATABASE_URL` para o papel local criado pela migration, `MIGRATE_DATABASE_URL` para o usuário administrador do container e `REDIS_URL=redis://127.0.0.1:56379`. Ambas as URLs de Postgres devem usar `127.0.0.1:55439` e o banco `webchat`. Defina `SM_ADAPTER=mock`, um `LOGIN_RATE_LIMIT_SECRET` temporário de pelo menos 32 caracteres, `HOST=127.0.0.1`, `LOGIN_LIMIT=10000`, `SESSION_REVOKE_SWEEP_MS=500`, `LOG=false` e `SEED=true`.

```bash
pnpm build
pnpm --filter @viavoip/server exec tsx src/main.ts
```

O servidor aplica migrations e seed somente nesse banco descartável. `infra/nginx-demo.conf` escuta na porta 8090 e o container monta a demo no caminho `/workspace` esperado pela configuração. Não aponte o servidor ou o script de verificação para banco existente.

## Suítes e regressões existentes

```bash
pnpm test
pnpm build
```

`pnpm test` executa protocol, adapter, widget, console e server; o servidor usa PostgreSQL descartável do Testcontainers. Para os exercícios existentes de fase 5 e revogação, leia `apps/server/scripts/verify-fase5.ts` e `apps/server/scripts/verify-revoke-paths.ts`; execute-os apenas com as URLs do banco e Redis descartáveis, respeitando as portas e condições de cada script.

## Navegador e supervisão

Instale Playwright em `/tmp/webchat-verify-pw`, com um Chromium headless compatível, e mantenha o servidor e os containers acima ativos. No shell com as mesmas variáveis de conexão do servidor:

```bash
mkdir -p /tmp/webchat-verify-pw
npm install --prefix /tmp/webchat-verify-pw playwright@1.59.1
/tmp/webchat-verify-pw/node_modules/.bin/playwright install chromium
export PLAYWRIGHT_PACKAGE_JSON=/tmp/webchat-verify-pw/package.json
export VERIFY_POSTGRES_CONTAINER=webchat-verify-pg
export VERIFY_INSPECT_ROOMS=true
node scripts/verify-browser.mjs
```

O roteiro recusa conexões a bancos e Redis fora das portas locais acima. Ele abre sessões simultâneas de Sofia e Ana no setor Suporte, Helena e Diana no outro setor da empresa A, Renata na empresa B e Otávio como administrador. Confere lista, agente, status, espera, histórico e mensagens em tempo real; verifica que o outro setor e empresa não recebem eventos nem acessam o histórico; e mantém a regressão de assumir, responder, encerrar e avaliar pelo widget. Confere mensagens e eventos no PostgreSQL. A janela de encerrados usa timestamps sintéticos de 23 e 25 horas no banco descartável.

Uma segunda instância local do servidor usa o Redis descartável para inspecionar as rooms entre réplicas. Após a suspensão, o roteiro confirma a saída da room, a recusa do token antigo e a continuidade das demais sessões, enviando outra mensagem. Ele grava capturas e `browser-evidence.json` no diretório configurável `VERIFY_ARTIFACTS` (padrão `/tmp/webchat-verify-artifacts`). Saída diferente de zero indica falha.

Ao terminar, encerre o servidor e remova somente os containers criados para a prova:

```bash
docker stop webchat-verify-nginx webchat-verify-redis webchat-verify-pg
```
