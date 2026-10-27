# Changelog da documentação

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
