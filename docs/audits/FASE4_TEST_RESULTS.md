# Resultados de testes — auditoria das fases 1–4

Data: 2026-10-27. Ambiente local isolado, Node 22.23.3 e pnpm 12.15.0. Nenhum ambiente ou dado produtivo acessado.

| Verificação | Resultado | Evidência |
|---|---|---|
| `pnpm build` | **Passou**, saída 0 | Compilação TypeScript dos pacotes e builds Vite/esbuild do console e widget. Gerou artefatos `dist`. |
| Typecheck | **Passou via build** | `tsc` nos pacotes e servidor; `tsc --noEmit` no console e widget. |
| `pnpm test` — protocolo | **Passou** | 1 arquivo, 5 testes. |
| `pnpm test` — adaptador SM | **Passou** | 1 arquivo, 2 testes. |
| `pnpm test` — console | **Passou** | 1 arquivo, 1 teste; é teste de estado, não prova de fluxo visual. |
| `pnpm test` — servidor | **Falhou antes de executar testes** | Vitest exibiu erro de inicialização `TypeError: code.charCodeAt is not a function` na geração do stack trace e nenhum arquivo executado. Causa original não estabelecida. |
| Docker | **Indisponível** | `docker info` retornou permissão negada ao socket Docker; setup do servidor usa Testcontainers. Isso impede rodar PostgreSQL descartável por esse caminho, mas não prova que seja a causa do erro mascarado do Vitest. |
| Prova isolada do handler | **Passou para propriedade limitada** | Chamado `staffHandlers(...)["internal.history"]` com serviço de histórico simulado retornando sucesso; socket simulado registrou entrada na sala interna. Não é prova integrada de remoção nem testa banco ou transporte. |
| Lint | **Não executado** | Nenhum script `lint` identificado nos manifests. |
| E2E visual | **Não executado** | Não identificada suíte de interface E2E no checkout; não houve execução manual em navegador. |
| Schema PostgreSQL efetivo e migrations | **Não executado** | Docker indisponível; nenhum banco externo foi usado. |

A suíte do servidor contém 38 declarações de testes, incluindo arquivos para isolamento, autorização, reconexão, mensagens, fases 2/3, setores, chat interno, anúncios, operações e escopo do supervisor. Sua existência e os resultados descritos no README não substituem uma execução nesta auditoria.

## Cenários adversariais

| Cenário solicitado | Resultado nesta execução |
|---|---|
| Agente lê conversa atribuída a outro | Não executado; controle estático em `domain/access.ts`; verificar também eventos e histórico. |
| Supervisor acessa setor fora do escopo | Escopo insuficiente demonstrado por leitura estática dos fluxos externos e broadcast (F4-02); execução integrada pendente. |
| Tenant A acessa tenant B | Não executado; RLS e filtros existem, sem comprovação dinâmica. |
| Visitante emite evento exclusivo de supervisor | Não executado; namespaces e schemas separados existem. |
| Removido recebe mensagens de grupo | Caminho de reinscrição confirmado em handler simulado e confirmado por análise estática de histórico/salas (F4-01); execução ponta a ponta pendente. |
| Manipulação de IDs de conversa, setor ou atividade | Não executado sistematicamente; múltiplos controles presentes, exceção de supervisor identificada em F4-02. |
| Logout/expiração com socket aberto | Falha inferida dos caminhos de código (F4-03); teste integrado pendente. |
| Concorrência em claim e atividades | Não executado; testes e bloqueios/constraints existem. |

Para repetir com segurança, usar máquina ou CI autorizado com Docker e rede isolada, dados sintéticos e `pnpm test`; confirmar que Testcontainers usa banco recém-criado e descartável. O setup grava metadados de conexão local em `apps/server/test/.pg-meta.json`; não incluir esse arquivo nem seus valores em relatórios. Investigar a exceção de startup sem publicar credenciais ou logs sensíveis.
