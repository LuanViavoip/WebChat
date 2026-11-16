# ViaVoip Webchat

Webchat multi-tenant distribuído como widget. Cobre o canal de atendimento, o isolamento entre tenants, a central do agente, o chat interno, setores, anúncios, presença e atividades, a supervisão, a administração da empresa e a qualidade operacional, com um adaptador mock do SM. Estado atual: **Fase 5.5** (console redesenhado sobre o design system ViaVoip, widget corrigido e demo no site institucional), `main` em `ed89e11` (`d94be4a` mais o PR #7); ver [docs/STATUS.md](docs/STATUS.md).

## Subir localmente

```bash
docker compose up --build
```

- Widget e API: http://localhost:3000
- Console (agente, supervisão e administração): http://localhost:3000/console/
- Chat interno (`apps/internal`, só com dados simulados): http://localhost:3000/chat/
- Página de um site cliente: http://localhost:8090

Contas locais, senha `demo-pass-123`:

- `ana@tenant-a.local` — agente do tenant A, filas Suporte e Vendas, setores Suporte Técnico e Comercial
- `bruno@tenant-a.local` — agente do tenant A, fila Suporte, setor Suporte Técnico
- `diana@tenant-a.local` — agente do tenant A, fila Vendas, setor Comercial, pode alterar a própria atividade
- `eduardo@tenant-a.local` — agente do tenant A, fila Suporte, presença desejada ausente, atividade Treinamento
- `sofia@tenant-a.local` — supervisora do Suporte Técnico
- `helena@tenant-a.local` — supervisora do Comercial
- `otavio@tenant-a.local` — administrador do tenant A
- `carla@tenant-b.local` — agente do tenant B
- `tiago@tenant-b.local` — agente do tenant B
- `renata@tenant-b.local` — supervisora do tenant B

O script de instalação do site A é:

```html
<script async src="http://localhost:3000/widget.js" data-widget-id="site_a"></script>
```

## Console e widget (Fase 5.5)

- O console tem menu lateral por papel (agente, supervisor, administrador), rotas por hash (`#/atendimentos`, `#/qualidade`, `#/administracao`) e separa a conectividade (chip do topo) da presença (controle próprio). Tokens e componentes estão em [docs/fase-5.5/DESIGN_SYSTEM.md](docs/fase-5.5/DESIGN_SYSTEM.md).
- O widget nasce fechado, o loader calcula a posição pelo viewport do site e há tela cheia até 640 px. O site pode chamar `window.ViaVoipWebchat.open()` e `.close()` e ajustar a posição com `data-offset-bottom`, `data-offset-right`, `data-offset-bottom-var` e `data-offset-right-var`. Detalhes em [docs/modules/widget.md](docs/modules/widget.md).
- A origem do site precisa estar autorizada em Administração, Sites e Widgets (uma por linha, sem caminho).

## Chat interno (`apps/internal`)

O `apps/internal` é o app do sm-webchat (React, interface estilo WhatsApp Web), importado com `git subtree` e histórico preservado. O pacote é `@viavoip/internal` e o servidor o serve em `/chat/` (o Vite usa `base: '/chat/'`).

**Ele roda só com dados simulados.** O `MockTransport` guarda tudo no `localStorage` do navegador. O `/chat/` ainda não fala com o servidor: não usa `/auth/login`, Postgres nem Socket.IO. Ligar o app ao servidor é trabalho das etapas seguintes do [plano de fusão](docs/fusao/plano-fusao.md).

```bash
pnpm --filter @viavoip/internal dev        # o Vite mostra a URL (termina em /chat/)
pnpm --filter @viavoip/internal lint
pnpm --filter @viavoip/internal test       # Vitest
pnpm --filter @viavoip/internal test:e2e   # Playwright, 4 projects, com axe
```

Na primeira vez, instale o navegador do Playwright: `pnpm --filter @viavoip/internal exec playwright install chromium`. O `test:e2e` sobe o Vite na porta 4177 e regrava as capturas rastreadas em `apps/internal/docs/screenshots/`; descarte a mudança com `git checkout -- apps/internal/docs/screenshots` se não quiser versioná-la. A documentação do app fica em `apps/internal/README.md` e `apps/internal/docs/`.

## Demo no site institucional

Para ver o widget dentro de `Site_ViaVoip` (porta 3100) e atender pelo console, siga [docs/fase-5.5/DEMO_SITE_LOCAL.md](docs/fase-5.5/DEMO_SITE_LOCAL.md). Para encher um servidor em execução com conversas, comunicados, SLA e atividades de demonstração, sem mexer no banco:

```bash
node scripts/demo/populate.mjs                  # popula e mantém os agentes conectados
node scripts/demo/populate.mjs --no-keep-alive  # popula e encerra
```

## Testes

```bash
pnpm test
```

O `pnpm test` da raiz roda o Vitest de todos os pacotes, incluindo o do `apps/internal`. Ele não roda o Playwright.

A suíte sobe PostgreSQL e Redis descartáveis, aplica as migrations, carrega o seed e cobre isolamento, concorrência, reconexão, mensagens e comunicação entre réplicas. Uma falha pós-commit ainda pode impedir a entrega de eventos.

O `pnpm typecheck` roda `tsc --noEmit` em todos os pacotes e só cobre `src`; os testes não são checados por tipo. O workflow `.github/workflows/ci.yml` roda `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm build` e `pnpm test` em cada pull request e em cada push na `main`, com Node 22 e o pnpm de `packageManager`. Não há `services:` no workflow: o servidor sobe PostgreSQL e Redis por Testcontainers no runner. O workflow tem um segundo job, `internal`, com lint do app interno, o gate de hex (nenhuma cor em hexadecimal em `apps/internal/src`, exceto `styles/chat.css`, `styles/contrast.ts` e `styles/contrast.test.ts`) e o Playwright do app. Detalhes em [docs/deployment/environments.md](docs/deployment/environments.md).

Verificações em navegador (Playwright, com containers descartáveis recém-criados; passo a passo em `.cursor/skills/verify/SKILL.md` e [docs/fase-5.5/testes-visuais.md](docs/fase-5.5/testes-visuais.md)):

```bash
node scripts/verify-browser.mjs   # isolamento, supervisão, revogação, idempotência e fluxo do widget
node scripts/verify-visual.mjs    # cinco viewports, console e widget em :8090 e :3100
```

## Documentação

- [Arquitetura](docs/architecture.md)
- [Contratos](docs/contracts.md)
- [Decisões](docs/decisions.md)
- [Desenvolvimento local](docs/local-development.md)
- [Documentação técnica (Docs Helper)](docs/README.md) e [relatório da Fase 5.5](docs/fase-5.5/RELATORIO.md)
- [Integração com o SM](docs/sm-integration.md)
- [Plano de fusão com o chat interno](docs/fusao/plano-fusao.md)

## Demonstração

1. Abra http://localhost:8090 e o console em http://localhost:3000/console/.
2. No site, abra o chat, informe seu nome, escolha Suporte e envie uma mensagem.
3. Entre como Ana, assuma a conversa e responda.
4. Encerre com uma classificação. A pesquisa aparece no widget.
5. Envie a nota. A conversa fica encerrada.
6. Entre como Carla e confirme que a conversa do tenant A não aparece.
7. Entre como Ana e abra Chat interno. A direta com Sofia e o grupo Suporte Técnico já têm histórico.
8. Entre como Sofia em outro navegador. A Visão geral mostra presença, fila e a atividade de Eduardo. Publique um anúncio do Suporte e aloque Ana em Atendimento.
9. Entre como Renata e confirme que os setores e anúncios do tenant A não aparecem.

## Resultados da verificação

Testes executados em 16 de novembro de 2026 sobre `main` em `ed89e11`: o `d94be4a` (Fase 5.5 mais os PRs #5 e #6) mais o PR #7 (`typecheck`, CI e `GET /version`).

- `pnpm typecheck` e `pnpm build` terminaram sem erros, e `pnpm test` passou com 195 testes: 11 do protocol, 2 do adaptador SM, 19 do widget, 61 do console e 102 do servidor. Depois da importação do `apps/internal` (F2, 16/11/2026), a contagem é 1530: os mesmos 11, 2, 19 e 61, o servidor com 107 (5 novos, de `static.test.ts`) e 1330 do app interno (53 arquivos). O Playwright do app roda à parte: 159 passam e 97 são pulados (256 no total, 64 por project). A suíte do servidor sobe um Postgres descartável e cobre isolamento, setores, chat interno, anúncios, presença, atividades, supervisão, gestão da empresa, qualidade e revogação de sessão.
- Não executados de novo em 16/11/2026. O último registro é de 29 de outubro de 2026 sobre `3d9e2cf` (Fase 5.5): `scripts/verify-browser.mjs` terminou com saída 0 e `scripts/verify-visual.mjs` registrou 155 verificações, 0 falhas e 0 erros de console, em containers descartáveis.

Registro da verificação da Fase 4 (27 de outubro de 2026):
- A API, o widget e o console sobem em http://localhost:3000; a página cliente, em http://localhost:8090. O Postgres do Compose fica na porta 5434 do host.
- No navegador, `http://127.0.0.1:8090` carregou `/widget.js` com `data-widget-id="site_a"`, montou um único iframe e concluiu `GET /public/widgets/site_a` e `POST /visitor/sessions`. No console, Ana viu a presença, assumiu a conversa da fila Suporte, respondeu e devolveu à fila; a lista passou a mostrar `posição 1`.
- O mock registra fila, atribuição, devolução, transferência e encerramento. A saída do visitante antes do atendimento não notifica o SM.
