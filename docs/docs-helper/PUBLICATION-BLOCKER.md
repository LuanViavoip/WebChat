# Publicação no Docs Helper — bloqueio de segurança

**Status: NÃO publicado.** O pacote de importação foi preparado e validado, mas a importação em produção foi deliberadamente não executada.

## Motivo

A inspeção do código do Docs Helper (`feat/pdf-documents`) mostra que **qualquer usuário anônimo consegue ler a documentação**:

- `/`, `/docs/...` e `/content/...` não exigem autenticação;
- o cookie `viavoip-docs-profile` e o `src/proxy.ts` apenas personalizam por perfil; **perfil não é autenticação nem autorização** (qualquer visitante pode trocá-lo);
- `/content/[...path]` entrega imagens e PDFs sem checar sessão;
- só existe autenticação para a administração (senha única, sem papéis).

A documentação do Webchat descreve arquitetura interna, esquema do banco, regras de isolamento e **vulnerabilidades abertas (F4-01 a F4-05)**. Publicá-la num leitor aberto expõe esse conteúdo. Não houve autorização explícita para publicação pública.

Também não foi possível provar que o código local do Docs Helper corresponde ao que está em produção (o `.vercel/project.json` local aponta para um projeto chamado `viavoip-docs-test`; nenhum deployment foi consultado).

## O que foi feito

Nenhuma autenticação foi desabilitada, nada foi escrito no Supabase e não houve login administrativo nem chamada a produção.

## Pacote pronto

`docs/docs-helper/dist/viavoip-webchat-docs.zip` (gerado por `node scripts/docs/build.mjs`; ignorado pelo Git) com `docs-index.json` na raiz, `html/` e `assets/`. Fontes versionadas: `docs/docs-helper/index/docs-index.json`, `html/`, `assets/`.

## Configuração necessária para publicar com segurança

Uma das opções, a decidir pelo responsável pelo Docs Helper:

1. **Controle de leitura real** (SSO/login com papéis) no Docs Helper, cobrindo `/docs/*` e `/content/*`, e restrição do sistema "ViaVoip Webchat" a perfis autorizados — o `docs/ARCHITECTURE.md` do Docs Helper já prevê isso como pendência para conteúdo confidencial.
2. **Instância privada** (ex.: Vercel Deployment Protection / rede interna) para o ambiente que receberá este conteúdo.
3. **Autorização explícita** de publicação aberta, ainda assim removendo antes F4-xx, detalhes de RLS/grants e de infraestrutura.

Após resolver, siga [MAINTENANCE.md](../MAINTENANCE.md) (passos 8–9).
