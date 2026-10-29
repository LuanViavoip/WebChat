# Changelog da documentação

## 2026-10-29 — Fase 5.5: redesign do console, widget corrigido e demo no site

- Novos documentos em `docs/fase-5.5/`: `DEMO_SITE_LOCAL.md` (serviços, portas, variáveis, origens pelo admin e roteiro de teste), `DESIGN_SYSTEM.md` (tokens, componentes e padrões) e `RELATORIO.md` (relatório final com testes reais, capturas e pendências).
- Console reescrito sobre um design system próprio (identidade ViaVoip, sidebar e topbar, rotas por hash). Conectividade e presença separadas; Central do Agente, Supervisor, Qualidade, Administração (oito seções), Chat interno, Setores, Anúncios e Atividades redesenhados.
- Widget: o painel nasce fechado quando embutido; o loader calcula a geometria pelo viewport do site (`frame-geometry.ts`), com `window.ViaVoipWebchat.open()/close()`. Causa raiz do recorte no canto documentada em `RELATORIO.md`.
- Novo `scripts/verify-visual.mjs` (cinco viewports, console e widget em :8090 e :3100). `scripts/verify-browser.mjs` ganhou o clique no botão do widget, a aba Filas, o modal "Nova fila" e a confirmação de encerramento.
- Sem mudanças em `apps/server`, `packages/protocol`, migrations e seed.

## 2026-10-28 — Fase 5 (commit `02f5373`)

- Novos módulos no Docs Helper: Gestão Administrativa (papéis, configuração por empresa, comandos idempotentes, auditoria, revogação de sessão) e Qualidade Operacional (política de SLA, relatório de qualidade).
- Nova página de migrations 009–011; Ambientes, Status, Visão geral e Supervisor atualizados.
- Divergências de código registradas: cabeçalho de `009_company_admin.sql` e `docs/fase-5/ARQUITETURA.md` ainda dizem "não aplicada"; a página de auditoria usa 50 entradas embora o contrato aceite 100.
- Publicação no site de teste: **não realizada**. Exige reimportar o ZIP depois do merge, por ordem do responsável.

## 2026-10-27 — Correções e validação da Fase 4

- Atualizados escopos, autenticação, interface e resultados: 62 testes passaram com PostgreSQL e Redis descartáveis.
- Permanece a limitação de entrega de eventos após falha pós-commit; catálogo do banco atualizado até a migration 008.
- Docs Helper de teste atualizado; a página de status foi verificada com 62 testes e a limitação pós-commit.

## 2026-10-27 — Primeira versão

- Código documentado: commit `d65d40d` (Fase 4), branch `docs/webchat-technical-documentation`.
- Documentação de arquitetura, módulos, banco (35 tabelas, dicionário gerado do schema real), 15 diagramas e pacote de importação do Docs Helper (24 páginas, 12 módulos).
- Testes do código no commit: 46 de 46 passaram (ver `docs-helper/VALIDATION.md`).
- Importação no Docs Helper: **não realizada** (ver `docs-helper/PUBLICATION-BLOCKER.md`).
- Observação: havia alterações não commitadas de terceiros em 11 arquivos (correções F4-01/02/05); não documentadas.

## 2026-10-27 — Publicação no Docs Helper

- Importado em `viavoip-docs-test.vercel.app` como sistema "ViaVoip Webchat" (ver `docs-helper/PUBLICATION-BLOCKER.md`), zip sha256 `534b60eeda002e45b641a2fe71a1390ba6c6c307a3d1d507975b0c5abe7c6e01`.
- Pacote completo publicado por autorização explícita; leitura anônima aceita pelo responsável.
- Repositório GitHub (privado): `LuanViavoip/WebChat`; código do WIP de correções em `02a446c` (não validado, fora do escopo documentado).
