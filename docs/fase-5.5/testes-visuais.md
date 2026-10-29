# Testes visuais

Código de referência: Fase 5.5. Fontes: `scripts/verify-visual.mjs`, `scripts/verify-browser.mjs`, `scripts/demo/populate.mjs`, `.cursor/skills/verify/SKILL.md`. Os testes automatizados do repositório (`pnpm test`) não abrem navegador; estes scripts completam a verificação com Playwright (Chromium) sobre um ambiente descartável.

## Pré-requisitos

- Containers descartáveis de PostgreSQL 16 (`webchat-verify-pg`), Redis 7 e nginx (página demo na 8090), sem volumes, e o servidor local em `127.0.0.1:3000` com `SEED=true`. O passo a passo está em `.cursor/skills/verify/SKILL.md`.
- Playwright instalado fora do repositório; o script lê o caminho de `PLAYWRIGHT_PACKAGE_JSON`.
- Opcional: o site institucional em `http://localhost:3100` com o widget ativado e a origem autorizada ([Demo local no site institucional](DEMO_SITE_LOCAL.md)).
- `VERIFY_POSTGRES_CONTAINER=webchat-verify-pg` é obrigatório: o script recusa rodar contra outro banco.

Use containers recém-criados a cada execução: o `verify-browser.mjs` suspende uma conta e cria filas.

## Comandos

```bash
export PLAYWRIGHT_PACKAGE_JSON=/tmp/webchat-verify-pw/package.json
export VERIFY_POSTGRES_CONTAINER=webchat-verify-pg VERIFY_INSPECT_ROOMS=true
node scripts/verify-browser.mjs     # fluxo completo, isolamento, revogação, idempotência
node scripts/verify-visual.mjs      # cinco viewports, console e widget em :8090 e :3100
```

Variáveis opcionais do `verify-visual.mjs`: `VERIFY_VISUAL_OUT` (pasta das capturas; padrão `artifacts/visual/depois`, ignorada pelo git) e `VERIFY_VISUAL_HOSTS` (hosts do widget, padrão `8090,3100`; use `8090` quando o site não estiver no ar).

## `verify-visual.mjs`

Roda nos viewports 1920×1080, 1366×768, 768×1024, 390×844 e 375×667, com o console e o widget em cada host. Confere:

- ausência de rolagem horizontal;
- iframe do widget e compositores (agente e visitante) dentro do viewport;
- botão do widget com 88×88 px e acima do banner de cookies, quando houver;
- painel em tela cheia até 640 px de largura;
- origem não autorizada: o iframe permanece 88×88 e o botão fica inerte;
- foco visível ao navegar por Tab no menu lateral e dentro de um modal;
- nenhuma mensagem de erro no console do navegador.

O script também executa o fluxo da demo em cada viewport: abrir o botão, escolher o departamento, entrar na fila, o agente assumir, trocar mensagens, encerrar com classificação e responder a pesquisa. Cada verificação é contada; qualquer falha encerra o processo com saída diferente de zero.

## `verify-browser.mjs`

Cobre o isolamento entre empresas e setores, a supervisão ao vivo, a revogação de sessão, a idempotência do reenvio de comandos pelo console e o fluxo completo do widget. Na Fase 5.5 ganhou o clique no botão do widget (o painel agora nasce fechado), a aba **Filas** e o botão **Nova fila** antes do formulário, e a confirmação do diálogo de encerramento. Os `data-testid` e os rótulos do menu são contrato com o script (ver [Design system](DESIGN_SYSTEM.md)).

## `populate.mjs`

Enche um servidor já em execução com conversas, comunicados, setor, SLA e atividades realistas usando só as interfaces públicas (HTTP e socket.io). É para demonstração, não para teste: ver [Demo local no site institucional](DEMO_SITE_LOCAL.md).

## Resultado da última execução completa

| Verificação | Resultado |
|---|---|
| `pnpm test` na raiz | **192 passaram**: protocol 11, adaptador SM 2, widget 18, console 61 e servidor 100 |
| `pnpm build` | Sem erros nos cinco pacotes |
| `verify-browser.mjs` | Saída 0 em containers recém-criados |
| `verify-visual.mjs` | **155 verificações, 0 falhas, 0 erros de console** |

## Capturas

As capturas ficam em `artifacts/visual/` (fora do git): `antes/`, `depois/` e, por host e viewport, `visual-<porta>-<viewport>-<tela>.png`. Não fazem parte do pacote do Docs Helper.
