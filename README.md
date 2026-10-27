# ViaVoip Webchat

Webchat multi-tenant distribuído como widget. A fase 1 cobre o canal de atendimento, o isolamento entre tenants e um adaptador mock do SM.

## Subir localmente

```bash
docker compose up --build
```

- Widget e API: http://localhost:3000
- Console do agente: http://localhost:3000/console/
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

## Testes

```bash
pnpm test
```

A suíte sobe PostgreSQL e Redis descartáveis, aplica as migrations, carrega o seed e cobre isolamento, concorrência, reconexão, mensagens e comunicação entre réplicas. Uma falha pós-commit ainda pode impedir a entrega de eventos.

## Documentação

- [Arquitetura](docs/architecture.md)
- [Contratos](docs/contracts.md)
- [Decisões](docs/decisions.md)
- [Desenvolvimento local](docs/local-development.md)
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

Executado em 27 de outubro de 2026.

- `pnpm test` passou: 5 testes do protocol, 2 do adaptador SM, 3 do console e 52 do servidor. A suíte do servidor sobe um Postgres descartável e cobre o isolamento da Fase 3 mais setores, chat interno, anúncios, presença, atividades e o escopo do supervisor.
- A API, o widget e o console sobem em http://localhost:3000; a página cliente, em http://localhost:8090. O Postgres do Compose fica na porta 5434 do host.
- No navegador, `http://127.0.0.1:8090` carregou `/widget.js` com `data-widget-id="site_a"`, montou um único iframe e concluiu `GET /public/widgets/site_a` e `POST /visitor/sessions`. No console, Ana viu a presença, assumiu a conversa da fila Suporte, respondeu e devolveu à fila; a lista passou a mostrar `posição 1`.
- O mock registra fila, atribuição, devolução, transferência e encerramento. A saída do visitante antes do atendimento não notifica o SM.
