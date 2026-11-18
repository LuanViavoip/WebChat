# Diário técnico — Frente Gemini (Chat Interno v1)

## 2026-11-18 — Onda 0c: versionamento e release notes do Chat Interno

- **Branch:** `chore/v1-0c-versionamento`
- **Base:** `origin/main` em `2e8961a` (`Merge pull request #12 from LuanViavoip/feat/f4-modelo-nn`)
- **Escopo:** `apps/internal` (`@viavoip/internal`) e `packages/internal-domain` (`@viavoip/internal-domain`)

### Resumo do sistema de versionamento criado

A Onda 0c introduz o versionamento e o registro de notas de versão do Chat Interno no padrão do SM Report Studio (`<MAJOR>.<MINOR>.<BUILD>`, sem zeros à esquerda, começando em `1` em cada série base `MAJOR.MINOR`):

- [`AGENTS.md`](../../AGENTS.md): regras gerais do repositório `LuanViavoip/WebChat` (sem merge/deploy automático, pedido de autorização ao Luan para migrations, push na `main`, push forçado, deploy ou abertura de PR) e a seção normativa **"Versão e notas (Chat Interno: apps/internal e packages/internal-domain)"**.
- `apps/internal/src/version.ts`: módulo de versão da aplicação com `APP_BASE_VERSION`, `APP_BUILD_NUMBER` e `RELEASE_NOTES_HISTORY`.
- `apps/internal/RELEASE_NOTES.md`: histórico de builds da série em Markdown, com cabeçalho de versão atual de compilação, série base atual e última atualização.
- `apps/internal/scripts/bump-version.mjs` (exposto em `apps/internal/package.json` pelo script `"version:bump": "node scripts/bump-version.mjs"`): automação para incrementar o `BUILD` em `+1` por pedido atendido, iniciar nova série (`--remix`), consolidar pendências de branches paralelos (`--from-pending`) e validar consistência (`--check`), usando a data corrente em `America/Sao_Paulo`.
- `apps/internal/release-notes/pendentes/.gitkeep`: diretório versionado para filas de notas pendentes (`<nome-do-branch>.json`) em frentes paralelas antes do rebase na `main`.
- Testes dedicados: `apps/internal/src/version.test.ts` (executado em `pnpm --filter @viavoip/internal test`) e `apps/internal/scripts/bump-version.test.ts`.

### Decisão sobre `eslint.config.js` e `scripts/bump-version.test.ts`

- **Nota técnica:** em `apps/internal/tsconfig.json`, a lista `"include"` cobre apenas `["src", "vite.config.ts"]`. Já `apps/internal/eslint.config.js` aplica as regras tipadas (`strictTypeChecked` com `parserOptions.projectService: true`) sobre `**/*.{ts,tsx}` e declara `ignores` apenas para `['dist', '.vite', 'e2e/**', 'playwright.config.ts', 'playwright-report', 'test-results']`, sem ignorar `scripts/**`.
- **Efeito técnico:** com `scripts/bump-version.test.ts` presente em `apps/internal`, a execução de `eslint .` faz com que o ESLint acuse `Parsing error: scripts/bump-version.test.ts was not found by the project service`.
- **Decisão:** `apps/internal/eslint.config.js` (e `apps/internal/tsconfig.json`) e o tratamento definitivo de lint para `scripts/bump-version.test.ts` foram mantidos intocados na Onda 0c por restrição de escopo (arquivos proibidos nesta onda).
- **Próximo passo recomendado:** ajustar `apps/internal/eslint.config.js` na **Onda 0b** (por exemplo, tratando `scripts/**` nas regras ou nos `ignores` do lint) para compatibilizar `pnpm --filter @viavoip/internal lint` com testes em `scripts/`.
