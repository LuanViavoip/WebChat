# Revisão independente após correções — Fases 1–4

Data: 2026-10-27. **Parecer: REPROVADO — CORREÇÕES E VALIDAÇÃO OBRIGATÓRIAS.** Este documento complementa a auditoria original, que permanece como registro histórico; as referências e achados originais descrevem o estado anterior às alterações.

## Alterações examinadas

- Participação em salas internas agora é reconciliada e o histórico já não reinscreve o ex-membro. Escopo de supervisor foi aplicado por setor e fila a consultas, transferências, métricas e eventos de atendimento.
- Sockets entram na sala da sessão, validam sessão e só depois entram em salas de dados; logout solicita desconexão, e um timer aplica expiração. A comunicação da revogação entre processos depende do adaptador Redis.
- Limite de login usa tabela PostgreSQL compartilhada, com chaves HMAC e `LOGIN_RATE_LIMIT_SECRET` obrigatório. É necessário usar o mesmo segredo em todas as réplicas.
- Foram acrescentados controles corporativos e paginação/sincronização do chat interno. Corrigiu-se a ordem da paginação para frente, e testes de console cobrem 205 mensagens e falha no meio da recuperação.
- Foi adicionada a migration `008_login_rate_limits.sql`; o seed de demonstração ganhou vínculos entre setor e fila. A execução de migrations ocorre na inicialização (`apps/server/src/main.ts:9`). Nenhuma migration foi executada nesta revisão. Ambientes existentes precisam de vínculos reais setor–fila previamente conferidos; alterar o seed de demonstração não migra automaticamente dados existentes com seed desativado.

## Corrida de revogação — correção implementada, não validada em integração

A revisão identificou inicialmente uma janela entre o commit da remoção e a saída do socket da sala. Após essa observação, o envio passou a usar destinatários ativos consultados no banco e uma trava advisory compartilhada com as mutações do setor, mantida até o início do fan-out (`apps/server/src/modules/internal-chat.ts:82`, `apps/server/src/modules/sectors.ts:94`, `apps/server/src/db/tenant.ts:32`, `apps/server/src/realtime/hub.ts:136`). A emissão não depende mais da sala antiga como autorização. Foi adicionado teste concorrente entre dois pools, ainda não executado.

A implementação exige que as instâncias envolvidas usem o mesmo PostgreSQL e, para fan-out a sockets remotos, o adaptador Redis. Um evento autorizado e iniciado antes da remoção pode chegar depois dela por atraso de transporte; essa é uma limitação da ordem de entrega. O mecanismo tem evidência estática e compilação, mas a correção da corrida e a recuperação após falhas **não foram comprovadas dinamicamente**.

## Verificação independente

| Verificação | Resultado |
|---|---|
| `pnpm --workspace-concurrency=1 build` | Passou; compila todos os pacotes e gera builds do widget e console. |
| `pnpm --filter @viavoip/console test` | Passou: 2 arquivos, 3 testes. |
| Protocolo e adaptador SM | Passaram: 5 e 2 testes, respectivamente. |
| Teste isolado `session-room.test.ts`, com configuração temporária sem global setup | Passou: 2 testes com socket simulado; não valida transporte real, PostgreSQL ou múltiplas instâncias. |
| `pnpm --filter @viavoip/server exec vitest run` | Falhou na inicialização, antes de executar testes, com `TypeError: code.charCodeAt is not a function`. |
| Docker | Acesso ao daemon negado nesta sessão; não foi possível iniciar o PostgreSQL descartável exigido pelos testes de integração. |
| Migration 008, RLS, testes de integração/adversariais e regressão E2E | Não executados; resultados não podem ser inferidos de compilação ou testes simulados. |

## Pendências para aprovação

1. Executar os testes de remoção/entrega concorrentes, múltiplas instâncias e recuperação após falhas para validar a correção da janela de autorização.
2. Executar em ambiente autorizado e descartável a suíte completa, as novas regressões, a migration 008, o isolamento intertenant, a revogação entre instâncias e os fluxos das fases anteriores. Investigar o erro mascarado do Vitest sem presumir sua causa.
3. Validar a configuração do segredo compartilhado e os vínculos setor–fila de cada instalação antes da ativação. Em múltiplas instâncias, validar que o adaptador Redis está configurado e acessível para revogação entre processos.
4. Definir e implementar garantias de envio e recuperação de eventos pós-commit (F4-07). A integração SM real continua dependente de contrato externo; não se deve supor semântica de repetição nem classificar a ausência do contrato como defeito.

A revisão confirma a presença das alterações citadas, não sua correção completa em funcionamento. Não há evidência suficiente para afirmar que a Fase 4 está pronta ou que não existem vulnerabilidades entre tenants. Nenhum deploy, commit, push ou acesso a produção foi realizado.

## Nova tentativa de testes integrados — 2026-10-27

A suíte foi repetida após as correções: `pnpm test` terminou com saída 1; passaram 5 testes do protocolo, 2 do adaptador e 3 do console, mas o servidor não executou testes porque a inicialização apresentou `TypeError: code.charCodeAt is not a function`. Uma execução direta do Testcontainers retornou `Could not find a working container runtime strategy`, e o socket do Docker retornou permissão negada. Além disso, uma tentativa isolada de abrir um servidor TCP em `127.0.0.1` retornou `EPERM`, impedindo os servidores HTTP/WebSocket dos testes mesmo com um banco disponível. O erro do Vitest não foi atribuído com certeza a um desses bloqueios.

`pnpm --workspace-concurrency=1 build` passou. Com configuração temporária que exclui o global setup e executa apenas `session-room.test.ts`, passaram 2 testes unitários simulados; eles não substituem testes integrados. Não foi usado qualquer banco existente, executada migration, feito deploy ou acessado produção. O parecer permanece inalterado até executar `pnpm test` em ambiente isolado com runtime de containers e sockets locais disponíveis, analisar eventuais falhas e validar os cenários de concorrência e isolamento.
