# Findings — auditoria independente das fases 1–4

Data: 2026-10-27. Evidência estática significa comportamento derivado do código, sem execução integrada. Os testes de servidor ficaram bloqueados na inicialização; não se afirma exploração em ambiente real. Referências são relativas à raiz.

## F4-01 — P1 — Ex-membro pode voltar a receber mensagens do grupo

- **Evidência:** `apps/server/src/modules/internal-chat.ts:110` e `:310` permitem histórico a participantes com `removed_at`; a consulta limita mensagens à data da remoção (`:130`). Entretanto, `apps/server/src/realtime/staff-channel.ts:131`–`:141` adiciona incondicionalmente o socket à sala após esse histórico. O hub envia mensagens novas à sala (`apps/server/src/realtime/hub.ts:128`–`:133`).
- **Condição/reprodução:** remover participante de um grupo, manter ou reconectar sessão, solicitar `internal.history` com o ID conhecido e enviar nova mensagem por participante ativo. O handler foi executado isoladamente com o serviço de histórico simulado e chamou `join`; a combinação completa com banco e dois clientes não foi executada.
- **Impacto:** divulgação de novas mensagens de grupo a ex-participante no mesmo tenant, apesar de o histórico respeitar o limite de remoção.
- **Correção:** separar autorização de histórico retido da autorização de assinatura em tempo real; só inscrever participantes ativos e revogar inscrições em todas as sessões.
- **Regressão:** teste integrado com duas abas e reconexão, histórico anterior permitido, tentativa de reinscrição e ausência de mensagens posteriores à remoção.

## F4-02 — P1 — Supervisores recebem e manipulam atendimentos fora do setor

- **Evidência:** `apps/server/src/domain/access.ts:34`–`:36` permite leitura a qualquer supervisor do tenant; `apps/server/src/modules/conversations.ts:438`–`:449` lista conversas por tenant sem restringir setor/fila; `:535`–`:547` autoriza transferência de qualquer conversa em estado elegível. `apps/server/src/realtime/register.ts:316`–`:318` inscreve todos na mesma sala e `apps/server/src/realtime/hub.ts:62`–`:70` transmite mensagens completas a essa sala. `apps/server/src/modules/supervisor.ts:121`–`:130` agrega métricas de todo o tenant, embora agentes sejam filtrados por setor (`:46`–`:69`).
- **Condição/reprodução:** dois setores com filas vinculadas e supervisores distintos; conectar supervisor A e abrir/listar/transferir conversa do setor B ou observar `message.new`.
- **Impacto:** acesso indevido a mensagens e metadados e alteração operacional fora do escopo do supervisor. É falha intratenant; não foi demonstrado vazamento entre tenants.
- **Correção:** aplicar política única de escopo via relação setor–fila em consultas, ações, agregados e fan-out; manter exceção explícita para administradores e definir política para filas sem setor.
- **Regressão:** dois supervisores em setores distintos, conversas em cada fila, lista, histórico, eventos, métricas e transferências negados fora do escopo; administrador continua autorizado.

## F4-03 — P1 — Revogação ou expiração de sessão não encerra sockets existentes

- **Evidência:** autenticação ocorre no middleware de conexão (`apps/server/src/realtime/register.ts:64`–`:77`, `:146`–`:159`, `:301`–`:314`); handlers usam o principal já armazenado, sem revalidá-lo (`apps/server/src/realtime/bind.ts:12`–`:34`). Logout apenas exclui a sessão no banco (`apps/server/src/auth/sessions.ts:182` e `apps/server/src/http/routes.ts:72`–`:75`).
- **Condição/reprodução:** estabelecer WebSocket, fazer logout por outra aba ou aguardar expiração e continuar usando o socket já conectado.
- **Impacto:** acesso e ações continuam após o término esperado da sessão; também podem continuar chegando eventos. A verificação de expiração no lookup protege novas conexões, não as existentes.
- **Correção:** revogar e desconectar todos os sockets associados à sessão e validar expiração/revogação durante sua vida útil, inclusive em múltiplas instâncias.
- **Regressão:** socket aberto antes de logout/expiração não consegue executar ações nem receber eventos; nova conexão com token revogado é rejeitada.

## F4-04 — P1 — Login sem limite de tentativas

- **Evidência:** `apps/server/src/http/routes.ts:46`–`:49` limita criação de sessões de visitante, mas `:61`–`:64` executa login sem limiter. `apps/server/src/auth/sessions.ts:138` usa verificação de senha, mas não controla tentativas.
- **Condição/reprodução:** enviar repetidas credenciais inválidas para `/auth/login` a partir de um ou vários clientes.
- **Impacto:** facilita tentativa de senhas e consumo de CPU pela verificação Argon2. O limiter existente é em memória por processo (`apps/server/src/http/rate-limit.ts:1`–`:15`), sem proteção distribuída.
- **Correção:** limitar por IP e conta com armazenamento compartilhado, limites configuráveis e resposta uniforme; evitar bloqueio que permita negação de serviço trivial contra usuários.
- **Regressão:** muitas tentativas inválidas são limitadas, contas e IPs independentes respeitam a política, múltiplas réplicas compartilham o limite e login legítimo recupera após janela.

## F4-05 — P1 — Salas de grupo não refletem permissões após alterações de setor

