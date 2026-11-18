# AGENTS.md

Repositório `LuanViavoip/WebChat`: monorepo `pnpm` do **WebChat ViaVoip** (`apps/server`, `apps/console`, `apps/widget`, `apps/internal`, `packages/protocol`, `packages/sm-adapter` e `packages/internal-domain`).

- **Chat Interno:** `apps/internal` (`@viavoip/internal`), servido em `/chat/`.
- **Domínio compartilhado do Chat Interno:** `packages/internal-domain` (`@viavoip/internal-domain`).

## Regras gerais obrigatórias

- Não faça merge nem deploy.
- Peça autorização ao Luan antes de migrations, push na `main`, push forçado ou deploy.
- Abra PR só com autorização do Luan; sem ela, entregue o branch.

## Versão e notas (Chat Interno: apps/internal e packages/internal-domain)

Vale para todo pedido que altere arquivos em `apps/internal/` ou `packages/internal-domain/`. Formato do SM Report Studio.

1. Formato `<MAJOR>.<MINOR>.<BUILD>`, SEM zeros à esquerda (1.0.9, 1.0.10). A série base é `MAJOR.MINOR` (`APP_BASE_VERSION`). O BUILD começa em 1 em cada série; não existe x.y.0.
2. A cada pedido atendido (uma solicitação do Luan ou um prompt de frente), suba o BUILD em +1 uma única vez, mesmo que o pedido tenha vários commits. Faça isso SEMPRE com o script, nunca editando à mão:

   node apps/internal/scripts/bump-version.mjs "<Título da alteração>" "<Detalhe 1>" "<Detalhe 2>"

   O script atualiza `APP_BUILD_NUMBER` e `RELEASE_NOTES_HISTORY` em `apps/internal/src/version.ts` e escreve o bloco no topo da série em `apps/internal/RELEASE_NOTES.md` (### Build `x.y.z` — *DD/MM/AAAA*, título em negrito, itens em lista), além do cabeçalho "Versão Atual de Compilação", "Série Base Atual" e "Última Atualização". A data é a de hoje em America/Sao_Paulo.
3. Título: o que mudou, em português, como manchete. Detalhes: um item por mudança, dizendo primeiro o que muda para quem usa o chat e depois, entre parênteses, os arquivos principais. Se nada mudou para o usuário, o primeiro detalhe é "Sem mudança visível (interno)".
4. Nova série (remix) só quando o Luan pedir ("vamos iniciar a 1.1"):

   node apps/internal/scripts/bump-version.mjs --remix 1.1 "Início da série 1.1" "<Detalhe>"

   O BUILD volta para 1 (1.1.1) e todo o histórico anterior fica preservado.
5. Branch paralelo (outra frente aberta ao mesmo tempo): NÃO rode o bump nem edite `version.ts` ou `RELEASE_NOTES.md` durante o trabalho. Registre cada pedido em `apps/internal/release-notes/pendentes/<nome-do-branch>.json` como `[{ "title": "...", "details": ["..."] }]`, do mais antigo para o mais novo. No último commit antes de entregar, depois do rebase na `main` atual, rode:

   node apps/internal/scripts/bump-version.mjs --from-pending apps/internal/release-notes/pendentes/<nome-do-branch>.json

   O script numera a partir da `main` e apaga o pendente.
6. Antes de entregar, rode `node apps/internal/scripts/bump-version.mjs --check` e `pnpm --filter @viavoip/internal test` (inclui `src/version.test.ts`). Os dois precisam passar.
7. Nunca reescreva nem renumere blocos antigos, exceto para corrigir um erro apontado pelo Luan.
8. Não faça merge nem deploy. Peça autorização ao Luan antes de migrations, push na `main`, push forçado ou deploy. Abra PR só quando o Luan autorizar; sem isso, entregue o branch.
