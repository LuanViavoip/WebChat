# Publicação no Docs Helper — registro e risco de segurança

**Status: PUBLICADO em 2026-10-27**, com autorização explícita do responsável (Luan) para publicar o **pacote completo**, inclusive os achados de segurança abertos (F4-01 a F4-05), mesmo sabendo da leitura anônima.

| Item | Valor |
|---|---|
| Ambiente | `https://viavoip-docs-test.vercel.app` (projeto Vercel `viavoip-docs-test`; ambiente de teste, não confirmado como produção final) |
| Sistema criado | "ViaVoip Webchat", `/docs/viavoip-webchat` (novo sistema; nenhum existente foi substituído) |
| Fluxo usado | `/admin/import` com sessão administrativa já aberta: upload do ZIP → preview (0 warnings, 0 errors) → confirmação |
| Pacote | `docs/docs-helper/dist/viavoip-webchat-docs.zip`, sha256 `534b60eeda002e45b641a2fe71a1390ba6c6c307a3d1d507975b0c5abe7c6e01` |
| Conteúdo | 36 documentos (12 módulos + 24 páginas), 24 HTMLs, 15 imagens |
| Código documentado | commit `d65d40d` |
| Documentação publicada | estado do commit `72e7d08` |

## Atualização posterior — 2026-10-27

O pacote com as correções e os 62 testes foi reimportado no sistema existente. A prévia indicou 36 documentos, 15 imagens, nenhum erro e nenhum documento removido. A página de status publicada foi conferida e registra a limitação de entrega pós-commit. SHA-256 do pacote: `10d0d2d02443f581c24990eec53b27129d0512902007372b5c83fe5cb58e5d13`. A integração com a main do Git ainda estava pendente quando o pacote foi publicado.

## Pendente — reimportação da Fase 5.5 (2026-10-29)

O site de teste ainda mostra o conteúdo até a Fase 4. O pacote com Fase 5 e Fase 5.5 (código documentado: `3d9e2cf`) é gerado por `node scripts/docs/build.mjs`, que escreve `docs/docs-helper/dist/viavoip-webchat-docs.zip`, e **não foi importado**. O repositório da plataforma (`LuanViavoip/viavoip_docs`) não guarda as páginas do WebChat; o conteúdo vive no banco do site e entra só por `/admin/import`, com sessão administrativa. Passos: [MAINTENANCE.md](../MAINTENANCE.md), itens 8 e 9. A reimportação substitui a árvore inteira do sistema "ViaVoip Webchat". O risco de leitura anônima descrito abaixo continua valendo.

## Divergência histórica da publicação anterior

O commit `02a446c` (WIP de terceiros) alterou `docs/deployment/environments.md` e `docs/local-development.md`. O `html/` e o ZIP gerados a partir de `HEAD` já refletem essa mudança em `ambientes.html`, **mas a versão publicada não**: a página "Ambientes" no Docs Helper é a do commit `72e7d08`. O sha256 acima é o do ZIP publicado; o ZIP regenerado de `HEAD` é diferente. Reimporte quando o WIP for validado e integrado.

## Verificação pós-publicação (executada)

- 24 de 24 páginas respondem 200; 15 de 15 imagens respondem 200 como PNG.
- 89 links internos válidos; 35 âncoras do índice do dicionário resolvem; 51 tabelas em 14 páginas.
- Busca pela interface (`conversations_one_open_per_visitor`) retorna 4 páginas.
- O pacote não contém a senha de demonstração do seed.
- Não verificado: renderização visual de cada página no navegador (a aba chegou a ficar em carregamento em uma navegação; o servidor respondeu em ~2 s por `curl`).

## Risco aceito: leitura anônima

Confirmado por `curl` sem login (apenas um cookie de perfil): **qualquer pessoa com o link lê a documentação**, incluindo arquitetura, esquema do banco e as falhas abertas F4-01 a F4-05. "Perfil" no Docs Helper é personalização, não controle de acesso. Mitigações recomendadas, a decidir pelo responsável:

1. Habilitar controle de leitura real (SSO/login com papéis) no Docs Helper e restringir este sistema; ou proteger o deployment (ex.: Vercel Deployment Protection).
2. Se as falhas F4-xx forem corrigidas e integradas, reimportar uma versão atualizada.
3. Para retirar do ar: a importação substitui a árvore inteira do sistema; não há exclusão de sistema documentada neste fluxo, então confirme como remover antes de depender disso.

Reimportação: [MAINTENANCE.md](../MAINTENANCE.md), passos 8–9. Não foi desabilitada nenhuma autenticação nem escrito diretamente no Supabase; tudo passou pelo importador administrativo.
