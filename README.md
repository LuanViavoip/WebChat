# ViaVoip Webchat

Webchat multi-tenant distribuído como widget. Cobre o canal de atendimento, o isolamento entre tenants, a central do agente, o chat interno, setores, anúncios, presença e atividades, a supervisão, a administração da empresa e a qualidade operacional, com um adaptador mock do SM. Estado atual: **Fase 5.5** (console redesenhado sobre o design system ViaVoip, widget corrigido e demo no site institucional); ver [docs/STATUS.md](docs/STATUS.md).

## Subir localmente

```bash
docker compose up --build
```

- Widget e API: http://localhost:3000
- Console (agente, supervisão e administração): http://localhost:3000/console/
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

A suíte sobe PostgreSQL e Redis descartáveis, aplica as migrations, carrega o seed e cobre isolamento, concorrência, reconexão, mensagens e comunicação entre réplicas. Uma falha pós-commit ainda pode impedir a entrega de eventos.

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

## Demonstração

1. Abra http://localhost:8090 e o console em http://localhost:3000/console/.
2. No site, abra o chat, escolha Suporte e envie uma mensagem.
3. Entre como Ana, assuma a conversa e responda.
4. Encerre com uma classificação. A pesquisa aparece no widget.
5. Envie a nota. A conversa fica encerrada.
6. Entre como Carla e confirme que a conversa do tenant A não aparece.
7. Entre como Ana e abra Chat interno. A direta com Sofia e o grupo Suporte Técnico já têm histórico.
8. Entre como Sofia em outro navegador. A Visão geral mostra presença, fila e a atividade de Eduardo. Publique um anúncio do Suporte e aloque Ana em Atendimento.
9. Entre como Renata e confirme que os setores e anúncios do tenant A não aparecem.

## Resultados da verificação

Executado em 29 de outubro de 2026 sobre o commit `3d9e2cf` (Fase 5.5).

- `pnpm test` passou com 192 testes: 11 do protocol, 2 do adaptador SM, 18 do widget, 61 do console e 100 do servidor. A suíte do servidor sobe um Postgres descartável e cobre isolamento, setores, chat interno, anúncios, presença, atividades, supervisão, gestão da empresa, qualidade e revogação de sessão. `pnpm build` terminou sem erros.
- `scripts/verify-browser.mjs` terminou com saída 0 e `scripts/verify-visual.mjs` registrou 155 verificações, 0 falhas e 0 erros de console, em containers descartáveis.

Registro da verificação da Fase 4 (27 de outubro de 2026):
- A API, o widget e o console sobem em http://localhost:3000; a página cliente, em http://localhost:8090. O Postgres do Compose fica na porta 5434 do host.
- No navegador, `http://127.0.0.1:8090` carregou `/widget.js` com `data-widget-id="site_a"`, montou um único iframe e concluiu `GET /public/widgets/site_a` e `POST /visitor/sessions`. No console, Ana viu a presença, assumiu a conversa da fila Suporte, respondeu e devolveu à fila; a lista passou a mostrar `posição 1`.
- O mock registra fila, atribuição, devolução, transferência e encerramento. A saída do visitante antes do atendimento não notifica o SM.
