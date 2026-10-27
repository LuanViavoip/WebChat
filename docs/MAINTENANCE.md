# Manutenção da documentação

Pré-requisitos: Node 22, Docker (usado para um PostgreSQL descartável e para o mermaid-cli 11.4.2 fixado) e acesso à internet na primeira execução (imagens e `npm ci`). Tudo roda localmente; **nenhum script acessa produção, Supabase ou o Docs Helper**.

## Fluxo

1. **Alterar Markdown** em `docs/` (não edite `database/data-dictionary.md` nem `docs/diagrams/database-erd*.mmd`, que são gerados).
2. **Atualizar Mermaid** em `docs/diagrams/*.mmd`. Os ERDs e o dicionário mudam alterando `scripts/docs/gen-database.mjs` ou as migrations.
3. **Schema:** `scripts/docs/introspect-schema.sh` aplica `apps/server/migrations/*.sql` em um Postgres descartável e extrai o catálogo.
4. **Renderizar:** `scripts/docs/render-diagrams.sh` gera `docs/diagrams/rendered/*.svg|png`; falha se algum `.mmd` não renderizar. Abra os PNGs e confira a legibilidade.
5. **Regenerar HTML, índice e ZIP:** `node scripts/docs/build.mjs`. A hierarquia (Sistema → Módulo → Página) fica em `scripts/docs/pages.mjs`; para incluir uma página nova, adicione-a lá.
6. **Validar:** `node scripts/docs/validate.mjs` (índice, limites, links, âncoras, imagens, sanitização e correspondência tabelas/eventos × código).

Tudo de uma vez: `scripts/docs/run-all.sh`.

7. **Versionar:** commit na branch `docs/webchat-technical-documentation` (ou derivada). Atualize o hash em `docs/README.md`, `docs/STATUS.md`, `docs/docs-helper/VALIDATION.md` e `CHANGELOG.md` para o commit do código documentado. Sem force push; integração por Pull Request.
8. **Reimportar no Docs Helper (manual):** somente após resolver o bloqueio de segurança em [docs-helper/PUBLICATION-BLOCKER.md](docs-helper/PUBLICATION-BLOCKER.md). Em `/admin/import`, envie `docs/docs-helper/dist/viavoip-webchat-docs.zip`, revise o preview (adicionados/alterados/removidos, avisos, erros) e confirme. A reimportação **substitui a árvore inteira** do sistema; escolha o sistema de destino existente em vez de criar outro.
9. **Verificar a publicação:** navegar pela árvore, abrir uma página de cada módulo, conferir imagens (diagramas), tabelas, links entre páginas e a busca por um termo conhecido (ex.: `conversations_one_open_per_visitor`). Registrar versão e data no `CHANGELOG.md`.

## Quando atualizar

Qualquer mudança em migrations, `packages/protocol/src/events.ts`, regras de acesso (`domain/access.ts`, módulos de setor/anúncio/atividade), configuração de deploy ou no estado dos achados F4-xx. O `validate.mjs` acusa tabelas/eventos novos ou removidos que a documentação não acompanhe, mas **não** valida texto descritivo: revise [STATUS.md](STATUS.md) manualmente.

## Limitações do pacote

O formato `docs-index.json` do Docs Helper é **provisório** (comentado no código dele) e o validador replica suas regras atuais; se o importador mudar, ajuste `build.mjs`/`validate.mjs`. `contentUrl` remoto não é suportado; todo conteúdo vai como arquivo no ZIP. Diagramas vão como PNG (o SVG é aceito pelo importador, mas PNG é o formato conservador).
