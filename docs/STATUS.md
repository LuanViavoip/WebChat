# Status de implementação — Fase 5.5

Código de referência: commit `3d9e2cf` (Fase 5.5: redesign do console, correção do widget e demo no site), sobre a Fase 5 (`02f5373`, PR #2 na `main`). Última execução completa em 29 de outubro de 2026, com PostgreSQL e Redis descartáveis: `pnpm test` com **192 testes aprovados** (protocol 11, adaptador SM 2, widget 18, console 61, servidor 100), `pnpm build` sem erros, `scripts/verify-browser.mjs` com saída 0 e `scripts/verify-visual.mjs` com 155 verificações e 0 falhas ([Testes visuais](fase-5.5/testes-visuais.md)). Nada disso comprova entrega durável após falhas nem aprova o uso em produção.

| Área | Estado | Observações |
|---|---|---|
| Multi-tenancy | Implementado e testado | RLS nas tabelas de negócio; controles de tenant, participantes e setor. `login_rate_limits` é global com chaves HMAC e não contém tenant. |
| Autenticação e sessões | Implementado e testado | Argon2id, tokens opacos e limite compartilhado por IP e conta; logout distribuído depende do Redis. |
| Widget e central do agente | Implementados e testados | Filas, claim, transferência, encerramento, pesquisa e reconexão cobertos por testes existentes. Fase 5.5: painel nasce fechado, geometria calculada pelo loader a partir do viewport do site, tela cheia até 640 px, `window.ViaVoipWebchat.open()/close()` e origem validada antes de criar sessão ([geometria e correção do recorte](modules/widget-geometria.md)). |
| Interface do console | Redesenhada na Fase 5.5 | Design system ViaVoip, menu lateral por papel, rotas por hash, conectividade separada da presença. Validada por testes de unidade e pelos scripts de navegador; sem suíte de componentes. Ver [Interface do console](console/navegacao-e-papeis.md) e [Design system](fase-5.5/DESIGN_SYSTEM.md). |
| Chat interno | Implementado e testado | Histórico paginado, reconexão, participantes ativos e coordenação por advisory lock no PostgreSQL. |
| Setores e filas | Implementados e testados | Conceitos distintos; `sector_queues` limita o escopo de supervisão. Ambientes existentes precisam de vínculos corretos. |
| Anúncios e atividades | Implementados, validação parcial | Operações de backend e controles de interface presentes; não há suíte E2E de navegador. |
| Supervisor | Implementado e testado | Consultas e eventos limitados por setor/fila; administrador tem escopo do tenant. |
| Redis | Implementado e testado | Entrega interna e logout entre duas instâncias com Redis descartável. Obrigatório com mais de uma réplica (`REPLICAS` > 1). |
| Gestão administrativa | Implementado e testado | Painel da empresa com oito seções, comandos idempotentes com recibo de 24 h (o console reaproveita o `requestId` ao reenviar o mesmo conteúdo), fuso, sites que nascem pausados e janelas de atendimento; exclusivo do administrador. `GET /auth/me` expõe `canChangeOwnActivity`. Ver [Painel de administração](gestao-administrativa/painel-de-administracao.md) e [Papéis e permissões](gestao-administrativa/papeis-e-permissoes.md). |
| Qualidade operacional | Implementado e testado | Políticas de SLA por fila (com histórico de versões no console) e relatório histórico (p50/p90, abandonos, cobertura de primeira resposta, pesquisa, presença), com período de até 31 dias e escopo por papel. Ver [Política de SLA](qualidade-operacional/politica-de-sla.md). |
| Demo no site institucional | Local, não publicada | O widget roda em `Site_ViaVoip` (porta 3100) com `scripts/demo/populate.mjs` para dados de demonstração. Não há hospedagem nem HTTPS; ver [Demo local](fase-5.5/DEMO_SITE_LOCAL.md). |
| Auditoria | Implementado e testado | Consulta paginada por cursor, só para administrador; escrita e consulta cobrem as ações de gestão. |
| Revogação de sessão | Implementado e testado | Disconnect direto, Redis, `NOTIFY` e varredura em lote (padrão 10 s, teto 15 s). Ver [Revogação de sessão](gestao-administrativa/revogacao-de-sessao.md). |
| Entrega durável de eventos / SM | Pendente | Falha pós-commit pode deixar mensagem persistida sem reenviar o evento; não há outbox/retry. |
| Integração real com SM | Depende de contrato externo | Mock disponível; ausência do contrato real não é defeito desta fase. |

## Auditoria e limitações

As migrations 009 a 011 ([resumo](deployment/migrations-009-011.md)) acrescentam tabelas, colunas e a função de varredura de sessões. Os achados originais da Fase 4 são históricos; as correções e seus limites estão em [FASE4_REVIEW_POS_CORRECOES.md](audits/FASE4_REVIEW_POS_CORRECOES.md). A suíte passou, porém não substitui testes E2E em navegador nem validação de falha de infraestrutura em produção. A entrega pós-commit continua sem garantia durável (F4-07). Revogação entre réplicas exige Redis; a coordenação de mensagens de grupo requer PostgreSQL compartilhado. Eventos autorizados antes da remoção podem chegar posteriormente por atraso de transporte.

## Pendências conhecidas da Fase 5.5

`MAX_QUALITY_WINDOW_MS` não é exportado pelo pacote de protocolo (o console repete 31 dias); o schema de `resize` do protocolo não tem campo de modo; a seleção de responsáveis de setor parte de pessoas já listadas, pois não há endpoint que liste todas; `verify-browser.mjs` exige containers recém-criados. Lista completa no [relatório da Fase 5.5](fase-5.5/RELATORIO.md).
