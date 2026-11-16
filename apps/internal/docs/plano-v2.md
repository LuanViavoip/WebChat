# sm-webchat: plano v2.1 (chat interno multiempresa: admin, supervisor e agente)

> **Revisão v2.1, de 13/11/2026.** Incorpora as respostas do Luan às perguntas da v2 e o PR #7. Continua sendo só plano: não tem código, commit, push, merge nem comentário no GitHub.

- Repo: `Luanzzzz/sm-webchat` (privado).
- Base lida:
  - `main` @ `b298830` (Etapa 1, PR #5);
  - PR #6 @ `5e903b5` (Etapa 2, mídia), lido em `/workspace/smw-pr6`;
  - PR #7 @ `6981931`, com base na branch do #6. Li pela API do GitHub (cursor-github), apliquei numa cópia descartável em `/tmp/smw-pr7` e rodei o Vitest.
- Fontes:
  - o desenho da Etapa 2 em `/workspace/sm-webchat-etapa2-midia.md`;
  - o relatório do Interrogador em `/workspace/sm-webchat-pr6-interrogador.md`;
  - as listas de reviews e comentários dos PRs no GitHub. As do #6 estão vazias.
- Princípios: subtrair antes de somar, preservar o que já funciona (mídia, ticks, aliases, histórico mobile, tokens), usar o mínimo de abstração e fechar cada etapa com um estado verificável que o Luan testa.

## Mudanças desde a v2

| # | Tema | v2 | v2.1 |
|---|---|---|---|
| 1 | Agente ↔ agente | proibido por padrão | **permitido dentro da empresa** (tenant). A lista prioriza grupos e supervisor: seções "Grupos e supervisão" e depois "Colegas", com `conversationTier` puro (§2.2) |
| 2 | Quem cria e edita grupos | supervisor | supervisor, via capacidade `group.manage`, que **não cabe** no teto do agente. O admin cadastra supervisores e concede permissões (§2.7) |
| 3 | Ciência | diálogo ao entrar e faixa fixa | **primeiro login do dia** (fuso da empresa, `lastLoginDate` por usuário) com aviso novo: notificação e **entrada direta na aba Avisos**. Ao longo do dia: **alerta vermelho no canto superior direito** até o clique, e o clique leva aos Avisos. Nada trava o chat. Visualização e ciência continuam distintas (§2.5) |
| 4 | Expiração | não expira | **opcional**, definida pelo supervisor |
| 4 | Edição | não edita | **edita com revisão versionada**. A edição *material* reabre a ciência, e o histórico fica guardado (§2.4) |
| 4 | Público | todos ou ilhas | união `all \| groups \| people` (§2.4). **Só o público vê o aviso** (fora o autor) |
| 4 | Encaminhamento | snapshot para qualquer destino | **só para destinos cujos membros estão todos no público**. A mensagem leva apenas a referência, e o render sempre checa a permissão; quem perdeu o acesso depois vê "Aviso restrito" (§2.6) |
| 5 | Navegador fechado | residual a planejar | **fora do escopo, por decisão do Luan.** Igual ao WhatsApp Web: aba aberta ou minimizada. Sem Service Worker nem Push |
| — | **Administrador** (novo) | não existia | role `admin` (dono da empresa). Permissões viram **grants explícitos** (capacidades por usuário), com tetos por role, `can` e `canGrant` puros e testes de matriz e de propriedade (§2.7) |
| — | **Multiempresa** (novo) | não existia | `tenantId` em User, Ilha, Conversation, Announcement e eventos. O **isolamento entre tenants** vira invariante testada (§2.11) |
| — | Etapas | 2 → 8 | 2 → **9**. Tenant, roles com admin e grants entram na **4**. O **console de administração** é a **Etapa 5 nova**. Grupos vão para a 6, notificações para a 7, avisos para a 8 e interação/encaminhamento para a 9 |
| — | Etapa 2 | corrigir o P2 no #6 | fechada por **#6 + #7**. O #7 cobre o P2-I1 e o P3-I8 (§4). Ordem de merge **#7 → #6 → main**, só com autorização do Luan |

---

## 0. O que o código real diz (e muda o plano)

1. **O app de hoje é o canal do cliente (paciente).** O `App` tem dois modos: `page` e `widget` com `HostPortal`, o "Portal do paciente". A única conversa viva é `ics-atual`, falando com o bot `ICS Pré-atendimento`. As outras duas conversas são transcrições fixas de demonstração (`src/ui/conversations.ts`). Ou seja, a orientação nova não é "tirar um módulo de bot". Ela troca o **ator principal** do produto: sai o paciente com o bot, entra o agente/supervisor com colegas.
2. **O transporte é de uma conversa por conexão.** `ChatTransport.connect({ conversationId, patientName })` abre *uma* conversa, e `send({ clientId, payload })` não diz para qual conversa a mensagem vai. Trocar de conversa significa reconectar. O P2 do Interrogador (abaixo) é exatamente esse defeito de forma: um `send` pendente "segue" a conexão nova, que pode ser de outra conversa. Um chat interno estilo WhatsApp tem N conversas ao vivo, com não lidas e notificações em todas. Então **o contrato tem de virar multi-conversa**: uma conexão por usuário, e cada `send` e cada evento carregam `conversationId`. Isso elimina por construção a classe de bug do P2.
3. **O bot está costurado no ciclo de conexão do mock.** O `MockTransport` usa `welcomeGate`, `unlockWelcome`, `botQueue`, `runBotTurn` e `ended`, e no PR #6 o `whenReady()` de `send`/`upload` espera o `welcomeGate` (as boas-vindas do bot). O teste do PR #6 que sincroniza com o bot se chama "upload desconectado rejeita e em connecting espera as boas-vindas". Remover o bot mexe exatamente nos arquivos que o PR #6 mais alterou.
4. **A mídia do PR #6 está quase toda fora do bot.** `src/domain/attachment.ts`, `src/chat/uploads.ts`, `src/ui/attachments/*`, `useFileDrop`, `useObjectUrl` e `objectUrls` não sabem que o bot existe. O acoplamento fica em `MockTransport.ts`, `ChatSession.ts` (`ended`), `ChatPanel.tsx` e nos testes que usam o texto das boas-vindas como ponto de sincronização. `ChatPanel.test.tsx` tem 84 ocorrências de "Olá", "Encerrar o Atendimento", "Pré-atendimento" e afins, e `e2e/conversations.spec.ts` tem 25.
5. **Nada no código conhece empresa, login ou permissão.** O único "usuário" é o `patientName` vindo da URL. Por isso tenant, roles com admin e grants entram **juntos com o redesenho do contrato na Etapa 4**, a mesma reescrita de `ChatTransport`/`MockTransport`/`ChatSession`. Fazer depois obrigaria a passar `tenantId` por um contrato recém-reescrito, e seria retrabalho certo.

Consequência para a ordem sugerida: **a mídia não é mais uma etapa futura.** Ela já está pronta no PR #6. O plano fecha o PR #6 primeiro e depois carrega a mídia como regressão obrigatória em cada etapa (direta, grupo, aviso).

---

## 1. Etapas (uma por vez; o Luan testa entre elas)

Regras que valem em **todas** as etapas, com gate em todo PR:
- O layout segue o WhatsApp Web: duas colunas a partir de 901 px e lista/chat alternados em ≤900 px, como hoje (`useMediaQuery('(max-width: 900px)')`, `chatHistory`). Tela cheia (`100dvh`) em qualquer tamanho.
- As cores vêm **só** de tokens semânticos ViaVoip. `contrast.test.ts` e `contrast.computed.test.tsx` continuam verdes, e hex só aparece dentro de `:root` em `chat.css`. Gate: `rg -n "#[0-9a-fA-F]{3,8}" src --glob '!src/styles/chat.css'` não devolve nada novo.
- O "vermelho" do alerta de aviso (Etapa 8) também é token: `--alert`/`--on-alert`, entrando em `:root` com teste de contraste.
- O gate é `npm run lint`, `typecheck`, `test`, `build` e `test:e2e` com os projects ativos e axe.
- Backend é só o mock, e os tipos do contrato são o que o SM vai implementar depois.
- **Desde a Etapa 4, toda escrita no mock passa por `can`, e todo evento é filtrado por tenant.** Os testes de isolamento (§2.11) entram na suíte e não saem mais.

### Etapa 2 (fechamento): PR #6 + PR #7
- **Estado:**
  - o PR #7 (`codex/corrigir-ciclo-conexao-pr6` @ `6981931`, base `cursor/etapa-2-midia-67c3` @ `5e903b5`) mexe só em `src/transport/MockTransport.ts` (+30/−19) e acrescenta `src/transport/MockTransport.regression.test.ts` (8 casos);
  - os dois check runs `verify` do CI estão `success`;
  - o PR #7 não tem reviews nem comentários.
- **O que o #7 cobre** (detalhe em §4):
  - o P2-I1 (send e upload);
  - os 3 testes pedidos pela v2;
  - o P3-I8 (mensagem em voo agora chega a `read` ao reconectar na mesma conversa). Por isso ele **deixa de ser residual**.
- **O que falta (opcional, não bloqueia):**
  - a defesa em profundidade na `ChatSession.apply`, para ignorar `message`/`status` de outro `conversationId`. A Etapa 4 torna isso estrutural de qualquer forma;
  - trocar os `setTimeout` reais do teste de regressão por fake timers, para evitar flakiness no CI (P3).
- **Aceite:**
  - a suíte do #7 verde: 275 Vitest e e2e 70 passed / 140 skipped, segundo o PR, e CI verde;
  - verificação independente: na minha cópia (#6 + os arquivos do #7), as 14 sondas do Interrogador também passam, **inclusive I1, I2, S1, S2 e I8, que falhavam no `5e903b5`**. Resultado: 289/289.
- **Ordem de merge, só com autorização do Luan:**
  1. **#7 → branch do #6.** Como a base do #7 é a branch do #6, isso equivale a atualizar o #6.
  2. O Luan reteste o #6 (`?falha=upload`, `?upload=lento`, layout).
  3. **#6 → `main`.**
- **Depende de:** nada.

### Etapa 3: Subtração (bot, canal do paciente e demonstrações)
*Sem mudança desde a v2.*
- **Escopo:** só remoção, sem feature nova. O inventário está na §3.
  - O mock fica com uma "Conversa de teste" e sem resposta automática. Os ticks continuam `sending → sent → delivered → read`.
  - Sai o modo widget com `HostPortal` (o cliente é futuro). Sugiro que o Luan crie a tag `cliente-widget-v1` antes do merge.
  - O Playwright passa de 5 para **4 projects** (`1366`, `1920`, `2560`, `390`).
  - O `welcomeGate` vira `readyGate`.
- **Aceite:**
  - `rg -n -i "bot|preAtendimento|welcome|boas-vindas|menuOption|sendMenuOption|ended|encerr|patientName|paciente|ICS" src e2e` devolve 0 linhas, fora as exceções listadas no PR;
  - Vitest:
    - "connect emite connecting → connected sem mensagem";
    - "send de texto progride até read e nenhuma mensagem de outro autor chega";
    - "send em connecting espera o readyGate e entrega uma vez";
    - os testes de regressão do #7 continuam verdes, adaptados para não depender do bot;
  - toda a mídia (unit e `media.spec.ts`) verde nos 4 projects, mais `fullscreen` e `screenshots/etapa-3`.
- **Depende de:** Etapa 2 em `main`.

### Etapa 4: Empresa, identidade, permissões, sessão simulada e conversas diretas (absorve a antiga Etapa 3)
- **Escopo:**
  - **Domínio (puro, sem UI, primeiros commits):**
    - `src/domain/tenant.ts`: `Tenant` com `timeZone`;
    - `src/domain/identity.ts`: `User` com `admin | supervisor | agent | client` reservado, `Ilha` e `Directory` (§2.1);
    - `src/domain/capabilities.ts`: catálogo, tetos por role, `Grants` e `canGrant`/`canAssignRole` (§2.7);
    - `src/domain/permissions.ts`: `can(actor, action, ctx)`. A primeira checagem é o tenant, e depois capacidade, pertença e público;
    - `src/domain/conversation.ts`: a direta por enquanto, mais o `conversationTier` para a ordenação (§2.2).
  - A mensagem troca `direction` por `authorId` e ganha `tenantId`.
  - **Contrato multi-conversa e multiempresa** (§2.9):
    - `connect({ tenantId, userId })` devolve um `Bootstrap` com o tenant, o usuário, os grants, o diretório **do tenant**, as conversas, as mensagens recentes e as não lidas;
    - `send`, `upload`, `markRead` e `openDirect` levam `conversationId`;
    - os eventos levam `tenantId` e `conversationId`;
    - `ended` sai.
  - **Mock** (§2.10):
    - o `MockServer` é puro e **particionado por tenant**;
    - o `MockStore` vem em versão memória ou localStorage, e o `TabSync` usa `BroadcastChannel`;
    - a seed tem **2 empresas** para o isolamento ser exercitado manualmente.
  - **Sessão simulada:**
    - tela "Entrar como", com usuários agrupados por empresa;
    - atalho `?como=<userId>` (o tenant vem do usuário);
    - a sessão fica em `sessionStorage` por aba;
    - botão "Trocar usuário".
    - O admin entra numa tela placeholder "Administração (Etapa 5)", porque por padrão não usa o chat (§5).
  - **`ChatSession`:** `conversations: Record<ConversationId, ThreadState>`, reaproveitando aliases, `pendingStatus`, `mergeStatus` e `uploads` por conversa.
  - **UI:**
    - a sidebar tem seções **"Grupos e supervisão"** (grupos, que aparecem na Etapa 6, e a direta com o próprio supervisor; para o supervisor, as diretas com os agentes das ilhas dele) e **"Colegas"** (as outras diretas da empresa);
    - dentro de cada seção, ordena pela última atividade; as não lidas aparecem nas duas;
    - "Nova conversa" abre um seletor filtrado por `can(..., 'direct.open')`. Agente com agente é permitido dentro do tenant;
    - o cabeçalho mostra o nome e a role do outro lado.
- **Aceite:**
  - Vitest de domínio:
    - `capabilities.test.ts`, **matriz** `canGrant`/`canAssignRole` em tabela, cobrindo todos os pares de role e o catálogo (§2.7);
    - `capabilities.property.test.ts` (fast-check, dependência de dev nova): as propriedades P1 a P6 da §2.7;
    - `permissions.test.ts`, matriz de `can`:
      - agente↔agente do mesmo tenant: sim;
      - de outro tenant: **não**;
      - agente sem `chat.use`: não envia;
      - admin sem `chat.use`: não aparece no seletor;
    - `conversation.test.ts`: `directConversation(a, a)` dá erro; ordem (a,b) e (b,a) gera o mesmo id; participantes de tenants diferentes dão erro `cross-tenant`; `conversationTier` coloca grupo e supervisor antes de colega.
  - Vitest de isolamento (§2.11):
    - `tenantIsolation.property.test.ts`: sequências aleatórias de operações sobre 2 tenants nunca entregam um evento a um usuário de outro tenant;
    - o `Bootstrap` de A não contém nenhum id de B;
    - `openDirect` com um usuário de B rejeita com `ForbiddenError`.
  - Vitest de mock e sessão:
    - "send em c1 com c2 aberto não altera c2";
    - "duas conversas com uploads simultâneos não se misturam";
    - "retry reusa clientId e conversationId";
    - mensagem em voo depois de reconectar fecha em `read` ou `error`, nunca fica em `sending`.
  - Playwright:
    - `two-users.spec.ts` (1366, duas `page` no mesmo `context`):
      - a supervisora envia, o agente vê a não lida e abre, e a supervisora vê **Lida**;
      - agente↔agente funciona;
      - a direta com o supervisor aparece na seção "Grupos e supervisão" acima de "Colegas";
    - `tenant.spec.ts`: um usuário da empresa B não vê ninguém da A no seletor nem na lista;
    - `login.spec.ts`;
    - `media.spec.ts` numa direta;
    - `fullscreen` e `screenshots`, com axe.
- **Depende de:** Etapa 3.
- **Tamanho:** é a maior etapa. Os commits seguem a ordem domínio → mock → sessão → UI, e cada bloco fica verde sozinho. Se o Luan quiser uma pausa a mais, o corte natural é "domínio + mock" (sem tela) e depois "sessão + UI", mas o primeiro bloco não é testável à mão.

### Etapa 5 (nova): Console de administração (supervisores e permissões)
- **Por que aqui:**
  - a tela só depende do domínio de capacidades da Etapa 4;
  - ela renderiza a partir do **catálogo** (`CAPABILITIES`), então as capacidades das etapas seguintes aparecem sozinhas, sem retrabalho;
  - com ela, o Luan já testa grupos e avisos (6 e 8) ligando e desligando permissões de um supervisor.
- **Escopo:**
  - Aba "Administração", visível se `can(me, 'admin.console')`. Por padrão, só o admin.
  - **Supervisores:** listar, cadastrar (nome, ilhas), desativar e reativar. Desativar bloqueia o login e preserva o histórico.
  - **Ilhas:** criar, renomear e atribuir supervisor. Agentes: cadastrar, mover de ilha e desativar.
  - **Permissões por usuário:** uma lista de capacidades do catálogo com chaves liga/desliga.
    - Cada chave usa `canGrant`/`canRevoke`.
    - Uma chave bloqueada mostra o motivo, vindo de `GrantDenial` (§2.7): por exemplo, "acima do papel", "você não possui", "não pode alterar a si mesmo".
    - O próprio usuário logado aparece **somente leitura**.
  - O mock valida no servidor com as **mesmas** funções e registra cada concessão e revogação em `grantLog` (quem, para quem, o quê, quando). O log aparece na tela.
  - Sem senha nem convite por e-mail. A "conta" é só o registro no mock, e a autenticação fica para o SM.
- **Aceite:**
  - Vitest:
    - `adminConsole.test.tsx`: o admin concede `announcement.publish` a um supervisor e a chave fica ligada;
    - a linha do próprio admin aparece desabilitada com "não pode alterar a si mesmo";
    - capacidade fora do teto de agente aparece desabilitada com "acima do papel";
    - o `MockServer` rejeita `grant` forjado (supervisor → supervisor, agente → qualquer um, self-grant, cross-tenant) com `ForbiddenError` e não grava log.
  - Playwright `admin.spec.ts` (1366 e 390, axe):
    - o admin cadastra a supervisora "Paula", na Ilha Sul, e liga `group.manage`;
    - uma segunda página entra como Paula e vê "Novo grupo" habilitado (a UI de grupo é da Etapa 6; nesta etapa só o botão e o seletor);
    - o admin desliga a permissão e o botão some em Paula sem reload, porque chega o evento `grants`;
    - o supervisor não vê a aba "Administração".
- **Depende de:** Etapa 4.

### Etapa 6: Ilhas e grupos
- **Escopo:**
  - `GroupConversation` com `tenantId` (§2.2).
  - "Novo grupo" e "Editar grupo" (nome e membros) exigem `can(me, 'group.manage', grupo)`. Isso pede a capacidade `group.manage`, que só cabe no teto de supervisor e admin, e que seja o próprio grupo (ou o admin).
  - O fluxo tem três passos: escolher a ilha (opcional), que pré-seleciona os agentes dela; ajustar os membros (só do tenant); dar um nome.
  - Mensagens de sistema: "criou", "adicionou", "removeu", "renomeou".
  - Os grupos entram na seção "Grupos e supervisão", e a sidebar ganha o chip "Grupos".
  - Em grupo, o nome do autor aparece acima dos balões de terceiros, e o `read` só vale quando todos leram.
  - Membros removidos deixam de receber mensagens, e o histórico deles fica somente leitura.
- **Aceite:**
  - Vitest:
    - um grupo sem o criador, um grupo vazio e um grupo com membro de outro tenant são inválidos;
    - `permissions.test.ts`: agente não cria nem edita; supervisor sem `group.manage` não cria; supervisor não edita grupo de outro supervisor;
    - `MockServer.test.ts`: criar o grupo emite `conversation` só para os membros; o membro removido não recebe a mensagem seguinte;
    - `groupStatus.test.ts`.
  - Playwright `groups.spec.ts` (1366 e 390):
    - criar "Ilha Norte" com dois agentes;
    - o agente vê o grupo no topo, em "Grupos e supervisão";
    - foto com legenda no grupo;
    - o agente não vê "Novo grupo";
    - remover um membro.
- **Depende de:** Etapa 5, para testar com permissão ligada e desligada. Tecnicamente só precisa da 4.

### Etapa 7: Notificações (sistema, som e visual), igual ao WhatsApp Web
- **Escopo:** com a aba **aberta ou minimizada**. Com o navegador fechado está **fora do escopo, por decisão do Luan**: sem Service Worker e sem Push.
  - Porta `Notifier` (§2.8) com `BrowserNotifier` (`new Notification` e `HTMLAudioElement`) e `FakeNotifier`.
  - A política pura `notificationDecision` funciona como na v2: aba oculta ou sem foco → notificação do sistema; visível em outra conversa → toast e som; conversa aberta → nada; nunca mensagem própria nem conversa silenciada.
  - O banner "Ativar notificações" pede a permissão só no clique e toca um som de teste, o que destrava o autoplay. Com `denied`, aparecem as instruções e o alerta continua só in-app.
  - Alertas visuais: título "(N) ViaVoip", badge, toast `role="status"`. Clicar na notificação faz `window.focus()` e abre a conversa.
  - Som: no máximo um a cada 3 s por conversa, e silenciar fica salvo em preferência. Com a página oculta, o som vem do toast do SO.
  - `?simular=mensagens` para o teste manual no Windows.
- **Aceite:** igual à v2:
  - `notificationPolicy.test.ts` em tabela;
  - `useNotifications.test.tsx` com `FakeNotifier`;
  - `notifications.spec.ts` com espião em `window.Notification` e `visibilityState` forçado a `hidden`;
  - checklist manual no Chrome e no Edge do Windows com a aba minimizada.
  - Novo: um evento de outro tenant nunca chega ao `Notifier`. É um caso da tabela, e o filtro está no transporte (§2.11).
- **Depende de:** Etapa 6.

### Etapa 8: Quadro de avisos (publicar, editar, expirar, ver e dar ciência)
- **Escopo:**
  - **Domínio:** `Announcement` com revisões, a união `Audience` (`all | groups | people`) e `ReceiptState` por revisão de ciência (§2.4 e §2.5), mais as funções puras de "dia" (`localDateIn`, `isFirstLoginOfDay`).
  - **Publicar** (`can(me, 'announcement.publish')`):
    - campos: título, texto e anexos, que reaproveitam `validateFiles`/`MEDIA_RULES`/`upload`;
    - público, com 3 opções: *todos da empresa*, *grupos escolhidos* ou *pessoas escolhidas*;
    - "exige ciência", ligado por padrão;
    - **expiração opcional**, com data e hora no fuso da empresa;
    - o público é **resolvido na publicação** para uma lista de `UserId`, e é essa lista que define quem vê e quem conta (§2.4).
  - **Editar** (o autor, com `announcement.publish`):
    - cada salvamento cria uma `AnnouncementRevision`;
    - o editor pergunta "Alteração importante (pede ciência de novo)", **marcado por padrão** quando muda título, texto ou anexos. Desmarcado, vira "Correção" e não reabre a ciência;
    - mudar só expiração ou público é sempre não material. Quem entra no público fica `unseen`; quem sai perde o acesso, e o receipt fica no histórico;
    - os agentes veem "Editado às HH:MM";
    - o autor vê o histórico de revisões e o tally por revisão.
  - **Só o público vê:** o quadro lista só os avisos com `can(me, 'announcement.read', a)`, ou seja, estar em `audienceUserIds` ou ser o autor, além de não estar expirado. O expirado some do quadro do agente, e o autor o vê em "Encerrados".
  - **Visualização automática:** card ≥60 % visível por ≥1 s ou abrir o detalhe chama `markViewed(revisão)`.
  - **Ciência explícita:** "Estou ciente" chama `acknowledge(revisão de ciência)`. As duas continuam distintas.
  - **Primeiro login do dia:**
    - no `connect`, o servidor do mock compara `lastLoginDate` com `localDateIn(now, tenant.timeZone)` e devolve `firstLoginOfDay` no `Bootstrap`, gravando a data nova;
    - se for o primeiro login e houver aviso `unseen` ou com ciência pendente, aparece uma notificação "Você tem N avisos" (toast in-app; a do sistema só se a aba estiver oculta) e o app **abre direto na aba Avisos**, no primeiro pendente;
    - ver o aviso continua exigindo a visualização real, porque abrir a aba não conta.
  - **Ao longo do dia** (não é o primeiro login, ou chegou aviso novo com o app aberto):
    - aparece o **alerta vermelho no canto superior direito**: um botão fixo "N avisos novos", com token `--alert`, `role="alert"` só na primeira aparição;
    - ele **fica até o clique** e **não trava o chat**;
    - o clique abre a aba Avisos no detalhe do mais recente, o que conta como visualização; a ciência é dada ali;
    - o alerta é derivado (§2.5), sem estado extra: some quando não há mais aviso `unseen`, e o clique abre o detalhe;
    - se o agente clicou mas ainda deve ciência, fica o badge da aba Avisos, mas não o alerta.
  - O autor vê quem viu, quem deu ciência e quem falta, para a revisão atual.
  - Notificação de aviso novo pela Etapa 7.
- **Aceite:**
  - Vitest:
    - `day.test.ts`: `localDateIn` em `America/Sao_Paulo` e `America/Manaus` na virada (23:59 → 00:01); em `isFirstLoginOfDay`, o mesmo dia é falso e o dia seguinte é verdadeiro; dois logins no mesmo dia só fazem o primeiro valer;
    - `audience.test.ts` com as 3 variantes. Grupos e pessoas exigem lista não vazia (o tipo garante). Grupo ou pessoa de outro tenant dão `cross-tenant`;
    - `revision.test.ts`:
      - edição material cria a revisão N+1 e reabre a ciência (receipt da revisão nova `unseen`);
      - correção mantém o receipt;
      - adicionar alguém ao público deixa essa pessoa `unseen`, e remover tira o acesso;
    - `receipt.test.ts`, como na v2, mais o caso de ciência ligada a uma revisão antiga que não vale para a nova revisão material;
    - `permissions.test.ts`:
      - quem está fora do público não lê, nem por id direto;
      - agente não publica e não edita;
      - supervisor sem `announcement.publish` não publica;
      - o expirado não é lido pelo agente;
    - `boardAlert.test.ts`: o alerta aparece com aviso `unseen` e o app aberto; não aparece no primeiro login do dia, porque aí o app vai direto aos Avisos; some depois da visualização.
  - Playwright `announcements.spec.ts` (1366 e 390, axe), com relógio do mock injetável via `?agora=`:
    - **primeiro login do dia:** o agente entra e cai direto na aba Avisos, com toast "1 aviso";
    - **segundo login no mesmo dia:** não redireciona;
    - **aviso durante o dia:** a supervisora publica com o agente no chat; o alerta vermelho aparece no canto superior direito, o composer continua habilitado, o clique abre o detalhe, "Estou ciente" e o tally mostra "Ciência 1/1";
    - **edição material:** a ciência reabre e o alerta volta;
    - **expiração:** com `?agora=` depois do vencimento, o aviso some para o agente;
    - **público "pessoas":** quem não foi escolhido não vê o aviso.
- **Depende de:** Etapas 6 e 7. A mídia vem da Etapa 2.

### Etapa 9: Interação e encaminhamento de avisos
- **Escopo:**
  - Reações (uma por usuário) e comentários (texto; o autor edita e remove; o autor do aviso modera com `announcement.moderate` e pode encerrar os comentários). Só o público interage.
  - **Encaminhar:**
    - o seletor lista as conversas em que o usuário é membro e **habilita só os destinos em que todos os membros estão no público** do aviso (`canForwardTo`, §2.6);
    - os destinos bloqueados aparecem desabilitados com o motivo "Nem todos neste grupo podem ver este aviso";
    - a mensagem encaminhada leva **só a referência** (`announcementId`), sem cópia do conteúdo;
    - o balão busca o aviso e renderiza o card se `can(read)`. Se não puder, porque saiu do público depois, foi removido do grupo ou o aviso expirou, mostra "Aviso restrito" ou "Aviso encerrado", sem título;
    - a prévia na sidebar é "Aviso encaminhado".
  - Comentário notifica o autor do aviso e quem já comentou.
- **Aceite:**
  - Vitest:
    - `canForwardTo`: um grupo com 1 membro fora do público é falso; uma direta com o colega no público é verdadeiro; um destino de outro tenant é falso;
    - o `MockServer` rejeita um encaminhamento forjado para um destino não coberto;
    - render de `AnnouncementMessage` para quem saiu do público mostra "Aviso restrito", e **o título não aparece no DOM**;
    - `previewOf` devolve "Aviso encaminhado";
    - reações e comentários como na v2.
  - Playwright `announcement-interactions.spec.ts`:
    - reagir e comentar;
    - encaminhar para um grupo totalmente coberto: outro agente abre o card;
    - um grupo com alguém fora do público aparece desabilitado;
    - depois de tirar um membro do público, ele vê "Aviso restrito".
- **Depende de:** Etapas 6 e 8.

---

## 2. Tipos e contrato principais

Os tipos abaixo são o esboço: os nomes valem e o corpo das funções fica com o implementador. Todo id é branded, e **toda entidade de domínio carrega `tenantId`**.

### 2.1 Empresa, identidade e roles (`src/domain/tenant.ts`, `src/domain/identity.ts`)

```ts
declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type TenantId = Brand<string, 'TenantId'>;
export type UserId = Brand<string, 'UserId'>;
export type IlhaId = Brand<string, 'IlhaId'>;
export type LocalDate = Brand<string, 'LocalDate'>;        // 'YYYY-MM-DD' no fuso da empresa

export type Tenant = {
  readonly id: TenantId;
  readonly name: string;
  readonly timeZone: string;                                // IANA, ex. 'America/Sao_Paulo'; define o "dia"
};

export type Role = 'admin' | 'supervisor' | 'agent' | 'client';

type UserBase = {
  readonly id: UserId;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly active: boolean;                                 // desativado não loga; histórico fica
  readonly grants: Grants;                                  // §2.7, sempre ⊆ teto da role
};

export type Admin = UserBase & { readonly role: 'admin' };  // dono da empresa; criado fora do app (provisionamento)
export type Supervisor = UserBase & { readonly role: 'supervisor' };
export type Agent = UserBase & { readonly role: 'agent'; readonly ilhaId: IlhaId };
/** Reservado para o canal do cliente. Nunca entra em sessão interna. */
export type ClientUser = Omit<UserBase, 'grants'> & { readonly role: 'client' };

export type User = Admin | Supervisor | Agent | ClientUser;
export type StaffUser = Admin | Supervisor | Agent;

export type Ilha = {
  readonly id: IlhaId;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly supervisorId: UserId;
};

/** Sempre de UM tenant. O tipo não impede misturar, mas validateDirectory e os testes de isolamento impedem. */
export type Directory = {
  readonly tenantId: TenantId;
  readonly users: Readonly<Record<UserId, StaffUser>>;
  readonly ilhas: Readonly<Record<IlhaId, Ilha>>;
};

export function validateDirectory(d: Directory): Result<Directory, 'cross-tenant' | 'orphan-agent' | 'grant-above-ceiling'>;
export function supervisorOf(d: Directory, agent: Agent): Supervisor | undefined;
export function parseStaffUser(raw: unknown): StaffUser | { error: 'client-not-supported' | 'invalid' };

/** Mantido pelo servidor (mock/SM), não pelo front. */
export type LoginRecord = { readonly userId: UserId; readonly lastLoginDate: LocalDate | null };
```

### 2.2 Conversas e ordenação (`src/domain/conversation.ts`)

```ts
export type ConversationId = Brand<string, 'ConversationId'>;
export type DirectPair = Brand<readonly [UserId, UserId], 'DirectPair'>;   // 2, distintos, ordenados

export type DirectConversation = {
  readonly kind: 'direct';
  readonly id: ConversationId;              // `dm:${tenantId}:${menor}:${maior}`
  readonly tenantId: TenantId;
  readonly participants: DirectPair;
};

export type GroupConversation = {
  readonly kind: 'group';
  readonly id: ConversationId;
  readonly tenantId: TenantId;
  readonly title: string;
  readonly createdBy: UserId;
  readonly members: readonly [UserId, ...UserId[]];
  readonly ilhaId: IlhaId | null;
  readonly createdAt: string;
};

export type Conversation = DirectConversation | GroupConversation;
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function directConversation(a: StaffUser, b: StaffUser): Result<DirectConversation, 'same-user' | 'cross-tenant'>;
export function groupConversation(input: { /* … */ members: readonly StaffUser[]; /* … */ }):
  Result<GroupConversation, 'empty-title' | 'creator-not-member' | 'duplicate-member' | 'cross-tenant'>;

/** Prioridade na lista: 'priority' = grupos + direta com o supervisor (ou, para o supervisor, com agentes das suas ilhas). */
export type ConversationTier = 'priority' | 'colleagues';
export function conversationTier(c: Conversation, me: StaffUser, d: Directory): ConversationTier;
export function sortConversations(items: readonly ConversationSummary[], me: StaffUser, d: Directory): {
  readonly priority: readonly ConversationSummary[];      // por última atividade desc
  readonly colleagues: readonly ConversationSummary[];
};
```

### 2.3 Mensagem (mudanças em `src/domain/message.ts`)

Funciona como na v2: sai `direction`, `MenuOption` e `menu`, e entram `authorId` e `SystemMessage`. Muda o seguinte:

```ts
type MessageBase = {
  id: string; tenantId: TenantId; conversationId: ConversationId; clientId?: string;
  authorId: UserId; timestamp: string; status: MessageStatus;
};

/** Aviso encaminhado: SÓ referência. O conteúdo é buscado e renderizado se can(read). */
export type AnnouncementMessage = MessageBase & { type: 'announcement'; announcementId: AnnouncementId };
```

O `previewOf(announcement)` devolve `'Aviso encaminhado'`, sem título, para nunca vazar o conteúdo na sidebar.

### 2.4 Avisos, público e revisões (`src/domain/announcement.ts`)

```ts
export type AnnouncementId = Brand<string, 'AnnouncementId'>;
export type RevisionNo = Brand<number, 'RevisionNo'>;          // 1, 2, 3…

export type AnnouncementAttachment =
  Extract<OutboundPayload, { type: 'image' | 'video' | 'audio' | 'document' }> & { readonly clientId: string };

/** Escolha do supervisor. Listas não vazias por tipo. */
export type Audience =
  | { readonly kind: 'all' }                                                        // todos os StaffUser ativos com chat.use do tenant
  | { readonly kind: 'groups'; readonly groupIds: readonly [ConversationId, ...ConversationId[]] }
  | { readonly kind: 'people'; readonly userIds: readonly [UserId, ...UserId[]] };

export type AnnouncementContent = {
  readonly title: string;                       // 1..120
  readonly body: string;                        // 0..4000
  readonly attachments: readonly AnnouncementAttachment[];
};

export type AnnouncementRevision = {
  readonly no: RevisionNo;
  readonly content: AnnouncementContent;
  readonly editedAt: string;
  readonly editedBy: UserId;
  readonly material: boolean;                   // true na revisão 1; material ⇒ reabre ciência
};

export type Announcement = {
  readonly id: AnnouncementId;
  readonly tenantId: TenantId;
  readonly authorId: UserId;
  readonly audience: Audience;                  // a escolha (para editar)
  readonly audienceUserIds: readonly UserId[];  // resolvido na publicação/edição (quem vê e quem conta)
  readonly requiresAck: boolean;
  readonly publishedAt: string;
  readonly expiresAt: string | null;            // opcional, definido pelo supervisor
  readonly revisions: readonly [AnnouncementRevision, ...AnnouncementRevision[]];
  readonly commentsClosed: boolean;
};

export function currentRevision(a: Announcement): AnnouncementRevision;
/** Última revisão material: é contra ela que a ciência vale. */
export function ackRevision(a: Announcement): RevisionNo;
export function resolveAudience(aud: Audience, d: Directory, groups: readonly GroupConversation[]):
  Result<readonly UserId[], 'cross-tenant' | 'unknown-group' | 'unknown-user'>;
export function isExpired(a: Announcement, now: string): boolean;

export type AnnouncementEdit =
  | { readonly kind: 'content'; readonly content: AnnouncementContent; readonly material: boolean }
  | { readonly kind: 'expiry'; readonly expiresAt: string | null }      // nunca material
  | { readonly kind: 'audience'; readonly audience: Audience };         // nunca material; recalcula audienceUserIds
export function applyEdit(a: Announcement, e: AnnouncementEdit, by: UserId, at: string, d: Directory,
  groups: readonly GroupConversation[]): Result<Announcement, 'cross-tenant' | 'unknown-group' | 'unknown-user' | 'no-change'>;
```

**Decisão sobre a edição** (a recomendação do Luan, assumida):
- toda edição de conteúdo vira uma revisão nova e o histórico fica guardado;
- a edição *material*, marcada pelo autor e sugerida quando o conteúdo muda, move `ackRevision`, e a ciência anterior deixa de valer para a revisão atual, mas fica no histórico;
- a *correção* (não material) não reabre nada;
- expiração e público nunca são materiais.

O "público resolvido na publicação" é uma foto. A alternativa, membros dinâmicos de grupo, está em §5.

### 2.5 Visualização, ciência, dia e alerta (`src/domain/receipt.ts`, `src/domain/day.ts`)

```ts
export type ReceiptState =
  | { readonly phase: 'unseen' }
  | { readonly phase: 'viewed'; readonly viewedAt: string }
  | { readonly phase: 'acknowledged'; readonly viewedAt: string; readonly acknowledgedAt: string };

/** Um receipt por (aviso, usuário, revisão de ciência). Revisões antigas ficam como histórico. */
export type AnnouncementReceipt = {
  readonly tenantId: TenantId;
  readonly announcementId: AnnouncementId;
  readonly userId: UserId;
  readonly revision: RevisionNo;               // = ackRevision no momento
  readonly state: ReceiptState;
};

export type ReceiptEvent = { readonly type: 'viewed'; readonly at: string } | { readonly type: 'acknowledged'; readonly at: string };
export function nextReceipt(state: ReceiptState, event: ReceiptEvent): ReceiptState;   // pura, idempotente; ciência a partir de unseen grava viewedAt=at

export function localDateIn(instant: string, timeZone: string): LocalDate;           // Intl.DateTimeFormat('en-CA', { timeZone })
export function isFirstLoginOfDay(last: LocalDate | null, today: LocalDate): boolean;

export type BoardEntry = { readonly announcement: Announcement; readonly receipt: ReceiptState };

/** O que o app faz ao conectar e ao receber avisos. Derivado, sem estado extra. */
export type BoardPrompt =
  | { readonly kind: 'none' }
  | { readonly kind: 'open-board'; readonly first: AnnouncementId; readonly count: number }   // 1º login do dia com pendências
  | { readonly kind: 'corner-alert'; readonly newest: AnnouncementId; readonly count: number }; // ao longo do dia: unseen
export function boardPrompt(input: {
  readonly entries: readonly BoardEntry[];     // já filtrados por can(read) e não expirados
  readonly firstLoginOfDay: boolean;
  readonly redirectedThisSession: boolean;
}): BoardPrompt;
```

Regras de `boardPrompt`:
- é primeiro login do dia, existe pendência (`unseen` ou ciência pendente) e o app ainda não redirecionou nesta sessão: `open-board`;
- senão, existe `unseen`: `corner-alert`;
- senão, `none`.

O alerta some sozinho quando o clique abre o detalhe, porque o detalhe marca a visualização. A ciência pendente sem `unseen` só aparece no badge da aba.

### 2.6 Interação e encaminhamento (`src/domain/announcementInteraction.ts`)

```ts
export type Reaction = { readonly tenantId: TenantId; readonly announcementId: AnnouncementId; readonly userId: UserId; readonly emoji: string };
export function toggleReaction(current: Reaction | undefined, next: Reaction): Reaction | undefined;

export type AnnouncementComment = {
  readonly id: CommentId; readonly tenantId: TenantId; readonly announcementId: AnnouncementId;
  readonly authorId: UserId; readonly text: string; readonly createdAt: string;
  readonly editedAt: string | null; readonly deleted: boolean;
};

export type ForwardRequest = {
  readonly announcementId: AnnouncementId;
  readonly targets: readonly [ConversationId, ...ConversationId[]];   // 1..5
  readonly clientId: string;
};

export type ForwardDenial = 'not-member' | 'audience-not-covering' | 'cross-tenant' | 'expired' | 'not-readable';
/** Destino válido ⇔ mesmo tenant ∧ ator é membro ∧ TODO membro do destino ∈ audienceUserIds (ou é o autor). */
export function canForwardTo(actor: StaffUser, a: Announcement, target: Conversation, now: string): Result<true, ForwardDenial>;
```

**Regra escolhida: encaminhar só para destinos totalmente cobertos pelo público, com a mensagem levando só a referência.**
- **Por quê:**
  - o requisito é "quem não está no público não vê o conteúdo", e a regra garante isso **por construção** no momento do encaminhamento;
  - a referência (sem snapshot) faz com que mudanças posteriores, como membro novo no grupo, pessoa removida do público ou aviso expirado, também sejam respeitadas, porque o render sempre passa por `can(read)` e cai em "Aviso restrito";
  - a alternativa de encaminhar para qualquer destino e mostrar "Aviso restrito" para quem não pode deixaria passar o *fato* de que o aviso existe, e geraria balões inúteis em grupos mistos.
- **Dúvida real (§5):** um agente pode ampliar o público encaminhando? Pelo padrão, **não**: só o autor muda o público, editando o aviso.

### 2.7 Capacidades, grants e permissões (`src/domain/capabilities.ts`, `src/domain/permissions.ts`)

```ts
export const CAPABILITIES = [
  'chat.use',                 // participar do chat (diretas, grupos, quadro como público)
  'group.manage',             // criar/editar os próprios grupos
  'announcement.publish',     // publicar/editar/expirar os próprios avisos
  'announcement.receipts',    // ver quem viu/deu ciência nos próprios avisos
  'announcement.moderate',    // moderar comentários dos próprios avisos
  'agents.manage',            // cadastrar/mover/desativar agentes
  'ilhas.manage',             // criar/renomear ilhas, atribuir supervisor
  'supervisors.manage',       // cadastrar/desativar supervisores
  'grants.manage',            // conceder/revogar capacidades (sujeito a canGrant)
  'admin.console',            // ver a aba Administração
] as const;
export type Capability = (typeof CAPABILITIES)[number];
export type Grants = ReadonlySet<Capability>;

/** Teto: o máximo que a role pode ter. Grants sempre ⊆ teto. */
export const ROLE_CEILING: Readonly<Record<'admin' | 'supervisor' | 'agent', ReadonlySet<Capability>>> = {
  admin: new Set(CAPABILITIES),
  supervisor: new Set(['chat.use', 'group.manage', 'announcement.publish', 'announcement.receipts', 'announcement.moderate']),
  agent: new Set(['chat.use']),
};

/** Padrão ao cadastrar. Admin: fixado no provisionamento (fora do app), sem chat.use por padrão (§5). */
export const ROLE_DEFAULT: Readonly<Record<'admin' | 'supervisor' | 'agent', ReadonlySet<Capability>>> = {
  admin: new Set(CAPABILITIES.filter((c) => c !== 'chat.use')),
  supervisor: new Set(['chat.use', 'group.manage', 'announcement.publish', 'announcement.receipts', 'announcement.moderate']),
  agent: new Set(['chat.use']),
};

export const ROLE_RANK = { admin: 3, supervisor: 2, agent: 1 } as const;

export type GrantDenial =
  | 'cross-tenant' | 'self' | 'actor-inactive' | 'no-grants-manage'
  | 'actor-lacks-capability'      // ninguém concede o que não tem
  | 'above-target-ceiling'        // capacidade fora do teto da role do alvo
  | 'not-higher-rank';            // só concede para role estritamente abaixo

export function canGrant(actor: StaffUser, target: StaffUser, capability: Capability): Result<true, GrantDenial>;
export function canRevoke(actor: StaffUser, target: StaffUser, capability: Capability): Result<true, Exclude<GrantDenial, 'above-target-ceiling'>>;

export type RoleDenial = 'cross-tenant' | 'self' | 'no-manage-capability' | 'role-not-assignable';
/** Criar usuário com role X, ou mudar role de alguém. Ninguém atribui 'admin'. Supervisor nunca atribui 'supervisor'. */
export function canAssignRole(actor: StaffUser, target: StaffUser | { tenantId: TenantId }, role: 'supervisor' | 'agent'): Result<true, RoleDenial>;
```

As regras de `canGrant`, em ordem (a primeira que falha vira a negação):
1. mesmo tenant;
2. o alvo não é o ator, porque ninguém altera as próprias permissões;
3. o ator está ativo e tem `grants.manage`;
4. o ator **tem** a capacidade concedida;
5. a capacidade ∈ `ROLE_CEILING[target.role]`;
6. `ROLE_RANK[actor] > ROLE_RANK[target]`.

As regras de `canAssignRole`:
- `supervisor` exige `supervisors.manage`. Na prática, só o admin tem essa capacidade, porque ela está fora do teto do supervisor;
- `agent` exige `agents.manage`;
- `admin` não é atribuível no app;
- nunca para si mesmo;
- mudar a role de alguém zera os grants para `ROLE_DEFAULT` da role nova, `∩ teto`.

**O que cada role pode conceder** (padrão):

| Ator → alvo | Pode conceder | Pode atribuir role | Não pode |
|---|---|---|---|
| Admin → Supervisor | qualquer capacidade do teto do supervisor | criar/desativar supervisor | conceder `supervisors.manage`/`grants.manage`/`agents.manage`/`ilhas.manage`/`admin.console`, que estão fora do teto |
| Admin → Agente | `chat.use` (ligar/desligar) | criar/mover/desativar agente | qualquer outra (teto do agente) |
| Admin → Admin / si mesmo | nada | nada | criar admin; alterar a si mesmo |
| Supervisor → qualquer um | **nada** (`grants.manage` fica fora do teto) | **nada** (`agents.manage` fica fora do teto) | atribuir supervisor/admin, conceder qualquer coisa |
| Agente → qualquer um | nada | nada | tudo |

O cadastro de agentes pelo supervisor ficou de fora por padrão e está em §5. Se o Luan quiser, basta pôr `agents.manage` no teto do supervisor, e o `canAssignRole` já impede que ele atribua `supervisor`.

Revogação: os grants que o alvo deu a outros **não** são revogados em cascata. Isso é seguro, porque todo grant fica dentro do teto da role, e o `grantLog` guarda quem concedeu (§5).

**Testes de propriedade** (fast-check, em `capabilities.property.test.ts`):
- **P1, sem autoconcessão:** para todo ator e capacidade, `canGrant(a, a, c)` falha.
- **P2, sem concessão sem posse:** `canGrant(a, t, c).ok ⇒ c ∈ a.grants`.
- **P3, teto respeitado:** `canGrant(a, t, c).ok ⇒ c ∈ ROLE_CEILING[t.role]`.
- **P4, hierarquia:** `canGrant(a, t, c).ok ⇒ rank(a) > rank(t)`, e portanto o supervisor nunca concede a supervisor nem a admin.
- **P5, fechamento:** a partir de uma seed válida, *qualquer* sequência de operações aceitas (`grant`, `revoke`, `assignRole`, `create`) mantém `validateDirectory` ok. Todo usuário fica com `grants ⊆ teto`, nenhum `admin` novo aparece, ninguém muda a própria role nem os próprios grants, e nenhum supervisor ganha `supervisors.manage`/`grants.manage`.
- **P6, tenant:** `tenant(a) ≠ tenant(t) ⇒` toda operação falha com `cross-tenant`.
- **Matriz** (`capabilities.test.ts`): uma tabela explícita de 3 roles de ator × 3 roles de alvo × 10 capacidades × {mesmo usuário, outro} × {mesmo tenant, outro}, com o resultado esperado e o motivo. É gerada uma vez e revisada à mão.

**Permissão de uso** (`can`):

```ts
export type Action =
  | { type: 'direct.open'; with: StaffUser }
  | { type: 'group.manage'; group?: GroupConversation }          // sem group = criar
  | { type: 'conversation.send'; conversation: Conversation }
  | { type: 'announcement.publish' }
  | { type: 'announcement.edit'; announcement: Announcement }
  | { type: 'announcement.read'; announcement: Announcement; now: string }
  | { type: 'announcement.ack'; announcement: Announcement; now: string }
  | { type: 'announcement.react' | 'announcement.comment'; announcement: Announcement; now: string }
  | { type: 'announcement.receipts' | 'announcement.moderate'; announcement: Announcement }
  | { type: 'announcement.forward'; announcement: Announcement; target: Conversation; now: string }
  | { type: 'admin.console' }
  | { type: 'grant'; target: StaffUser; capability: Capability }
  | { type: 'assignRole'; target: StaffUser | { tenantId: TenantId }; role: 'supervisor' | 'agent' };

export function can(actor: StaffUser, action: Action, d: Directory): Result<true, string>;
```

Regras de `can`, em ordem:
1. Toda entidade referenciada pertence ao tenant do ator. Se não, `cross-tenant`.
2. O ator está ativo.
3. Ações de chat ou quadro exigem `chat.use`.
4. Vem a capacidade específica:
   - `group.manage` exige a capacidade e, para editar, `createdBy === actor` (ou ator admin com `chat.use`);
   - `announcement.publish`/`edit` exigem a capacidade e, para editar, ser o autor;
   - `announcement.read`/`ack`/`react`/`comment` exigem estar em `audienceUserIds` ou ser o autor, e o aviso não pode estar expirado para quem não é o autor;
   - `forward` é igual a `canForwardTo`;
   - `grant` é igual a `canGrant`, e `assignRole` igual a `canAssignRole`.
5. `direct.open`: qualquer `StaffUser` do mesmo tenant com `chat.use`, incluindo **agente↔agente**.

O mock chama as **mesmas** funções. A UI só esconde ou desabilita e mostra o motivo.

### 2.8 Notificações (`src/notifications/`)

Como na v2, com dois acréscimos:
- `NotificationEvent` ganha `tenantId`. O `notificationDecision` devolve tudo `false` se `event.tenantId !== me.tenantId`, como defesa em profundidade, porque o transporte já filtra.
- Entra o novo `{ type: 'board-digest'; tenantId; count; first: AnnouncementId }`, para o primeiro login do dia.

Não existe `ServiceWorker` nem `PushManager`. O `Notifier` usa `new Notification(...)`, exatamente como o WhatsApp Web com a aba aberta ou minimizada.

### 2.9 Contrato do transporte (`src/transport/ChatTransport.ts`)

```ts
export type ConnectRequest = { readonly tenantId: TenantId; readonly userId: UserId };

export type Bootstrap = {
  readonly tenant: Tenant;
  readonly me: StaffUser;                           // com grants
  readonly directory: Directory;                    // só do tenant
  readonly conversations: readonly ConversationSummary[];
  readonly recent: Readonly<Record<ConversationId, readonly ChatMessage[]>>;
  readonly board: readonly BoardEntry[];            // já filtrado por can(read)
  readonly firstLoginOfDay: boolean;                // servidor compara e grava lastLoginDate
};

type Scoped = { readonly tenantId: TenantId };
export type ChatEvent =
  | { type: 'connection'; status: TransportStatus }
  | (Scoped & { type: 'message'; message: ChatMessage })
  | (Scoped & { type: 'status'; conversationId: ConversationId; messageId: string; clientId?: string; status: MessageStatus })
  | (Scoped & { type: 'typing'; conversationId: ConversationId; userId: UserId; isTyping: boolean })
  | (Scoped & { type: 'read'; conversationId: ConversationId; userId: UserId; upToMessageId: string })
  | (Scoped & { type: 'conversation'; conversation: Conversation })
  | (Scoped & { type: 'conversation-removed'; conversationId: ConversationId })
  | (Scoped & { type: 'directory'; user: StaffUser })                 // cadastro/desativação (Etapa 5)
  | (Scoped & { type: 'grants'; userId: UserId; grants: readonly Capability[] })   // Etapa 5
  | (Scoped & { type: 'announcement'; announcement: Announcement })   // publicar/editar/expirar
  | (Scoped & { type: 'announcement-revoked'; announcementId: AnnouncementId })    // saiu do público
  | (Scoped & { type: 'receipt'; receipt: AnnouncementReceipt })
  | (Scoped & { type: 'reaction'; reaction: Reaction; removed: boolean })
  | (Scoped & { type: 'comment'; comment: AnnouncementComment });

export interface ChatTransport {
  // Etapa 4
  connect(r: ConnectRequest): Promise<Bootstrap>;
  disconnect(): void;
  send(r: { conversationId: ConversationId; clientId: string; payload: OutboundPayload }): Promise<void>;
  upload(r: UploadRequest & { conversationId: ConversationId | null }): Promise<UploadedMedia>;
  markRead(r: { conversationId: ConversationId; upToMessageId: string }): Promise<void>;
  openDirect(r: { with: UserId }): Promise<DirectConversation>;
  setTyping(r: { conversationId: ConversationId; isTyping: boolean }): void;
  subscribe(h: ChatEventHandler): () => void;
  getStatus(): TransportStatus;
  // Etapa 5
  createUser(r: { clientId: string; name: string; role: 'supervisor' | 'agent'; ilhaId?: IlhaId }): Promise<StaffUser>;
  setUserActive(r: { userId: UserId; active: boolean }): Promise<StaffUser>;
  upsertIlha(r: { id?: IlhaId; name: string; supervisorId: UserId }): Promise<Ilha>;
  moveAgent(r: { userId: UserId; ilhaId: IlhaId }): Promise<Agent>;
  setGrant(r: { userId: UserId; capability: Capability; granted: boolean }): Promise<StaffUser>;
  grantLog(): Promise<readonly GrantLogEntry[]>;
  // Etapa 6
  createGroup(r: { clientId: string; title: string; memberIds: readonly UserId[]; ilhaId: IlhaId | null }): Promise<GroupConversation>;
  updateGroup(r: { conversationId: ConversationId; title?: string; add?: readonly UserId[]; remove?: readonly UserId[] }): Promise<GroupConversation>;
  // Etapa 8
  publishAnnouncement(r: { clientId: string; content: AnnouncementContent; audience: Audience; requiresAck: boolean; expiresAt: string | null }): Promise<Announcement>;
  editAnnouncement(r: { announcementId: AnnouncementId; edit: AnnouncementEdit }): Promise<Announcement>;
  markAnnouncementViewed(r: { announcementId: AnnouncementId; revision: RevisionNo }): Promise<void>;
  acknowledgeAnnouncement(r: { announcementId: AnnouncementId; revision: RevisionNo }): Promise<void>;
  receiptTally(r: { announcementId: AnnouncementId; revision?: RevisionNo }): Promise<ReceiptTally & { pending: readonly UserId[] }>;
  // Etapa 9
  react(r: { announcementId: AnnouncementId; emoji: string }): Promise<void>;
  comment(r: { announcementId: AnnouncementId; clientId: string; text: string }): Promise<AnnouncementComment>;
  forwardAnnouncement(r: ForwardRequest): Promise<void>;
  getAnnouncement(r: { announcementId: AnnouncementId }): Promise<Announcement>;   // para o balão encaminhado; rejeita se !can(read)
}

export type GrantLogEntry = { tenantId: TenantId; at: string; actorId: UserId; targetId: UserId;
  change: { kind: 'grant' | 'revoke'; capability: Capability } | { kind: 'role'; role: 'supervisor' | 'agent' } | { kind: 'active'; active: boolean } };
```

O `tenantId` do request não vem do cliente: o servidor usa o da sessão (`connect`). Um request com `tenantId` divergente é ignorado e não existe na assinatura, de propósito.

### 2.10 Mock (`src/transport/mock/`)

- **`MockServer`:** estado puro e síncrono, particionado em `Map<TenantId, TenantState>`. Cada escrita resolve o ator pela sessão, chama `can`/`canGrant` e devolve os eventos endereçados (`{ to: UserId; event }`) **somente** para usuários do mesmo tenant. Grava `LoginRecord.lastLoginDate` no `connect`, e `grantLog` nas operações da Etapa 5. O relógio é injetável (`now`), e na UI vem por `?agora=` para os e2e de dia e expiração.
- **`MockStore` e `TabSync`:** como na v2, com a chave `sm-webchat-mock-v2` e `?reset=1`.
- **`MockTransport`:** o cliente de um usuário. Mantém os atrasos e as falhas simuladas, `?como=`, `?simular=mensagens` e `?agora=`.
- **Seed:**
  - **Empresa A, "ICS Saúde"** (`America/Sao_Paulo`): admin "Marcos Dono"; supervisora "Carla Mendes" (Norte e Sul) e supervisor "Rafael Lima" (Exames); dois agentes por ilha; um aviso com PDF.
  - **Empresa B, "Clínica Boa Vista"** (`America/Manaus`): admin, um supervisor e dois agentes. Serve para o isolamento e para o "dia" num fuso diferente.

### 2.11 Isolamento entre tenants (invariante)

**Nada atravessa tenant**: nem diretório, nem conversa, nem mensagem, nem aviso, nem encaminhamento, nem grant, nem notificação.

Onde a regra é garantida:
1. **Tipos:** toda entidade tem `tenantId`. Os construtores (`directConversation`, `groupConversation`, `resolveAudience`) recebem entidades, e não só ids, e devolvem `cross-tenant`.
2. **Domínio:** a primeira checagem de `can`, `canGrant`, `canAssignRole` e `canForwardTo` é o tenant.
3. **Servidor do mock:** o estado é particionado por tenant. Um id de outro tenant simplesmente **não existe** na partição e vira `NotFound`, tratado como `Forbidden`, sem dizer se existe.
4. **Transporte e cliente:** a `ChatSession` descarta eventos com `tenantId ≠ me.tenantId`, como defesa em profundidade.

Testes:
- `tenantIsolation.property.test.ts`: 2 tenants, sequências aleatórias de até 50 operações (enviar, criar grupo, publicar, encaminhar, conceder, abrir direta), algumas com ids do outro tenant. A cada passo valem três coisas:
  - todo evento entregue a `u` tem `tenantId(u)`;
  - o `Bootstrap(u)` serializado não contém nenhum id do outro tenant;
  - nenhuma operação com id de outro tenant teve sucesso.
- Matriz em `permissions.test.ts`, com uma linha por `Action`, cada uma com uma variante cross-tenant que espera `cross-tenant`.
- e2e `tenant.spec.ts`.

---

## 3. Código de bot e do canal do paciente: inventário e destino

*Sem mudança de decisão desde a v2.* O PR #7 só renomeou `uploadTimers` para `conversationTimers` e mudou o escopo `'upload'` de `wait` para `'conversation'` em `MockTransport.ts`. O `welcomeGate`, o `botQueue` e o `replyAsBot` continuam lá e saem na Etapa 3. O arquivo `src/transport/MockTransport.regression.test.ts` (#7) usa `patientName` e `ended`, e na Etapa 3 é adaptado (sai `ended` e o `connect` passa a ser sem bot), mantendo as 8 garantias de isolamento.

Os caminhos são reais. A coluna "PR #6" indica o que o PR acrescentou ou mudou. A decisão é **remover** (o git guarda o código; sugiro tag antes da Etapa 3). Isolar atrás de uma interface "BotProvider" seria abstração especulativa: o bot pode voltar com outro formato (fila ou URA do SM), e o código atual é um menu fixo de saúde.

| Arquivo / símbolo | main `b298830` | PR #6 `5e903b5` | Destino | Etapa |
|---|---|---|---|---|
| `src/transport/preAtendimento.ts` (`PRE_ATENDIMENTO_MENU`, `welcomeText`, `replyForChoice`) | sim | igual | **remover** o arquivo | 3 |
| `src/domain/message.ts`: `MessageSender` com `'bot'`/`'client'`, `MenuOption`, `TextMessage.menu` | sim | igual | **remover** `bot` e `menu` na 3; `direction` vira `authorId` na 4 | 3 / 4 |
| `src/transport/ChatTransport.ts`: `ChatEvent 'ended'`, `ConnectSession.patientName` | sim | igual | **remover** `ended` e `patientName` na 3; `connect({userId})` na 4 | 3 / 4 |
| `MockTransport.ts`: `BOT`, `botQueue`, `runBotTurn`, `replyAsBot`, `botText`, `emitMessage`, `ended`, `patientName`, boas-vindas no `connect` | sim | sim, mais `welcomeGate`/`unlockWelcome` usados por `whenReady` | **remover**; `welcomeGate` vira `readyGate`; `progressClient` fica sem a resposta do bot | 3 |
| `MockTransport.ts`: `epoch`, `conversationEpoch`, `lifetime`, `remoteUrlsByConversation`, `guard*`, `wait` | parcial | sim | **manter** na 3; na 4 o ciclo de conexão vira por usuário e o `conversationEpoch` some (cada request leva `conversationId`) | 4 |
| `ChatSession.ts`: `menu`, `ended`, `sendMenuOption`, `lastBotMenu`, guards `if (this.ended)` em `send`/`sendAttachment`/`retry`/`dispatchSend`, `patientName`, `start(patientName, conversationId)`, `nextConversationId` (`conv-web-*`) | sim | sim, mais `abortInFlightUploads` (só para `ended`) | **remover** | 3 |
| `ChatSession.ts`: aliases, `pendingStatus`, `mergeStatus`, `uploads`/`uploadControllers`, `runUpload`, `retry` | sim | sim | **manter**, indexado por conversa na 4 | 4 |
| `src/ui/useChatSession.ts`: `menu`, `ended`, `sendMenuOption`, `restart`, `patientName` | sim | igual | **remover** | 3 |
| `src/ui/MessageList.tsx`: props `menu`/`menuDisabled`/`onMenuSelect`, `lastBotMenuHostId`, `sessionEnded` | sim | mais `sessionEnded` | **remover** | 3 |
| `src/ui/MessageBubble.tsx`: render do menu, `sessionEnded` | sim | mais `sessionEnded` | **remover** | 3 |
| `src/ui/attachments/MediaBody.tsx`, `UploadStatus.tsx`: prop `sessionEnded` e texto "Atendimento encerrado" | não | sim | **remover** a prop; o resto **fica** | 3 |
| `src/ui/ChatPanel.tsx`: `sendMenuOption`, `restart`, banner "Atendimento encerrado / Iniciar novo atendimento", "somente leitura", "Nova mensagem no ICS Pré-atendimento", `aria-label="Conversa com o ICS"`, `lastPreview` → "ICS Pré-atendimento", `failedUpload: !state.ended`, `patientName`, `live`/`isLiveConversation` | sim | sim (ended/upload) | **remover** os itens de bot na 3; `live`/`demo` dão lugar à conversa selecionada real na 4 | 3 / 4 |
| `src/ui/conversations.ts`: `BOT`, `APS`, `CLIENT`, `ANTERIOR_TRANSCRIPT`, `EXAMES_TRANSCRIPT`, `CLIENT_CONVERSATIONS`, `LIVE_CONVERSATION_ID='ics-atual'`, `demo` | sim | igual | **remover** os transcripts e `demo` na 3, ficando uma entrada "Conversa de teste"; a lista vem do `Bootstrap` na 4. **Manter** `filterConversations`/`emptyConversationCopy`, adaptados | 3 / 4 |
| `src/ui/Sidebar.tsx`: `CLIENT_CONVERSATIONS`, avatar "ICS", `demo-badge` | sim | igual | **remover** essas referências; **manter** busca, chips e layout | 3 |
| `src/ui/ChatHeader.tsx`: `readOnly` → "Atendimento encerrado", avatar "ICS" | sim | igual | **remover** `readOnly`; o avatar mostra as iniciais do contato ou do grupo na 4 | 3 / 4 |
| `src/ui/ChatWidget.tsx`, `ChatWidget.test.tsx`; `App.tsx` (`AppMode 'widget'`, `HostPortal`, "Portal do paciente"); `main.tsx` (`?nome=`, `?modo=widget`) | sim | `App`/`main` mudaram (portal com drop) | **remover** (cliente é futuro) | 3 |
| `ChatPanel` prop `compact` e `onClose` (só do widget) | sim | igual | **remover** | 3 |
| `src/chat/outbound.ts`: `CLIENT_AUTHOR` ("Você", `direction: 'client'`) | sim | igual | **manter** na 3; o autor passa a ser `me.id` na 4 | 4 |
| `src/styles/chat.css`: `.avatar-ics`, `.demo-badge`, `.session-banner-demo`, `.wa-compact`, launcher, `.host-*` (19 linhas widget/host) | sim | mais `.host-drop`/`.host-file` | **remover** as regras órfãs; **tokens intocados** | 3 |
| `src/transport/abort.ts` (`SessionAbortedError`, `UploadCanceledError`, `UploadFailedError`) | parcial | sim | **manter** | — |
| `src/test/scriptedTransport.ts` | sim | mais upload | **manter** e adaptar ao contrato novo na 4 | 4 |
| `docs/contrato-mensagem.md` (menu, ended), `docs/residuais.md`, `README.md` | sim | sim | **atualizar** | 3 |

Testes a **apagar** na Etapa 3 (comportamento que deixa de existir):
- `src/transport/MockTransport.test.ts`, 10 testes:
  - "conecta e envia boas-vindas com nome e menu numerado";
  - "emite indicador de digitação antes da mensagem do bot";
  - "responde a opção do menu…";
  - "mostra envios rápidos na hora e serializa só o bot";
  - "enfileira envio do usuário até as boas-vindas terminarem";
  - "reconectar na mesma conversa não emite a resposta antiga do bot…";
  - mais as partes de bot de "após disconnect…", "upload… em connecting espera as boas-vindas", "send de imagem ecoa sem resposta do bot", que são reescritas contra o `readyGate`, e "depois de disconnect, reconectar…".
- `src/chat/ChatSession.test.ts`:
  - "expõe o menu da última mensagem do bot";
  - "encerra o atendimento e limpa o menu";
  - "iniciar novo atendimento limpa as mensagens";
  - "ended durante upload aborta…";
  - "ended torna sendAttachment no-op";
  - os de `SessionAbortedError` "sem ended" ficam, sem a menção a ended.
- `src/ui/ChatPanel.test.tsx`:
  - "mostra boas-vindas pelo nome do paciente";
  - "mostra a lista de conversas do canal do cliente";
  - "não mostra conversas de demonstração…";
  - "oferece as opções do pré-atendimento…";
  - "sobrevive ao StrictMode sem duplicar o menu…", que vira "sem duplicar a conexão";
  - "clicar no menu envia a opção…";
  - "encerra o atendimento, desativa o composer…";
  - "no encerramento só o log permanece vivo";
  - "depois de ended…" (2);
  - "encerrar com o visualizador aberto…", que vira "trocar de conversa com o visualizador aberto".
- Os demais testes de `ChatPanel.test.tsx` que **sincronizam** no texto das boas-vindas (84 ocorrências) trocam o `findByText('Olá, …')` por `await screen.findByRole('textbox', { name: /mensagem/i })` habilitado. Não é comportamento novo, é só o ponto de espera.
- `src/ui/MessageList.test.tsx`: o teste de menu.
- `src/ui/attachments/MediaBody.test.tsx`: "depois de ended não oferece Tentar de novo ativo".
- `src/ui/ChatWidget.test.tsx`: o arquivo inteiro.
- e2e:
  - `media.spec.ts`: "encerrar durante upload lento…", "encerrar com upload falho…" (2) e "widget aberto não bloqueia drop…";
  - `conversations.spec.ts`: os seletores `/ICS Pré-atendimento/` e "somente leitura", reescritos para "Conversa de teste" na 3 e reescritos de novo na 4;
  - `a11y.spec.ts`, `contrast.spec.ts`, `screenshots.spec.ts` e `project.ts` (helper que clica em "ICS Pré-atendimento" e o project `widget`).

As sondas do Interrogador (`interrogador*.probe.test.ts`) **não estão commitadas** em nenhum PR (só existem em `/workspace/smw-pr6`). As garantias equivalentes entraram pelo `MockTransport.regression.test.ts` do #7, que na Etapa 4 se reescreve contra o contrato com `conversationId` explícito.

---

## 4. PR #6 + PR #7 (fechamento da Etapa 2)

A recomendação da v2, **(a) fechar a Etapa 2 corrigindo o P2 antes de remover o bot**, foi seguida: o Codex abriu o **PR #7** com base na branch do #6.

**O que li** (API do GitHub, cursor-github):
- PR #7, "Corrige isolamento de operações e reconexão no MockTransport";
- estado `open`, `mergeable_state: clean`, 1 commit;
- 2 arquivos, +135/−19;
- CI `verify` ×2 `success`;
- nenhuma review nem comentário.

**Cobertura do P2-I1 e dos 3 testes pedidos:**

| Pedido da v2 | No PR #7 | Situação |
|---|---|---|
| Correção do P2-I1 em `send` | `send()` captura `conversationEpoch` e chama `guardConversation` depois do `whenReady()` | **coberto**, igual ao diff sugerido pelo Interrogador |
| Correção do P2-I1 em `upload` | o mesmo em `upload()` | **coberto** |
| Teste I1 (transporte: send pendente em c1 não chega em c2) | o caso no nível do transporte cobre o caminho com `disconnect` ("descarta envio e upload enfileirados após disconnect mesmo com o mesmo ID"); a troca c1 → c2 **sem** disconnect só é testada no nível da `ChatSession` (linha abaixo) | **coberto em comportamento**. A sonda I1 original do Interrogador passa no código do #7 (rodei), mas não foi commitada. É P3 opcional |
| Teste I2 (upload pendente de c1 rejeita ao conectar c2) | "aborta upload esperando conexão antes da troca (disconnect=false/true)", com `SessionAbortedError` e nenhuma URL criada | **coberto** |
| Teste S1 (start c1 → send → start c2: c2 não recebe e não fica ended) | "não envia texto enfileirado à conversa nova (stop=false/true)", que cobre S1 e S2 | **coberto** |
| P3-I8 (mensagem em voo sem status final ao reconectar) | `progressClient` passou para o ciclo da conversa, com o teste "ao reconectar texto em voo chega a lida sem retransmitir ou duplicar" | **resolvido**, com `read` em vez do `error` que eu tinha sugerido; o comportamento é melhor. Sai dos residuais |
| Extras | `disconnect` incrementa `conversationEpoch` (o upload não sobrevive a disconnect + reconnect imediato), e o status antigo não é emitido se o ouvinte troca de conversa no eco | ganho |
| Defesa em profundidade na `ChatSession` | não feita | opcional; a Etapa 4 torna isso estrutural |

**Verificação independente.** Copiei `/workspace/smw-pr6` para `/tmp/smw-pr7`, apliquei os 2 arquivos do #7 no SHA `6981931` e rodei o Vitest: **26 arquivos, 289/289**. São os 275 do PR mais as 14 sondas não commitadas do Interrogador, e passaram I1, I2, S1, S2 e I8, que falhavam no `5e903b5`. Não rodei lint nem e2e localmente; me apoio no CI verde e no relato do PR (e2e 70 passed / 140 skipped).

**Observações (P3, não bloqueiam):**
- O teste de regressão usa `setTimeout` real (`await new Promise(r => setTimeout(r, 140))`), o que é risco de flakiness num CI lento. Sugiro fake timers numa rodada futura ou na Etapa 3, que reescreve esse arquivo de qualquer jeito.
- Os comentários do código ainda falam em "Turnos antigos do bot", o que é irrelevante, porque saem na Etapa 3.

**Ordem de merge, só com autorização explícita do Luan:**
1. **PR #7 → `cursor/etapa-2-midia-67c3`**, a branch do #6.
2. Conferir o CI do #6 no head novo. O Luan reteste `?falha=upload`, `?upload=lento` e o layout em 1366 e 390.
3. **PR #6 → `main`.**
4. Etapa 3.

---

## 5. Riscos e perguntas abertas

### Respondidas pelo Luan (13/11), viram regra
| v2 | Resposta | Onde entrou |
|---|---|---|
| Agente fala com agente? | Sim, dentro da empresa. A lista prioriza grupos e supervisor | §2.2 `conversationTier`, §2.7 `can`, Etapa 4 |
| Agente cria grupo? | Não. Só o supervisor cria e edita; o admin cadastra supervisores e concede permissões | §2.7 tetos, Etapas 5 e 6 |
| Ciência bloqueia? | Não. Primeiro login do dia vai direto aos Avisos; durante o dia aparece o alerta vermelho até o clique | §2.5 `boardPrompt`, Etapa 8 |
| Aviso expira ou edita? | Expiração opcional; editar é permitido, e a edição material reabre a ciência com revisão versionada | §2.4, Etapa 8 |
| Encaminhado fora do público? | Não pode ver o conteúdo | §2.6: só destinos totalmente cobertos e referência com checagem |
| Navegador fechado? | Não, por enquanto. Como o WhatsApp Web | Etapa 7, sem SW nem Push |

### Perguntas residuais (cada uma tem um padrão adotado)
1. **O admin conversa no chat?** *Padrão: não.* O admin só vê o console (`ROLE_DEFAULT.admin` sem `chat.use`). Como ninguém altera as próprias permissões e não há role acima do admin, **ligar o chat do admin é decisão do provisionamento** (seed ou SM), não da tela. Se o Luan quiser o admin no chat, ele nasce com `chat.use`.
2. **O supervisor cadastra agentes e mexe nas permissões deles?** *Padrão: não*, só o admin. Habilitar é pôr `agents.manage` (e, se for o caso, `grants.manage`) no teto do supervisor. `canGrant` e `canAssignRole` já impedem que ele atribua `supervisor`/`admin` ou conceda o que não tem.
3. **Mais de um admin por empresa? Transferir a "posse"?** *Padrão:* um admin, criado no provisionamento, sem criação de admin no app.
4. **Revogação em cascata:** se um supervisor perde uma capacidade, o que ele concedeu antes continua? *Padrão:* continua, porque supervisor não concede nada por padrão (a questão só existe se a pergunta 2 virar "sim"), e o `grantLog` guarda a origem.
5. **Público por grupo: foto ou dinâmico?** *Padrão:* **foto** na publicação ou na edição (`audienceUserIds`). Quem entra no grupo depois não vê o aviso antigo, a menos que o autor edite o público. A alternativa dinâmica muda tallies "sozinha".
6. **"Todos" inclui outros supervisores e o admin?** *Padrão:* todos os `StaffUser` ativos do tenant com `chat.use`. O admin fica de fora por não ter `chat.use`.
7. **Edição material ou correção, quem decide?** *Padrão:* o autor, com sugestão automática "material" quando título, texto ou anexos mudam. O agente vê "Editado" e não o diff. O supervisor quer mostrar o diff ao agente?
8. **Encaminhar pode ampliar o público?** *Padrão:* não. Só o autor amplia, editando o público. Um agente que quer mostrar o aviso a quem não está no público pede ao supervisor.
9. **O "dia" com usuário em outro fuso:** *padrão:* vale o fuso **da empresa** (`Tenant.timeZone`), não o do navegador. Plantão que vira a meia-noite conta como dia novo no primeiro login depois das 00:00 da empresa.
10. **Ordenação:** seções fixas ("Grupos e supervisão" acima de "Colegas") ou uma lista única por recência com destaque? *Padrão:* seções, e as não lidas aparecem nas duas.
11. **Limites e "lido" em grupo:** como na v2. 10 anexos por aviso, 256 membros por grupo, 5 destinos por encaminhamento, 4000/1000 caracteres; o "lido" em grupo só no agregado.

### Riscos técnicos
- **Escalonamento de privilégio só no front não protege nada.** Por isso as **mesmas** funções puras (`can`, `canGrant`, `canAssignRole`, `canForwardTo`) rodam no mock, e o SM precisa reimplementá-las no servidor. A matriz (§2.7) e as propriedades P1 a P6 são a especificação que entregamos ao SM. Se o SM tiver um modelo de permissão próprio, é preciso mapear antes da Etapa 5.
- **Isolamento entre tenants:** o risco maior é um id de outro tenant aceito em algum caminho novo. A mitigação são as entidades com `tenantId`, o particionamento no servidor, o teste de propriedade com sequências aleatórias e uma variante cross-tenant obrigatória para cada `Action` nova (entra no checklist do PR).
- **Etapa 4 grande:** agora inclui tenant e grants. Ordem dos commits: domínio puro com matriz e propriedades → `MockServer` com isolamento → `ChatSession` → UI. Cada bloco fica verde sozinho.
- **Dependência nova (`fast-check`, só de dev):** é pequena e não vai para o bundle. Se o Luan não quiser dependência nova, as propriedades viram um gerador determinístico próprio, com mais código e menos cobertura.
- **Fuso e "dia":** `Intl.DateTimeFormat` com `timeZone` funciona em todos os navegadores atuais. O relógio do mock é injetável (`?agora=`), e os testes cobrem a virada nos dois fusos da seed. A gravação de `lastLoginDate` fica no servidor, e não no navegador, para valer entre abas e dispositivos.
- **Alerta vermelho:** precisa de token novo (`--alert`) com contraste AA nos dois fundos, e deve usar `role="alert"` só na aparição, para não repetir a leitura. No 390 ele divide o topo com o cabeçalho, e o e2e de layout cobre isso.
- **Notificações** (aba aberta ou minimizada): permissão só no clique, `denied` sem novo pedido, autoplay destravado no clique, HTTPS fora de `localhost`, Focus Assist do Windows e o espião no e2e, como na v2. O risco de "app fechado" **saiu**, por decisão do Luan.
- **Encaminhamento por referência:** abrir o balão exige buscar o aviso (`getAnnouncement`). Offline ou com o aviso removido, o balão mostra "Aviso indisponível". Não guardar snapshot é proposital (§2.6).
- **Sincronização entre abas do mock:** só no mesmo perfil de navegador. No Playwright, as páginas ficam no mesmo `context`.
- **Mídia persistida no mock:** o object URL não sobrevive ao reload. Isso afeta os anexos de aviso antigos no mock, que aparecem como "Arquivo indisponível na simulação". É residual explícito.