- **Evidência:** `apps/server/src/modules/sectors.ts:63`–`:64` substitui supervisores e sincroniza participantes. O handler de `sector.save` apenas adiciona o público atual às salas (`apps/server/src/realtime/staff-channel.ts:58`–`:69` e `:242`–`:249`), sem retirar antigos supervisores. Além disso, `mutation` inclui todos os administradores no público (`apps/server/src/modules/sectors.ts:260`–`:269`), e esse mesmo público é inscrito na sala interna, mesmo sem participação ativa. `apps/server/src/realtime/hub.ts:128` transmite o conteúdo integral da mensagem.
- **Condição/reprodução:** com sockets conectados, substituir supervisor de um setor ou salvar/adicionar membro de setor com administrador não participante; enviar mensagem no grupo.
- **Impacto:** sockets não participantes podem receber conteúdo em tempo real. A permanência de ex-supervisor e a inscrição de administradores decorrem diretamente das chamadas; execução integrada pendente.
- **Correção:** distinguir destinatários de notificações administrativas dos participantes ativos; calcular entradas e saídas de sala após todas as alterações, incluindo trocas de supervisor, desativação e múltiplas instâncias.
- **Regressão:** ex-supervisor e administrador sem participação não recebem mensagens; membros ativos recebem; testar troca enquanto conectados e com várias abas.

## F4-06 — P2 — Interface da Fase 4 deixa operações importantes inacessíveis

- **Evidência:** histórico interno possui cursores no backend (`apps/server/src/modules/internal-chat.ts:110`–`:158`), mas a tela carrega apenas a primeira página e não oferece paginação (`apps/console/src/internal/InternalChat.tsx:68`–`:85`). A tela de setores só cria e altera membros (`apps/console/src/sectors/SectorsPanel.tsx:28`–`:108`), sem edição de setor/responsáveis; anúncios publicam com `pinned: false` e sem expiração (`apps/console/src/announcements/AnnouncementsPanel.tsx:53`–`:65`), sem controles de edição/arquivamento; catálogo de atividades tem operação administrativa no backend (`apps/server/src/modules/activities.ts:56`), sem controle correspondente no painel.
- **Condição/reprodução:** usar apenas a interface do console para qualquer uma dessas operações ou tentar consultar mensagens além da primeira página.
- **Impacto:** recursos existentes no protocolo/backend não estão completos na experiência do produto.
- **Correção:** expor operações autorizadas e paginação com estados de carregamento, erro e permissões.
- **Regressão:** testes de interface completos cobrindo paginação, edição de setor/responsáveis, fixação/expiração e gestão de tipos de atividade.

## F4-07 — P2 — Publicação de eventos e notificação SM não são transacionais

- **Evidência:** `withTenant` confirma a transação antes de retornar (`apps/server/src/db/tenant.ts:17`–`:19`); os handlers emitem eventos depois do serviço, por exemplo `apps/server/src/realtime/staff-channel.ts:127`–`:129` e `apps/server/src/realtime/register.ts:193`–`:203`. `apps/server/src/realtime/logger.ts:7`–`:13` registra e absorve falha do adaptador; não há outbox ou retry nesses caminhos.
- **Condição/reprodução:** derrubar processo entre commit e emissão ou simular falha do adaptador após uma transição persistida.
- **Impacto:** eventos podem não chegar em tempo real; integração futura pode perder notificações. O mock não transforma ausência de contrato SM real em defeito.
- **Correção:** definir garantias de entrega e recuperação; para integração confiável, usar outbox transacional, processamento idempotente e retentativas, além de sincronização no cliente.
- **Regressão:** injetar falhas após commit e durante envio, reiniciar consumidor e verificar entrega recuperável sem duplicação funcional.

## F4-08 — P2 — Suíte de integração não verificável neste ambiente

- **Evidência:** `apps/server/test/global-setup.ts:1`–`:22` exige PostgreSQL via Testcontainers; Docker retornou permissão negada. `pnpm test` falhou na inicialização do servidor com `TypeError: code.charCodeAt is not a function` ao montar stack trace; a causa exata desse erro não foi estabelecida.
- **Condição/reprodução:** executar `pnpm test` neste ambiente restrito.
- **Impacto:** autenticação, isolamento, concorrência, migrations e regressões de servidor não puderam ser validados dinamicamente. Não se afirma que a suíte falha em ambiente com Docker funcional.
- **Correção:** executar em CI com runtime de containers isolado e investigar o erro de inicialização e sua causa original; publicar resultado completo.
- **Regressão:** suíte integral com PostgreSQL descartável passa, incluindo cenários adversariais F4-01 a F4-05.

## F4-09 — P2 — Chat interno não recupera mensagens perdidas na reconexão

- **Evidência:** a conexão dispara `reload` que atualiza listas e pessoas (`apps/console/src/internal/InternalChat.tsx:29`–`:59`). O efeito que solicita histórico depende apenas de `selectedId` e `socket`, não do evento `connect` (`:74`–`:90`); eventos novos são anexados ao estado (`:46`–`:55`).
- **Condição/reprodução:** deixar uma conversa selecionada, desconectar a rede, enviar mensagens por outro usuário e reconectar sem trocar de conversa.
- **Impacto:** mensagens persistidas durante a desconexão podem não aparecer no thread até a conversa ser reselecionada; contagem e conteúdo podem divergir.
- **Correção:** sincronizar a conversa selecionada na reconexão com cursor estável e mesclar por ID, tratando ordenação e corrida entre resposta e eventos.
- **Regressão:** desconectar com conversa selecionada, enviar mais mensagens, reconectar e verificar recuperação ordenada e sem duplicações, incluindo evento simultâneo à resposta de histórico.
