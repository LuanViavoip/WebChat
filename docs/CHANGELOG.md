# Changelog da documentação

## 2026-11-17 — F4: modelo N:N de ilhas (C2) e origem dos grupos (C6)

- `packages/internal-domain` e `apps/internal` (nenhuma linha de servidor, protocolo, migration ou seed SQL). `Agent.ilhaId` virou `ilhaIds` (ao menos uma, sem repetição), `Ilha.supervisorId` virou `supervisorIds`, e `GroupConversation` troca `createdBy`/`ilhaId` por `origin` (`ilha` ou `custom`). `inManagementScope` vale para ALGUMA ilha do supervisor; `supervisorOf` virou `supervisorsOf`; `conversationTier` e o escopo do `grantLog` seguem o mesmo critério.
- "Mover" virou acrescentar/remover vínculo: `addAgentToIlha`, `removeAgentFromIlha` e `unassignIlhaSupervisor` (domínio, `MockServer`, `ChatTransport`, `ChatSession` e UI). `moveAgent` e `canMoveAgentIn` saíram. Atribuir supervisor à ilha e cadastrar supervisor "nas ilhas X" passaram a ACRESCENTAR. Regras e escolhas conservadoras em `docs/decisions.md` (seção "F4").
- Seed do mock: Ana em Norte e Sul, ilha Plantão com dois supervisores (Carla e Rafael) e Fábio em Exames e Plantão. `localStorage` do mock na versão 5: estado 1:1 antigo (v4/v3/v2) é migrado; estado incoerente é descartado.
- Testes novos: `ilhaNN.test.ts`, `cardinalityMigration.test.ts`, matriz N:N em `capabilities.test.ts`, P5 e P6 sobre diretórios N:N arbitrários (`testing/directoryArb.ts`). Asserções alteradas listadas no relatório da F4 (cardinalidade e seed apenas).
- `pnpm test`: 1653 testes (pacote de domínio 912 em 11 arquivos, app interno 541 em 44; protocol 11, adaptador SM 2, widget 19, console 61, servidor 107). Playwright do app: 159 passam e 97 pulados (1366 42/22, 1920 48/16, 2560 30/34, 390 39/25), sem flaky. Os PNGs de `apps/internal/docs/screenshots` foram regravados pelo e2e e descartados (não recapturados).

## 2026-11-16 — F3: pacote `@viavoip/internal-domain`

- `apps/internal/src/domain/*` (11 módulos de código e 10 testes) movido com `git mv` para `packages/internal-domain/src`, sem mudança de lógica, tipos ou asserções. `src/index.ts` reexporta todos os módulos; o app importa de `@viavoip/internal-domain`. `apps/internal/src/domain` deixou de existir.
- `src/test/domainFixtures.ts` foi para `packages/internal-domain/src/testing/` e sai pelo subpath `@viavoip/internal-domain/testing` (não pelo `index.ts`). Só `src/ui/conversations.test.ts` o usa fora do pacote.
- `message.test.ts` ficou no app (`apps/internal/src/transport/mock/message.test.ts`), porque importa o seed do mock; só os imports mudaram. Resíduo: `message.ts` está no pacote sem o teste dele.
- Toolchain do pacote igual à do app (TypeScript 5.9.3, Vitest 3.2.7, fast-check 4.10.2, ESLint 9.39.5): sem mudança de comportamento. `moduleResolution: bundler` e imports sem extensão; o `dist` serve a Vite e Vitest, não a Node puro. `lib` inclui `DOM` porque `attachment.ts` usa o tipo `File`. Testes em ambiente `node`.
- Scripts da raiz (`typecheck`, `test`, `dev`, `seed`) constroem o pacote depois de protocol e sm-adapter. CI: o job `internal` ganhou build e lint do pacote. O `fast-check` continua no app (usado por `tenantIsolation.property.test.ts`).
- `pnpm test`: 1530 testes, a mesma soma (pacote 801 em 10 arquivos, app 529 em 43; protocol 11, adaptador SM 2, widget 19, console 61, servidor 107). Playwright do app: 159 passam e 97 pulados.

## 2026-11-16 — F2: sm-webchat importado como `apps/internal` (`/chat/`)

- `git subtree add --prefix apps/internal` do `Luanzzzz/sm-webchat` em `db9b221` (merge do PR #11), sem `--squash`, com o histórico preservado. O repositório de origem fica congelado (D2).
- Pacote `@viavoip/internal` no workspace pnpm. Versões diretas fixadas nas que o `package-lock.json` do app resolvia (React 19.3.1, Vite 6.4.6, Vitest 3.2.7, TypeScript 5.9.3). Cada app mantém a própria toolchain. O `package-lock.json` e o `.github/` do app saíram. `pnpm-workspace.yaml` ganhou um `packageExtensions` que declara o peer opcional `vitest` do `@testing-library/jest-dom` (sem ele o `tsc` do app não enxerga os matchers sob pnpm).
- Vite com `base: '/chat/'`. O Playwright usa `baseURL` e `webServer` em `/chat/` e `pnpm`.
- `registerStatic` serve o build do app em `/chat/` e redireciona `/chat` para `/chat/`. O app é independente: sem o build dele, widget e console seguem como antes. Não há fallback de SPA, porque o app não tem rotas no caminho da URL. O servidor não define CSP nem headers de segurança.
- `apps/server/test/static.test.ts`: 5 testes novos. `registerStatic` aceita as raízes como parâmetro opcional, com o mesmo padrão de antes.
- `.github/workflows/ci.yml`: job novo `internal` (lint, gate de hex e Playwright com axe). O `verify` cobre typecheck, build e Vitest do app pelo `-r`.
- O app roda só com dados simulados (`MockTransport`, `localStorage`). O `/chat/` ainda não fala com o servidor. Console, widget, protocolo, banco e migrations não mudaram.
- `pnpm test` na raiz: 1530 testes (protocol 11, adaptador SM 2, widget 19, console 61, servidor 107, app interno 1330 em 53 arquivos). Playwright do app: 159 passam e 97 são pulados, igual ao repositório de origem. `scripts/verify-browser.mjs` não foi executado nesta rodada (a porta 3000 da máquina estava ocupada).

## 2026-11-16 — main em ed89e11 (d94be4a e PR #7) e decisão de fusão

- PR #5 (`3a01f3d`): cabeçalho da migration 009 corrigido; só o comentário do SQL mudou.
- PR #6 (`3fd580b`): `uuid.ts` no widget e no console (UUID com `getRandomValues`), nome do visitante pedido antes da fila, `require_visitor_name = true` em `site_a` e `site_b` no seed e `docker-compose.hml.yml`.
- PR #7 (`ed89e11`): script `pnpm typecheck`, CI em `.github/workflows/ci.yml` (sem deploy), `GET /version` e build args `GIT_SHA`/`BUILT_AT` no `Dockerfile` e no `docker-compose.hml.yml`.
- `docs/decisions.md`: nova seção "Fusão com o chat interno (sm-webchat)" com as decisões D1 a D11 de 16/11/2026 (a D7 foi retirada), e linha de revisão em "Chat interno separado do atendimento". São decisões, não código implementado.
- `docs/fusao/plano-fusao.md`: plano de fusão v1.1.
- `docs/deployment/environments.md`: seção do compose de homologação, com os build args e um aviso sobre a VPS.
- `STATUS.md`, `README.md` e `docs/README.md` passam a referenciar `ed89e11` (`d94be4a` continua citado como a base do PR #7).
- `pnpm typecheck`, `pnpm build` e `pnpm test` reexecutados sobre `ed89e11`: 195 testes passaram (protocol 11, adaptador SM 2, widget 19, console 61, servidor 102). Sobre `d94be4a` a contagem era 193 (servidor 100). `scripts/verify-browser.mjs` e `scripts/verify-visual.mjs` não foram reexecutados; o último registro é de 29/10/2026 sobre `3d9e2cf`.

## 2026-10-29 — Fase 5.5: redesign do console, widget corrigido e demo no site

- Novos documentos em `docs/fase-5.5/`: `DEMO_SITE_LOCAL.md` (serviços, portas, variáveis, origens pelo admin e roteiro de teste), `DESIGN_SYSTEM.md` (tokens, componentes e padrões) e `RELATORIO.md` (relatório final com testes reais, capturas e pendências).
- Console reescrito sobre um design system próprio (identidade ViaVoip, sidebar e topbar, rotas por hash). Conectividade e presença separadas; Central do Agente, Supervisor, Qualidade, Administração (oito seções), Chat interno, Setores, Anúncios e Atividades redesenhados.
- Widget: o painel nasce fechado quando embutido; o loader calcula a geometria pelo viewport do site (`frame-geometry.ts`), com `window.ViaVoipWebchat.open()/close()`. Causa raiz do recorte no canto documentada em `RELATORIO.md`.
- Novo `scripts/verify-visual.mjs` (cinco viewports, console e widget em :8090 e :3100). `scripts/verify-browser.mjs` ganhou o clique no botão do widget, a aba Filas, o modal "Nova fila" e a confirmação de encerramento.
- Correção da afirmação anterior de "sem mudanças no servidor": `GET /auth/me` passou a devolver `canChangeOwnActivity` (`apps/server/src/auth/sessions.ts` e `packages/protocol/src/http.ts`, com teste em `operations.test.ts`). Não há migrations nem mudança de seed.
- Docs Helper atualizado para o commit `3d9e2cf`: novos módulos *Interface do Console* e *Demonstração e Testes*; novas páginas *Painel de administração*, *Geometria e correção do recorte do widget*, *Relatório da Fase 5.5*, *Design system*, *Demo local* e *Testes visuais*; Widget, Central do Agente, Supervisor, Qualidade, SLA, Atividades, Status e Visão geral atualizados.
- `pnpm test` reexecutado: 192 testes passaram (protocol 11, adaptador SM 2, widget 18, console 61, servidor 100). Última rodada de `verify-visual.mjs`: 155 verificações, 0 falhas.
- Incorporado o conteúdo do PR #3 (Fase 5 no Docs Helper) a esta branch para que o ZIP único contenha as duas fases.
- Publicação no site de teste: **não realizada**; exige reimportar o ZIP em `/admin/import` (ver `docs-helper/PUBLICATION-BLOCKER.md`).

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
