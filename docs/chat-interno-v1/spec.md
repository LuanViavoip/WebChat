# Chat Interno v1 ("WhatsApp melhor"): especificação

Autor: Arquiteto. Data: 18/11/2026 (horário de Brasília, UTC-3). Status: **v1 aprovada pelo Luan em 18/11/2026** (decisões na Parte F). Nada aqui foi implementado ainda. A versão anterior está em `spec-v0-anterior.md`.

Entrada: `/workspace/plano-chat-interno-v1.md` (plano do Maestro aprovado pelo Luan). Também usei o plano de fusão v1.1 (`docs/fusao/plano-fusao.md` no repo) e o plano v2.2 do sm-webchat (decisões de avisos).

Repositórios conferidos no código, só leitura:
- `LuanViavoip/WebChat`, `main` em **`2e8961a`** (merge do PR #12, F4 N:N, 17/11/2026 10:51 UTC-3).
- `Luanzzzz/sm-webchat`, `main` em **`9416e9e`** (merge do PR #12, Etapa 6 de grupos, 18/11/2026 15:20 UTC-3).

Baseline que eu rodei no box sobre `2e8961a` (Node 24, pnpm 12.15.0):
- `@viavoip/internal-domain`: 914 testes Vitest em 11 arquivos, todos verdes.
- `@viavoip/internal`: 550 testes Vitest em 44 arquivos, todos verdes.
- Playwright eu **não rodei**. O `docs/STATUS.md` registra 161 testes passando e 99 pulados nos 4 projects.

Convenção deste documento: **[verificado]** quer dizer que li no código citado. **[hipótese]** quer dizer que não consegui conferir.

---

## Parte A. O que existe e o que falta

### A.1 Onde as coisas estão no monorepo (`2e8961a`)

| Camada | Caminho | O que tem hoje [verificado] |
|---|---|---|
| Domínio | `packages/internal-domain/src/` | `tenant.ts` (`Brand`, `TenantId`, `LocalDate`), `identity.ts` (N:N: `Agent.ilhaIds`, `Ilha.supervisorIds`, `validateDirectory`, `supervisorsOf`), `conversation.ts` (`DirectConversation`, `GroupConversation` com `origin: ilha \| custom`, `membersEditableManually`, `conversationTier`, `sortConversations`), `message.ts` (6 tipos: text, image, audio, video, document, sticker; `MessageStatus`; `previewOf`), `attachment.ts` (`MEDIA_RULES`, `validateFiles`), `capabilities.ts` (10 capacidades, teto e padrão por papel, `canGrant`), `permissions.ts` (`can()` com `direct.open`, `conversation.send`, `admin.console`, `grant` e operações de diretório), `directoryOps.ts`, `grantLog.ts`, `result.ts`, `records.ts` |
| Contrato | `apps/internal/src/transport/ChatTransport.ts` | `connect`, `disconnect`, `send`, `upload`, `markRead`, `openDirect`, `setTyping`, `subscribe`, `getStatus`, `loginGroups` e 12 operações de administração. `ChatEvent` com `connection`, `message`, `status`, `typing`, `read`, `conversation`, `grants`, `directory`, `grantLog` e `session-ended` |
| Mock | `apps/internal/src/transport/mock/` | `MockServer.ts` (692 linhas), `MockBackend.ts`, `MockTransport.ts`, `MockStore.ts` (memória e `localStorage`), `TabSync.ts` (BroadcastChannel), `state.ts` (`PERSIST_VERSION = 5`, migra v2 a v4), `seed.ts` (ICS Saúde e Clínica Boa Vista). Presença existe só dentro do servidor (`isOnline`), sem evento. Histórico: `Bootstrap.recent` com as últimas 50 mensagens (`RECENT_LIMIT`), sem paginação |
| Sessão | `apps/internal/src/chat/ChatSession.ts` (1021 linhas) | Estado por conversa (`ThreadState`), envio otimista com `clientId`, uploads com cancelamento, `statusRank`, `pendingStatus` e ações de administração |
| UI | `apps/internal/src/ui/` | `ChatPanel.tsx` (580 linhas, orquestra as views `chat`, `admin` e `team`), `Sidebar.tsx` (busca por nome, chips Tudo e Não lidas, seções), `MessageList`, `MessageBubble`, `Composer`, `EmojiPicker`, `StatusTicks`, `ChatHeader`, `NewConversationDialog`, `attachments/*` (prévia, visualizador de imagem, arrastar e soltar), `admin/*` (console, Equipe, `NewGroupControls`, que hoje só abre um diálogo dizendo que a criação vem na Etapa 6) |
| Testes de contrato | `transport/mock/MockStore.test.ts` | Só o `MockStore` tem suíte de contrato (`contract(name, make)`). **Não existe `contract.suite.ts` nem `SocketTransport`.** A suíte única entre mock e socket é escopo da F6 do plano de fusão |
| E2E | `apps/internal/e2e/` | 11 specs. `project.ts` com `enterAs(?como=)`, `?reset=1` e os projects 1366, 1920, 2560 e 390 em `playwright.config.ts` |
| CI | `.github/workflows/ci.yml` | O job `internal` roda lint do app e do pacote, o gate de hex (cor só em `chat.css`, `contrast.ts` e `contrast.test.ts`) e o Playwright nos 4 projects com axe |
| Versão e notas | (nada) | **Não existem** `AGENTS.md`, `version.ts` nem `RELEASE_NOTES.md` no repo. A página "Novidades do WebChat" do hml é gerada **fora do repo**, por `/workspace/smw-deploy/generate_notes.py` no box, e publicada em `/sm-webchat/release-notes/` |

### A.2 O que falta portar do sm-webchat (Etapa 6)

O monorepo importou o sm-webchat em `db9b221` (Etapa 5). A Etapa 6 entrou depois no sm-webchat (`db9b221..9416e9e`, 39 arquivos, +1103/−172), e foi escrita sobre o modelo **1:1** (`ilhaId` e `createdBy` direto no grupo). O monorepo já está em **N:N** (`GroupConversation.origin`). Então o porte é uma adaptação, não uma cópia.

| Peça da Etapa 6 em `9416e9e` | No monorepo | Adaptação |
|---|---|---|
| `src/domain/group.ts` (`createGroup` e `updateGroup`, limite de 256 membros, `formerMemberIds`) | falta | `ilhaId: IlhaId \| null` vira `origin`. Grupo de `origin.kind = 'ilha'` recusa edição manual de membros (`membersEditableManually`) |
| `src/domain/groupStatus.ts` (`groupMessageRead`) | falta | Igual |
| `SystemMessage` (`created`, `renamed`, `added` e `removed`) em `message.ts` | falta | Igual, com `actorId` |
| `GroupConversation.formerMemberIds`, `formerReadLimits`, `hiddenMessageRanges` e `ConversationSummary.readOnly` | falta | Igual, sobre o tipo N:N |
| `Action 'group.manage'` e `PermissionDenial 'not-owner'` em `permissions.ts` | falta | O dono vem de `origin.createdBy` (custom). O grupo de ilha não tem dono e só o admin edita o título |
| `ChatTransport.createGroup`, `updateGroup` e o evento `conversation-removed` | falta | `CreateGroupRequest.ilhaId` só pré-seleciona membros, e o grupo nasce `custom` |
| `MockServer`, `state.ts`, `MockBackend` e `tenantIsolation.property.test.ts` com grupos | falta | `PERSIST_VERSION` 5 → 6, com migração |
| UI: `NewGroupControls` real, edição de grupo, nome do autor acima do balão, chip Grupos, `e2e/groups.spec.ts` | falta | Igual |

### A.3 Mapa por tela: v1 contra o que existe

Legenda: ✅ existe · 🟡 parcial · ❌ falta.

| Tela ou recurso (plano v1) | Hoje | Falta |
|---|---|---|
| **Login "Entrar como"** (mock) | ✅ `LoginScreen.tsx`, `?como=` | nada |
| **Lista: busca** | 🟡 filtra por nome (`Sidebar.tsx`) | busca global no conteúdo (`searchMessages`) |
| **Lista: filtros** | 🟡 Tudo e Não lidas | Grupos e Fixadas; seção Arquivadas |
| **Lista: fixar, arquivar e silenciar conversa** | ❌ | `ConversationPrefs` por usuário |
| **Grupos (criar, editar, sair)** | 🟡 tipo e diálogo vazio | porte da Etapa 6 (A.2) |
| **Texto: emoji** | ✅ `EmojiPicker.tsx` | nada |
| **Texto: \*negrito\*, \_itálico\_, \~riscado\~ e \`\`\`mono\`\`\`** | ❌ | parser puro e render sem HTML |
| **Menção @** | ❌ | autocomplete e `mentions` validado no servidor |
| **Prévia de link** | ❌ | card só com o host no mock (sem buscar a URL) |
| **Mídia: foto, vídeo e documento** | ✅ `attachments/*` e `MEDIA_RULES` | nada |
| **Áudio gravado no navegador** (segurar, onda e 1x/1.5x/2x) | ❌ (só arquivo) | `RecorderPort`, `audio/webm` e `audio/ogg` em `MEDIA_RULES`, player com velocidade |
| **Colar e arrastar arquivo** | 🟡 arrastar (`useFileDrop.ts`) | colar (`paste`) |
| **Galeria da conversa** | ❌ | lista de mídia por conversa (`history` com filtro) |
| **Responder citando** | ❌ | `replyTo` |
| **Encaminhar** | ❌ | `forward` (mensagem) e `forwardAnnouncement` (só referência) |
| **Reagir** | ❌ | `react` e evento `reaction` |
| **Editar e apagar para todos** | ❌ | `editMessage`, `deleteMessage` e a variante `deleted` |
| **Favoritar e fixar mensagem** | ❌ | `star` (por usuário) e `pin` (por conversa, no máximo 3) |
| **Ticks** (enviado, entregue e lido) | 🟡 `StatusTicks.tsx`, `delivered` só quando todos estão online no envio | recibo por destinatário e "dados da mensagem" |
| **Digitando e gravando** | 🟡 `typing` booleano | `activity: typing \| recording-audio` |
| **Presença** (online, visto por último, Disponível, Pausa e Ausente) | ❌ (só `isOnline` interno) | `Presence`, `setPresence` e evento `presence` |
| **Busca dentro da conversa** | ❌ | client sobre o carregado mais `searchMessages` |
| **Notificações, som e contador no título** (Etapa 7) | ❌ | `Notifier`, política pura e "(N) ViaVoip" |
| **Tema escuro e claro** | ❌ (só tokens claros em `chat.css`) | bloco `[data-theme='dark']` e toggle |
| **Avisos do supervisor** (texto, áudio e vídeo, câmera ou arquivo, obrigatório com 👍, painel) | ❌ (capacidades `announcement.*` existem, sem fluxo) | domínio, contrato, mock e UI (B.9) |
| **Quadro fixo por ilha** | ❌ | `Audience 'ilhas'` mais `pinned` |
| **Mensagem agendada e lembrete** | ❌ | `ScheduledItem` e relógio do mock |
| **Enquete no grupo** | ❌ | `PollMessage` e votos |
| **Pausa integrada à presença** | ❌ | `PresenceStatus 'pause'` com motivo |
| **Respostas rápidas (/)** | ❌ | `QuickReply` com escopo pessoal, ilha ou empresa |
| **Flag de debug** | ❌ | Parte C |
| **Versão e notas** | ❌ | Parte D |
| **Administração e Equipe** | ✅ `ui/admin/*` | só o toggle de debug do admin (por slot) |

### A.4 Mapa do contrato de transporte

| Operação ou evento | Hoje | v1 |
|---|---|---|
| `connect → Bootstrap` | ✅ tenant, me, directory, conversations, recent e unread | + `presence`, `prefs`, `pinnedMessages`, `quickReplies`, `scheduled`, `announcements`, `firstLoginOfDay` e `serverNow` |
| `send` | ✅ 6 payloads | + `replyTo`, `mentions` e o payload `poll` |
| `upload` | ✅ por `conversationId` | `target` passa a ser `conversation \| announcement-draft` |
| `markRead` e evento `read` | ✅ cursor | sem mudança, mais o recibo por destinatário (`receipt`, só para o autor) |
| `setTyping` e evento `typing` | ✅ booleano | **substituídos** por `setActivity` e o evento `activity` |
| `history` | ❌ | novo (paginação e galeria) |
| `createGroup`, `updateGroup` e `conversation-removed` | ❌ no monorepo | Onda 0a |
| reações, encaminhar, editar, apagar, estrela, fixar, prefs, info, presença, busca, enquete, agendada, respostas rápidas e avisos | ❌ | B.4 |
| Suíte de contrato `contract.suite.ts` | ❌ | criada na Onda 0b e rodando contra o `MockTransport`. A F6 pluga o `SocketTransport` nela |

### A.5 Duas mudanças em relação a documentos anteriores (decididas pelo Luan em 18/11/2026)

1. **O plano de fusão §4.1 dizia** que as Etapas 6, 8 e 9 iriam direto ao backend real, depois da F6 e da F7, para não persistir duas vezes. **O plano v1 aprovado inverte isso:** tudo nasce no mock. Decidido (D-V1-14). Consequência: o mock vira a especificação executável, e a `contract.suite.ts` passa a ser obrigatória já na v1, não na F6. Assim o servidor da F6 até a F12 implementa contra testes prontos.
2. **v2.2 sobre o aviso:** o alerta vermelho "não trava o chat". **O plano v1 pede** que o aviso "abra na tela" com confirmação obrigatória por 👍. Para conciliar, a spec cria dois modos de entrega (`delivery: 'board' | 'interrupt'`). `board` segue a v2.2 sem mudança. `interrupt` é o modo novo, que bloqueia (B.9.4). Decidido (D-V1-1 e D-V1-15).

---

## Parte B. Especificação da v1

Regras de tipo para todo o código novo: TypeScript estrito, uniões discriminadas por `type`, `kind` ou `phase`, ids com `Brand` (de `tenant.ts`), nenhum `any`, `switch` exaustivo com `never`, `Result<T, E>` (de `result.ts`) nas funções puras e `readonly` em todos os tipos de domínio. **Toda entidade carrega `tenantId`.** O servidor (mock agora, real depois) é a autoridade: a UI esconde botões, mas o servidor recusa com `ForbiddenError` (mensagem única, que nunca revela outra empresa).

Os blocos abaixo são o contrato. Os nomes valem. O corpo das funções e os detalhes privados ficam com o implementador.

### B.1 Ids e utilitários (`packages/internal-domain/src/ids.ts`, novo)

```ts
import type { Brand } from './tenant';

export type MessageId = Brand<string, 'MessageId'>;
export type ClientId = Brand<string, 'ClientId'>;
export type AnnouncementId = Brand<string, 'AnnouncementId'>;
export type RevisionNo = Brand<number, 'RevisionNo'>;      // 1, 2, 3…
export type PollOptionId = Brand<string, 'PollOptionId'>;
export type ScheduledId = Brand<string, 'ScheduledId'>;
export type QuickReplyId = Brand<string, 'QuickReplyId'>;
/** Um único grafema de emoji (Intl.Segmenter + \p{Extended_Pictographic}). */
export type Emoji = Brand<string, 'Emoji'>;
/** ISO 8601 em UTC, gerado pelo servidor. */
export type IsoInstant = Brand<string, 'IsoInstant'>;

export function parseEmoji(raw: string): Emoji | null;
export const asMessageId: (value: string) => MessageId;   // só em adaptadores e testes
```

**Migração mecânica (Onda 0b):** `MessageBase.id` passa de `string` para `MessageId`, e `clientId` para `ClientId`. Se isso tocar mais de 40 arquivos, a frente para e avisa, sem fazer pela metade.

### B.2 Mensagem v1 (`message.ts`, alterado)

```ts
export type ReplyRef = {
  readonly messageId: MessageId;
  readonly authorId: UserId;
  /** Fotografia mínima para o balão citado. O servidor zera quando a original é apagada para todos. */
  readonly quoted:
    | { readonly state: 'available'; readonly kind: MessageKind; readonly excerpt: string } // excerpt ≤ 120
    | { readonly state: 'deleted' };
};

/** Só o selo de encaminhada. Não leva autor nem conversa de origem (igual ao WhatsApp). */
export type ForwardMark = { readonly times: number };       // ≥ 1; "Encaminhada com frequência" a partir de 5

type MessageBase = {
  readonly id: MessageId;
  readonly tenantId: TenantId;
  readonly conversationId: ConversationId;
  readonly clientId?: ClientId;
  readonly authorId: UserId;
  readonly author: MessageAuthor;
  readonly timestamp: IsoInstant;
  readonly status: MessageStatus;                       // agregado (em grupo: B.6)
  readonly replyTo?: ReplyRef;
  readonly forwarded?: ForwardMark;
  readonly mentions?: readonly UserId[];                // validado: só participantes
  readonly editedAt?: IsoInstant;
};

// TextMessage, ImageMessage, AudioMessage, VideoMessage, DocumentMessage, StickerMessage: como hoje, sobre o MessageBase novo.
// AudioMessage ganha:  readonly waveform?: readonly number[];   // 0..1, até 64 amostras, para gravação no navegador

export type PollOption = { readonly id: PollOptionId; readonly text: string };   // 1..80
export type PollMessage = MessageBase & {
  readonly type: 'poll';
  readonly question: string;                                          // 1..200
  readonly options: readonly [PollOption, PollOption, ...PollOption[]]; // 2..12
  readonly multiple: boolean;
  readonly closedAt: IsoInstant | null;
};

/** Aviso encaminhado: SÓ a referência (v2.2 §2.3). O conteúdo é buscado e mostrado se can(read). */
export type AnnouncementRefMessage = MessageBase & { readonly type: 'announcement'; readonly announcementId: AnnouncementId };

/** Apagada para todos: o conteúdo sai do armazenamento. Não sobra texto, url, legenda nem nome de arquivo. */
export type DeletedMessage = Omit<MessageBase, 'replyTo' | 'mentions' | 'editedAt'> & {
  readonly type: 'deleted';
  readonly deletedAt: IsoInstant;
};

// SystemMessage: porte da Etapa 6 (sem author/authorId; actorId; action).

export type ChatMessage =
  | SystemMessage | TextMessage | ImageMessage | AudioMessage | VideoMessage | DocumentMessage
  | StickerMessage | PollMessage | AnnouncementRefMessage | DeletedMessage;

export type MessageKind = ChatMessage['type'];
```

O `previewOf` cobre todas as variantes: `poll` → `📊 ${question}`, `announcement` → `'Aviso encaminhado'` (nunca o título), `deleted` → `'Mensagem apagada'`.

### B.3 Operações sobre mensagem (`messageOps.ts`, novo, puro)

```ts
export const EDIT_WINDOW_MS = 15 * 60_000;
export const DELETE_FOR_ALL_WINDOW_MS = 48 * 60 * 60_000;
export const MAX_PINNED_MESSAGES = 3;
export const MAX_PINNED_CONVERSATIONS = 3;
export const MAX_FORWARD_TARGETS = 5;
export const MAX_FORWARD_SOURCES = 10;

export type EditDenial = 'not-author' | 'not-editable-kind' | 'window-expired' | 'empty' | 'too-long' | 'no-change';
/** Só texto e legenda (image e video). Poll, deleted, system e announcement não se editam. */
export function canEdit(m: ChatMessage, actor: UserId, now: IsoInstant): Result<true, EditDenial>;
export function applyEdit(m: TextMessage | ImageMessage | VideoMessage, text: string, at: IsoInstant): Result<ChatMessage, EditDenial>;

export type DeleteScope = 'everyone' | 'me';
export type DeleteDenial = 'not-author' | 'window-expired' | 'already-deleted' | 'not-deletable-kind';
export function canDeleteForEveryone(m: ChatMessage, actor: UserId, now: IsoInstant): Result<true, DeleteDenial>;
export function tombstone(m: ChatMessage, at: IsoInstant): DeletedMessage;

export type ForwardDenial = 'not-participant-source' | 'not-participant-target' | 'cross-tenant'
  | 'not-forwardable-kind' | 'too-many' | 'read-only-target';
/** Mensagem comum: cópia com ForwardMark. Proibido: deleted, system e poll. 'announcement' tem regra própria (B.9.6). */
export function canForwardMessage(m: ChatMessage, from: Conversation, to: Conversation, actor: StaffUser): Result<true, ForwardDenial>;

/** Recorta as menções válidas (só participantes ativos da conversa). A menção inválida vira texto comum. */
export function validMentions(ids: readonly UserId[], conversation: Conversation, d: Directory): readonly UserId[];
```

"Apagar para mim" (`scope: 'me'`) vale para qualquer mensagem visível. O servidor guarda isso por usuário e emite `message-hidden` só para as abas dele.

### B.4 Contrato de transporte v1 (`apps/internal/src/transport/ChatTransport.ts` e `transport/contract/*.ts`)

Os tipos ficam divididos por assunto em `transport/contract/{messaging,presence,prefs,polls,scheduling,quickReplies,announcements}.ts`, e o `ChatTransport.ts` reexporta e compõe. **Continua sendo uma interface só.** Regra que já vale hoje: nenhum request leva ator nem tenant, porque o ator é sempre o usuário da sessão.

```ts
// --- requests novos ou alterados ---
type MessageRef = { readonly conversationId: ConversationId; readonly messageId: MessageId };

export type SendRequest = {
  readonly conversationId: ConversationId;
  readonly clientId: ClientId;
  readonly payload: OutboundPayload;          // + { type: 'poll'; question; options: readonly string[]; multiple }
  readonly replyTo?: MessageId;
  readonly mentions?: readonly UserId[];
};
export type UploadTarget =
  | { readonly kind: 'conversation'; readonly conversationId: ConversationId }
  | { readonly kind: 'announcement-draft' };  // exige announcement.publish
// UploadRequest: troca conversationId por target: UploadTarget (o resto fica igual).

export type HistoryRequest = {
  readonly conversationId: ConversationId;
  readonly before?: MessageId;
  readonly limit: number;                     // 1..100
  readonly kinds?: readonly MessageKind[];    // galeria: ['image', 'video', 'document', 'audio']
};
export type HistoryPage = { readonly messages: readonly ChatMessage[]; readonly hasMore: boolean };

export type ReactRequest = MessageRef & { readonly emoji: Emoji | null };   // null = tira
export type EditRequest = MessageRef & { readonly text: string };
export type DeleteRequest = MessageRef & { readonly scope: DeleteScope };
export type ForwardRequest = {
  readonly sources: readonly [MessageRef, ...MessageRef[]];   // 1..MAX_FORWARD_SOURCES
  readonly targets: readonly [ConversationId, ...ConversationId[]];   // 1..MAX_FORWARD_TARGETS
  readonly clientId: ClientId;                // idempotência: (clientId, alvo, fonte)
};
export type ForwardResult = { readonly perTarget: readonly { readonly target: ConversationId; readonly outcome: 'sent' | 'denied' }[] };
export type StarRequest = MessageRef & { readonly starred: boolean };
export type PinMessageRequest = MessageRef & { readonly pinned: boolean };
export type SearchRequest = { readonly query: string; readonly conversationId?: ConversationId; readonly limit: number }; // query ≥ 2 caracteres
export type SearchHit = MessageRef & { readonly excerpt: string; readonly at: IsoInstant };

export type ComposeActivity = 'idle' | 'typing' | 'recording-audio';
export type ActivityRequest = { readonly conversationId: ConversationId; readonly activity: ComposeActivity };

export interface ChatTransport {
  // ...tudo que existe hoje, MENOS setTyping (substituído por setActivity)...
  // Etapa 6 (Onda 0a)
  createGroup(r: CreateGroupRequest): Promise<GroupConversation>;
  updateGroup(r: UpdateGroupRequest): Promise<GroupConversation>;
  leaveGroup(r: { readonly conversationId: ConversationId }): Promise<void>;
  // Mensagens
  history(r: HistoryRequest): Promise<HistoryPage>;
  react(r: ReactRequest): Promise<void>;
  editMessage(r: EditRequest): Promise<ChatMessage>;
  deleteMessage(r: DeleteRequest): Promise<void>;
  forward(r: ForwardRequest): Promise<ForwardResult>;
  setStar(r: StarRequest): Promise<void>;
  pinMessage(r: PinMessageRequest): Promise<void>;
  messageInfo(r: MessageRef): Promise<MessageReceipts>;   // só o autor (B.6)
  searchMessages(r: SearchRequest): Promise<readonly SearchHit[]>;
  setActivity(r: ActivityRequest): void;
  // Presença e preferências (B.7)
  setPresence(r: SetPresenceRequest): Promise<Presence>;
  setConversationPrefs(r: ConversationPrefsRequest): Promise<ConversationPrefs>;
  // Enquete (B.8.1)
  votePoll(r: VotePollRequest): Promise<PollTally>;
  closePoll(r: MessageRef): Promise<void>;
  // Agendada e lembrete (B.8.2)
  schedule(r: ScheduleRequest): Promise<ScheduledItem>;
  cancelScheduled(r: { readonly id: ScheduledId }): Promise<ScheduledItem>;
  // Respostas rápidas (B.8.3)
  saveQuickReply(r: SaveQuickReplyRequest): Promise<QuickReply>;
  deleteQuickReply(r: { readonly id: QuickReplyId }): Promise<void>;
  // Avisos (B.9)
  publishAnnouncement(r: PublishAnnouncementRequest): Promise<AnnouncementForAuthor>;
  editAnnouncement(r: EditAnnouncementRequest): Promise<AnnouncementForAuthor>;
  markAnnouncementViewed(r: AnnouncementRevisionRef): Promise<ReceiptState>;
  reportPlayback(r: PlaybackReport): Promise<ReceiptState>;
  acknowledgeAnnouncement(r: AnnouncementRevisionRef): Promise<ReceiptState>;   // o 👍
  announcementReceipts(r: { readonly id: AnnouncementId }): Promise<ReceiptsPanel>;
  remindAnnouncement(r: { readonly id: AnnouncementId }): Promise<{ readonly reminded: number }>;
  forwardAnnouncement(r: ForwardAnnouncementRequest): Promise<ForwardResult>;
}

// Bootstrap v1 = o atual +
//   serverNow: IsoInstant
//   firstLoginOfDay: boolean                                          (v2.2 §2.5)
//   presence: Readonly<Record<UserId, Presence>>                      (só do tenant)
//   prefs: Readonly<Record<ConversationId, ConversationPrefs>>        (só os meus)
//   starred: readonly MessageRef[]
//   pinnedMessages: Readonly<Record<ConversationId, readonly MessageId[]>>
//   reactions: Readonly<Record<MessageId, readonly ReactionGroup[]>>  (das mensagens em `recent`)
//   polls: Readonly<Record<MessageId, PollTally>>
//   quickReplies: readonly QuickReply[]                               (as que eu posso usar)
//   scheduled: readonly ScheduledItem[]                               (as minhas pendentes)
//   announcements: AnnouncementBootstrap
```

**Eventos novos em `ChatEvent`.** Todos são `Scoped` (com `tenantId`), e o comentário diz quem recebe:

```ts
  | (Scoped & { type: 'conversation-removed'; conversationId: ConversationId })            // ex-membro (Etapa 6)
  | (Scoped & { type: 'message-updated'; message: ChatMessage })                            // participantes: edição, apagar para todos, citação zerada, enquete encerrada
  | (Scoped & MessageRef & { type: 'message-hidden' })                                      // só eu (apagar para mim), todas as abas
  | (Scoped & MessageRef & { type: 'reaction'; userId: UserId; emoji: Emoji | null })       // participantes
  | (Scoped & MessageRef & { type: 'receipt'; userId: UserId; kind: 'delivered' | 'read'; at: IsoInstant }) // SÓ o autor
  | (Scoped & { type: 'activity'; conversationId: ConversationId; userId: UserId; activity: ComposeActivity }) // participantes menos quem digita (substitui 'typing')
  | (Scoped & { type: 'presence'; presence: Presence })                                     // usuários ativos do tenant
  | (Scoped & { type: 'prefs'; conversationId: ConversationId; prefs: ConversationPrefs })  // só eu
  | (Scoped & MessageRef & { type: 'star'; starred: boolean })                              // só eu
  | (Scoped & { type: 'pinned-messages'; conversationId: ConversationId; messageIds: readonly MessageId[] }) // participantes
  | (Scoped & MessageRef & { type: 'poll'; tally: PollTally })                              // participantes
  | (Scoped & { type: 'scheduled'; item: ScheduledItem })                                   // só o autor
  | (Scoped & { type: 'reminder-due'; item: Extract<ScheduledItem, { kind: 'reminder' }> }) // só o autor
  | (Scoped & { type: 'quick-replies'; items: readonly QuickReply[] })                      // quem pode usar (lista completa)
  | (Scoped & { type: 'announcement'; announcement: AnnouncementForReader; receipt: ReceiptState }) // público (visão de leitor)
  | (Scoped & { type: 'announcement-authored'; announcement: AnnouncementForAuthor })       // autor e admin
  | (Scoped & { type: 'announcement-revoked'; id: AnnouncementId; reason: 'expired' | 'audience' }) // quem perdeu o acesso
  | (Scoped & { type: 'announcement-receipts'; id: AnnouncementId; tally: ReceiptTally })   // autor e admin
  | (Scoped & { type: 'announcement-reminder'; id: AnnouncementId })                        // só os pendentes
```

O evento `typing` sai. O `ChatSession` e a UI migram para `activity` na mesma PR (Onda 0b), sem dois caminhos.

**Invariantes do contrato.** A `contract.suite.ts` testa cada uma contra qualquer `ChatTransport`:
1. Nenhum evento, `Bootstrap` ou resposta atravessa tenant. A propriedade de `tenantIsolation.property.test.ts` é estendida às operações novas.
2. Toda operação sobre mensagem exige `can(actor, 'conversation.send', conversa)`: participante, `chat.use` e mesmo tenant. Ex-membro de grupo só lê o intervalo permitido e não reage, edita, vota nem encaminha.
3. A idempotência por `clientId` vale para `send`, `forward`, `schedule` e `publishAnnouncement`.
4. O `receipt` e o `messageInfo` vão só ao autor da mensagem.
5. `DeletedMessage` não carrega conteúdo: o teste procura o texto original no estado persistido e em todos os eventos, e não pode achar.
6. A operação negada rejeita com `ForbiddenError` e não emite evento nenhum.

### B.5 Reações (`reaction.ts`, novo)

```ts
export type Reaction = { readonly tenantId: TenantId; readonly messageId: MessageId; readonly userId: UserId; readonly emoji: Emoji };
/** Uma reação por usuário por mensagem. Repetir o mesmo emoji remove; outro emoji troca. */
export function toggleReaction(current: Emoji | null, next: Emoji | null): Emoji | null;
export type ReactionGroup = { readonly emoji: Emoji; readonly userIds: readonly UserId[] }; // ordenado por contagem desc e primeiro uso
export function groupReactions(rs: readonly Reaction[]): readonly ReactionGroup[];
export const QUICK_REACTIONS: readonly Emoji[]; // 👍 ❤️ 😂 😮 😢 🙏
```

Não reage em `deleted`, `system` nem `announcement`.

### B.6 Recibos de entrega e leitura (`receipts.ts`, novo; incorpora `groupStatus.ts` da Etapa 6)

```ts
export type RecipientReceipt = { readonly userId: UserId; readonly deliveredAt: IsoInstant | null; readonly readAt: IsoInstant | null };
export type MessageReceipts = {
  readonly messageId: MessageId;
  readonly recipients: readonly RecipientReceipt[];   // membros ATUAIS menos o autor (ex-membros ficam fora)
};
/** Status agregado: delivered quando todos entregues; read quando todos leram (regra da Etapa 6). */
export function aggregateStatus(r: MessageReceipts, base: 'sent' | 'error'): MessageStatus;
```

- Direta: o tick segue o único destinatário.
- Grupo: dois tiques azuis só quando todos os membros atuais leram (`groupMessageRead`).
- "Dados da mensagem" (`messageInfo`): **só o autor** vê. Mostra "Lida por" e "Entregue a", com hora, e "Pendente" (D-V1-12).
- `deliveredAt` por usuário: quando o destinatário tem sessão ativa no envio, ou no `connect` seguinte (`deliverPending` passa a ser por usuário).

### B.7 Presença e preferências (`presence.ts` e `prefs.ts`, novos)

```ts
export const PAUSE_REASONS = ['lanche', 'banheiro', 'treinamento', 'feedback', 'outro'] as const;
export type PauseReason = (typeof PAUSE_REASONS)[number];
export type PresenceStatus =
  | { readonly kind: 'available' }
  | { readonly kind: 'pause'; readonly reason: PauseReason; readonly since: IsoInstant }
  | { readonly kind: 'away'; readonly since: IsoInstant };
export type Presence = {
  readonly userId: UserId;
  readonly online: boolean;                         // alguma sessão ativa (servidor)
  readonly lastSeenAt: IsoInstant | null;           // última sessão encerrada
  readonly status: PresenceStatus;
};
export type SetPresenceRequest = { readonly status: 'available' } | { readonly status: 'pause'; readonly reason: PauseReason } | { readonly status: 'away' };
/** "online", "visto por último hoje às 14:32", "em pausa (lanche) há 5 min" — no fuso do tenant. */
export function presenceLabel(p: Presence, now: IsoInstant, timeZone: string): string;
/** Transição que dispara o aviso obrigatório (B.9.4). */
export function becameAvailable(before: PresenceStatus, after: PresenceStatus): boolean;

export type ConversationPrefs = {
  readonly pinnedAt: IsoInstant | null;   // no máximo MAX_PINNED_CONVERSATIONS
  readonly archived: boolean;              // mensagem nova NÃO desarquiva (WhatsApp atual)
  readonly mutedUntil: IsoInstant | 'forever' | null;
};
export type ConversationPrefsRequest = { readonly conversationId: ConversationId; readonly pinned?: boolean; readonly archived?: boolean; readonly mutedUntil?: ConversationPrefs['mutedUntil'] };
export type ListFilter = 'all' | 'unread' | 'groups' | 'pinned';
export function filterConversations(items: readonly ConversationSummary[], prefs: Readonly<Record<ConversationId, ConversationPrefs>>, f: ListFilter): readonly ConversationSummary[];
```

- Pausa integrada: **na v1 o status é manual** (no mock). A integração com a pausa real do SM (adaptador) fica para depois do backend real. [hipótese: o SM expõe a pausa do agente; não conferi]
- Ausente automático: depois de 10 min sem interação na aba, a UI chama `setPresence({ status: 'away' })`. Ao voltar, não volta sozinho para Disponível: aparece um chip "Voltar a ficar disponível". Assim o "fica disponível" é sempre um gesto do agente, e é esse gesto que dispara o aviso.
- O primeiro `connect` do dia nasce `available`. Reconectar mantém o status anterior.

### B.8 Recursos de call center

#### B.8.1 Enquete (`poll.ts`)

```ts
export type VotePollRequest = { readonly conversationId: ConversationId; readonly messageId: MessageId; readonly optionIds: readonly PollOptionId[] }; // [] = retira o voto
export type PollTally = { readonly totals: Readonly<Record<PollOptionId, number>>; readonly voters: Readonly<Record<PollOptionId, readonly UserId[]>>; readonly closed: boolean };
export type PollDenial = 'not-group' | 'closed' | 'multiple-not-allowed' | 'unknown-option' | 'not-member';
export function validatePoll(input: { question: string; options: readonly string[]; multiple: boolean }): Result<{ question: string; options: readonly [string, string, ...string[]]; multiple: boolean }, 'empty-question' | 'too-few-options' | 'too-many-options' | 'duplicate-option' | 'too-long'>;
export function applyVote(t: PollTally, userId: UserId, optionIds: readonly PollOptionId[], poll: PollMessage): Result<PollTally, PollDenial>;
```

Enquete só existe em grupo. Qualquer membro cria e vota. Os votos são visíveis aos membros (WhatsApp). Só o autor da enquete, ou quem gerencia o grupo, encerra.

#### B.8.2 Mensagem agendada e lembrete (`schedule.ts`)

```ts
export type ScheduleState =
  | { readonly phase: 'pending' }
  | { readonly phase: 'done'; readonly at: IsoInstant; readonly messageId?: MessageId }
  | { readonly phase: 'canceled'; readonly at: IsoInstant }
  | { readonly phase: 'failed'; readonly at: IsoInstant; readonly reason: 'forbidden' | 'conversation-gone' };
type ScheduledBase = { readonly id: ScheduledId; readonly tenantId: TenantId; readonly authorId: UserId; readonly state: ScheduleState };
export type ScheduledItem =
  | (ScheduledBase & { readonly kind: 'message'; readonly conversationId: ConversationId; readonly text: string; readonly sendAt: IsoInstant })
  | (ScheduledBase & { readonly kind: 'reminder'; readonly note: string; readonly at: IsoInstant; readonly ref: MessageRef | null });
export type ScheduleRequest =
  | { readonly kind: 'message'; readonly clientId: ClientId; readonly conversationId: ConversationId; readonly text: string; readonly sendAt: IsoInstant }
  | { readonly kind: 'reminder'; readonly clientId: ClientId; readonly note: string; readonly at: IsoInstant; readonly ref?: MessageRef };
export const MAX_SCHEDULE_AHEAD_MS = 30 * 24 * 60 * 60_000;
export function validateSchedule(r: ScheduleRequest, now: IsoInstant): Result<true, 'in-past' | 'too-far' | 'empty' | 'too-long'>;
```

- Na v1, a agendada é **só de texto**.
- **No disparo, o servidor reavalia `can(conversation.send)`**. Se o autor perdeu o acesso, foi desativado ou saiu do grupo, o item vira `failed`. Nunca envia em nome de quem não pode mais.
- O lembrete é para si: gera `reminder-due`, que vira notificação (B.11).
- O relógio do mock usa `MockServer.now()`, que já existe, mais `tick()`, chamado pelo `MockBackend` a cada 1 s e quando `?agora=` muda. Na conexão, o que venceu durante o offline dispara.

#### B.8.3 Respostas rápidas (`quickReply.ts`)

```ts
export type QuickReplyScope =
  | { readonly kind: 'personal'; readonly ownerId: UserId }
  | { readonly kind: 'ilha'; readonly ilhaId: IlhaId }
  | { readonly kind: 'tenant' };
export type QuickReply = { readonly id: QuickReplyId; readonly tenantId: TenantId; readonly shortcut: string; readonly text: string; readonly scope: QuickReplyScope; readonly updatedAt: IsoInstant };
export const SHORTCUT_PATTERN = /^\/[a-z0-9][a-z0-9-]{0,23}$/;
export type SaveQuickReplyRequest = { readonly id?: QuickReplyId; readonly shortcut: string; readonly text: string; readonly scope: QuickReplyScope };
export type QuickReplyDenial = 'bad-shortcut' | 'empty' | 'too-long' | 'duplicate-shortcut' | 'scope-forbidden';
/** Quem usa: a pessoal (dono), a de ilha (membros e supervisores da ilha) e a da empresa (todos). */
export function usableQuickReplies(all: readonly QuickReply[], me: StaffUser, d: Directory): readonly QuickReply[];
/** Prefixo digitado → candidatas por prioridade: pessoal > ilha > empresa, e depois alfabético. */
export function matchQuickReplies(prefix: string, usable: readonly QuickReply[]): readonly QuickReply[];
```

Quem cria a de escopo compartilhado (D-V1-6): a de `ilha`, o supervisor de alguma das ilhas (escopo de gestão, `inManagementScope`) ou o admin; a de `tenant`, só o admin. A pessoal, qualquer um com `chat.use`. Isso **não cria capacidade nova**. O atalho é único por escopo visível: duas respostas que o mesmo usuário enxerga não podem ter o mesmo atalho.

### B.9 Avisos do supervisor (`announcement.ts`, `audience.ts`, `announcementReceipt.ts` e `day.ts`)

Base: o plano v2.2 §2.4 e §2.5, **mantido**:
- revisões, com a edição importante a critério do autor (reabre a ciência);
- expiração opcional;
- público resolvido na publicação, com o público "grupos" fixado nessa hora e editável pelo autor;
- "visualizar" e "confirmar" separados;
- no primeiro login do dia, o app vai direto à aba Avisos;
- ao longo do dia, o alerta vermelho no canto fica até o clique.

O que a v1 acrescenta: mídia gravada, o modo `interrupt`, a confirmação por 👍 com reprodução obrigatória, o quadro fixo por ilha e o reenvio.

#### B.9.1 Tipos

```ts
export type AnnouncementMedia =
  | { readonly kind: 'none' }
  | { readonly kind: 'audio'; readonly url: string; readonly mimeType: string; readonly durationMs: number; readonly source: 'recorded' | 'file' }
  | { readonly kind: 'video'; readonly url: string; readonly mimeType: string; readonly durationMs: number; readonly source: 'recorded' | 'file'; readonly posterUrl?: string }
  | { readonly kind: 'image'; readonly url: string; readonly mimeType: string }
  | { readonly kind: 'document'; readonly url: string; readonly mimeType: string; readonly fileName: string; readonly sizeBytes: number };

export type AnnouncementContent = {
  readonly title: string;                 // 1..120
  readonly body: string;                  // 0..4000 (formatação de B.10)
  readonly media: AnnouncementMedia;      // uma mídia principal na v1
};

/** v2.2 + 'ilhas' (N:N). Listas não vazias pelo tipo. */
export type Audience =
  | { readonly kind: 'all' }
  | { readonly kind: 'ilhas'; readonly ilhaIds: readonly [IlhaId, ...IlhaId[]] }      // agentes e supervisores das ilhas
  | { readonly kind: 'groups'; readonly groupIds: readonly [ConversationId, ...ConversationId[]] } // fixado na publicação (v2.2)
  | { readonly kind: 'people'; readonly userIds: readonly [UserId, ...UserId[]] };
export function resolveAudience(a: Audience, d: Directory, groups: readonly GroupConversation[]):
  Result<readonly UserId[], 'cross-tenant' | 'unknown-group' | 'unknown-user' | 'unknown-ilha' | 'empty'>;

export type Delivery =
  | { readonly kind: 'board' }                                            // v2.2: quadro e alerta no canto, não trava
  | { readonly kind: 'interrupt'; readonly requireFullPlayback: boolean }; // abre por cima e só sai com 👍 (B.9.4)

export type AnnouncementRevision = {
  readonly no: RevisionNo; readonly content: AnnouncementContent;
  readonly editedAt: IsoInstant; readonly editedBy: UserId; readonly material: boolean;
};

export type Announcement = {
  readonly id: AnnouncementId; readonly tenantId: TenantId; readonly authorId: UserId;
  readonly audience: Audience; readonly audienceUserIds: readonly UserId[];   // a fotografia
  readonly delivery: Delivery;
  readonly requiresAck: boolean;          // interrupt ⇒ true (o request impõe)
  readonly pinned: boolean;               // "quadro fixo": no topo do quadro da(s) ilha(s) até expirar ou desafixar
  readonly publishedAt: IsoInstant; readonly expiresAt: IsoInstant | null;
  readonly revisions: readonly [AnnouncementRevision, ...AnnouncementRevision[]];
};
export function currentRevision(a: Announcement): AnnouncementRevision;
export function ackRevision(a: Announcement): RevisionNo;      // última revisão material
export function isExpired(a: Announcement, now: IsoInstant): boolean;

export type PublishAnnouncementRequest = {
  readonly clientId: ClientId; readonly content: AnnouncementContent; readonly audience: Audience;
  readonly expiresAt: IsoInstant | null; readonly pinned: boolean;
} & (
  | { readonly delivery: { readonly kind: 'board' }; readonly requiresAck: boolean }
  | { readonly delivery: { readonly kind: 'interrupt'; readonly requireFullPlayback: boolean }; readonly requiresAck: true }
);
export type AnnouncementEdit =
  | { readonly kind: 'content'; readonly content: AnnouncementContent; readonly material: boolean }
  | { readonly kind: 'expiry'; readonly expiresAt: IsoInstant | null }   // nunca material
  | { readonly kind: 'audience'; readonly audience: Audience }           // nunca material; recalcula audienceUserIds
  | { readonly kind: 'pin'; readonly pinned: boolean };                  // nunca material
export type EditAnnouncementRequest = { readonly id: AnnouncementId; readonly edit: AnnouncementEdit };

/** O que o leitor recebe: sem audienceUserIds, sem a escolha de público e sem o histórico de revisões. */
export type AnnouncementForReader = Omit<Announcement, 'audience' | 'audienceUserIds' | 'revisions'> & {
  readonly current: AnnouncementRevision; readonly ackRevision: RevisionNo; readonly edited: boolean;
  readonly ilhaIds: readonly IlhaId[];   // só para agrupar o quadro fixo por ilha (vazio fora de 'ilhas')
};
export type AnnouncementForAuthor = Announcement & { readonly tally: ReceiptTally };

export type AnnouncementBootstrap = {
  readonly board: readonly { readonly announcement: AnnouncementForReader; readonly receipt: ReceiptState }[]; // can(read), não expirados
  readonly authored: readonly AnnouncementForAuthor[];                                                         // os meus (admin: todos do tenant)
};
```

#### B.9.2 Recibo: ver, assistir e confirmar são estados separados

```ts
export type ReceiptState =
  | { readonly phase: 'unseen' }
  | { readonly phase: 'viewed'; readonly viewedAt: IsoInstant; readonly maxPositionMs: number }
  | { readonly phase: 'played'; readonly viewedAt: IsoInstant; readonly playedAt: IsoInstant }   // reprodução completa
  | { readonly phase: 'acknowledged'; readonly viewedAt: IsoInstant; readonly playedAt: IsoInstant | null; readonly acknowledgedAt: IsoInstant };

export type AnnouncementRevisionRef = { readonly id: AnnouncementId; readonly revision: RevisionNo };
export type PlaybackReport = AnnouncementRevisionRef & { readonly maxPositionMs: number; readonly durationMs: number; readonly ended: boolean };

export type ReceiptEvent =
  | { readonly type: 'viewed'; readonly at: IsoInstant }
  | { readonly type: 'playback'; readonly at: IsoInstant; readonly maxPositionMs: number; readonly durationMs: number; readonly ended: boolean }
  | { readonly type: 'acknowledged'; readonly at: IsoInstant };

export type AckDenial = 'not-in-audience' | 'expired' | 'stale-revision' | 'playback-required' | 'not-viewed';
/** Pura e idempotente. 'played' exige ended e maxPositionMs ≥ 95% de durationMs. A posição só cresce. */
export function nextReceipt(s: ReceiptState, e: ReceiptEvent, rule: { readonly requireFullPlayback: boolean }): Result<ReceiptState, AckDenial>;

export type ReceiptTally = {
  readonly revision: RevisionNo;
  readonly viewed: readonly { readonly userId: UserId; readonly at: IsoInstant }[];
  readonly played: readonly { readonly userId: UserId; readonly at: IsoInstant }[];
  readonly acknowledged: readonly { readonly userId: UserId; readonly at: IsoInstant }[];
  readonly pending: readonly UserId[];     // no público e sem ciência na ackRevision
  readonly lastReminderAt: IsoInstant | null;
};
export type ReceiptsPanel = ReceiptTally & {
  readonly byIlha: readonly { readonly ilhaId: IlhaId; readonly acknowledged: number; readonly total: number }[];
  readonly history: readonly ReceiptTally[];   // uma por revisão material anterior
};
```

Regras:
- **Visualizar**: o card fica ≥60% visível por ≥1 s, ou o detalhe é aberto, ou o overlay `interrupt` aparece (v2.2).
- **Assistir** (só com `requireFullPlayback` e mídia de áudio ou vídeo): o player não deixa avançar além de `maxPositionMs`; voltar pode. O fim conta quando `ended` e a posição chega a 95% ou mais. A velocidade fica travada em 1x no modo obrigatório. **Limite:** a verificação é do navegador; ela prova que a mídia tocou até o fim, não que a pessoa prestou atenção. O texto da UI não promete mais que isso.
- **Confirmar (👍)**: o botão "👍 Confirmo que vi" fica desabilitado até `played` (ou até `viewed`, quando não há mídia obrigatória). O servidor **recusa** com `playback-required` se o recibo não chegou lá.
- Edição importante (material) cria a revisão N+1 e reabre tudo para a revisão nova: o estado volta a `unseen` e o modo `interrupt` volta a abrir. A correção não reabre. Mudar público, expiração ou fixação nunca é material (v2.2).
- Quem entra no público numa edição fica `unseen`. Quem sai recebe `announcement-revoked`, e o recibo dele fica no histórico do autor.

#### B.9.3 Quem pode (`permissions.ts`: ações novas)

| Ação | Regra |
|---|---|
| publicar para `all` | `announcement.publish` (D5) |
| publicar para `ilhas` | `announcement.publish` e cada ilha no escopo de gestão do ator (supervisor de alguma delas; o admin, todas) |
| publicar para `groups` | `announcement.publish` e o ator é membro de cada grupo |
| publicar para `people` | `announcement.publish`; todas as pessoas do tenant, ativas e com `chat.use` |
| `delivery: interrupt` | igual a publicar. **Sem capacidade nova** (D-V1-2) |
| `announcement.edit` | o autor com `announcement.publish`; o admin edita qualquer aviso do tenant (v2.2) |
| `announcement.read` | estar em `audienceUserIds` ou ser o autor, e não estar expirado (o autor vê os encerrados) |
| `announcement.receipts` e `remind` | o autor com `announcement.receipts`; o admin, todos do tenant |
| `announcement.forward` | B.9.6 |

O reenvio (`remind`) tem limite de 1 a cada 10 min por aviso (o servidor recusa com `ForbiddenError` de motivo `rate-limited`) e vai só para `pending`.

#### B.9.4 Quando o aviso abre (função pura `announcementPrompt`)

```ts
export type PromptTrigger = 'connect' | 'became-available' | 'arrived' | 'reminder';
export type AnnouncementPrompt =
  | { readonly kind: 'none' }
  | { readonly kind: 'interrupt'; readonly queue: readonly [AnnouncementId, ...AnnouncementId[]] }   // overlay, um por vez, do mais antigo para o mais novo
  | { readonly kind: 'open-board'; readonly first: AnnouncementId; readonly count: number }          // v2.2: 1º login do dia
  | { readonly kind: 'corner-alert'; readonly newest: AnnouncementId; readonly count: number };      // v2.2: ao longo do dia
export function announcementPrompt(input: {
  readonly entries: readonly { readonly announcement: AnnouncementForReader; readonly receipt: ReceiptState }[];
  readonly presence: PresenceStatus;
  readonly trigger: PromptTrigger;
  readonly firstLoginOfDay: boolean;
  readonly redirectedThisSession: boolean;
  readonly now: IsoInstant;
}): AnnouncementPrompt;
```

Ordem de decisão:
1. Há `interrupt` pendente (não expirado e sem ciência na `ackRevision`) e o status é `available`: o resultado é `interrupt`. Em pausa ou ausente **não abre**; abre no próximo `became-available`.
2. Senão, vale o `boardPrompt` da v2.2 sem mudança: `open-board` ou `corner-alert`.
3. Senão, `none`.

O overlay `interrupt`:
- é um `role="dialog"` com `aria-modal`, sem botão de fechar, e o chat fica inerte por trás (`inert`);
- o agente sai dele com 👍, trocando o status para Pausa ou Ausente (o aviso fica pendente e volta no próximo Disponível) ou com "Sair";
- vários pendentes abrem em fila, com a indicação "1 de 3".

Regra: D-V1-1.

#### B.9.5 Painel do supervisor

O painel fica na tela "Avisos", aba "Enviados". Por aviso, mostra:
- os contadores Viu, Assistiu, Confirmou e Falta, com a barra por ilha;
- as listas com nome e hora (fuso do tenant);
- o filtro "só pendentes";
- o botão "Reenviar para quem falta (N)", com o horário do último reenvio;
- o histórico de revisões com o tally de cada uma.

O painel se atualiza ao vivo pelo evento `announcement-receipts`.

A tela "Avisos" do agente tem duas seções: "Fixados" (agrupados por ilha) e "Recentes". Os encerrados aparecem só para o autor, na aba "Encerrados".

#### B.9.6 Encaminhar aviso nunca amplia o público

```ts
export type ForwardAnnouncementRequest = { readonly announcementId: AnnouncementId; readonly targets: readonly [ConversationId, ...ConversationId[]]; readonly clientId: ClientId }; // 1..5
export type AnnouncementForwardDenial = 'not-member' | 'audience-not-covering' | 'cross-tenant' | 'expired' | 'not-readable';
/** Válido ⇔ mesmo tenant ∧ o ator é membro ∧ TODO membro atual do destino ∈ audienceUserIds (ou é o autor). */
export function canForwardAnnouncementTo(actor: StaffUser, a: Announcement, target: Conversation, now: IsoInstant): Result<true, AnnouncementForwardDenial>;
```

- A mensagem leva só a referência (`AnnouncementRefMessage`).
- O render reavalia `can(read)` a cada vez, e mostra "Aviso restrito" ou "Aviso encerrado" **sem o título no DOM** (v2.2 §2.6).
- O seletor mostra os destinos bloqueados desabilitados, com o motivo "Nem todos neste grupo podem ver este aviso".
- O servidor recusa o encaminhamento forjado para um destino não coberto.
- Mensagem comum (B.3) segue o WhatsApp: é uma cópia com o selo de encaminhada, sem autor nem conversa de origem (D-V1-4).

#### B.9.7 Gravação pela câmera e pelo microfone (`apps/internal/src/media/recorder.ts`)

```ts
export type RecordingKind = 'audio' | 'video';
export type RecorderState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'requesting' }
  | { readonly phase: 'denied'; readonly reason: 'permission' | 'no-device' | 'insecure-context' | 'unsupported' }
  | { readonly phase: 'recording'; readonly kind: RecordingKind; readonly startedAt: number; readonly level: number }   // level 0..1 para a onda
  | { readonly phase: 'done'; readonly blob: Blob; readonly mimeType: string; readonly durationMs: number; readonly waveform: readonly number[] };
export interface RecorderPort {
  start(kind: RecordingKind, opts: { readonly maxDurationMs: number }): Promise<void>;
  stop(): void;
  cancel(): void;
  getState(): RecorderState;
  subscribe(l: (s: RecorderState) => void): () => void;
}
// Implementações: BrowserRecorder (MediaRecorder + getUserMedia + AnalyserNode) e FakeRecorder (testes).
```

- O `MEDIA_RULES` passa a aceitar `audio/webm` e `audio/ogg;codecs=opus` (gravação de áudio), e `video/webm` (gravação de vídeo, aviso).
- Limites: áudio de mensagem até 15 min; vídeo de aviso até 5 min e 16 MB (teto atual de vídeo). Regra: D-V1-5.
- O Playwright usa `--use-fake-device-for-media-stream` e `--use-fake-ui-for-media-stream`.
- Gestos do áudio: segurar o microfone grava e soltar envia; arrastar para a esquerda cancela; arrastar para cima trava a gravação. Pelo teclado, Enter começa e para, e Esc cancela. O player de áudio tem 1x, 1.5x e 2x (fora do modo obrigatório).

### B.10 Texto: formatação, menção e link (UI pura, `apps/internal/src/ui/text/`)

```ts
export type TextSpan =
  | { readonly kind: 'plain'; readonly text: string }
  | { readonly kind: 'bold' | 'italic' | 'strike' | 'mono'; readonly children: readonly TextSpan[] }
  | { readonly kind: 'mention'; readonly userId: UserId; readonly label: string }
  | { readonly kind: 'link'; readonly href: string; readonly text: string };   // só http(s)
export function parseRichText(text: string, mentions: readonly { readonly userId: UserId; readonly label: string }[]): readonly TextSpan[];
export type LinkPreview = { readonly href: string; readonly host: string };   // v1: só o host, sem rede
export function firstLinkPreview(spans: readonly TextSpan[]): LinkPreview | null;
```

O render usa só nós React. `dangerouslySetInnerHTML` é proibido, e o lint impõe isso (regra nova em `eslint.config.js` do app). O link abre com `rel="noopener noreferrer"` e `target="_blank"`.

### B.11 Notificações (Etapa 7 da v2.2, sem mudança de regra)

O `Notifier` é uma porta, com `BrowserNotifier` e `FakeNotifier`. A política pura `notificationDecision` funciona assim:
- aba oculta: notificação do sistema;
- outra conversa aberta: toast e som;
- conversa aberta: nada;
- nunca a própria mensagem;
- conversa silenciada só notifica menção.

Outros comportamentos:
- O título mostra "(N) ViaVoip".
- O som toca no máximo 1 vez a cada 3 s por conversa.
- O banner pede a permissão só no clique.
- `reminder-due`, aviso novo e `announcement-reminder` também notificam.
- Evento de outro tenant nunca chega ao `Notifier`.
- Nada com o navegador fechado: sem Service Worker e sem Push.

### B.12 Tema

O `chat.css` ganha `:root[data-theme='dark']` com **todos** os tokens semânticos. A preferência fica em `localStorage` (`viavoip.chat.theme` = `light`, `dark` ou `system`), e `system` segue `prefers-color-scheme`. O `contrast.test.ts` cobre os dois temas. Cor nova só por token, e o gate de hex continua.

### B.13 Seams de integração (Onda 0b): para as frentes não editarem os mesmos arquivos

```ts
// apps/internal/src/shell/slots.ts  (tipos: Onda 0b, Codex; preenchimento em shell/registry.ts: Gemini)
export type ShellContext = {
  readonly session: ChatSession; readonly state: ChatSessionState;
  readonly me: StaffUser; readonly directory: Directory; readonly tenant: Tenant;
  readonly transport: ChatTransport; readonly openConversation: (id: ConversationId) => void;
};
export type ShellViewId = Brand<string, 'ShellViewId'>;
export type ShellView = {
  readonly id: ShellViewId; readonly label: string; readonly icon: LucideIcon;
  readonly visible: (ctx: ShellContext) => boolean; readonly badge?: (ctx: ShellContext) => number;
  readonly render: (ctx: ShellContext & { readonly onClose: () => void }) => ReactNode;
};
export type ShellSlots = {
  readonly views: readonly ShellView[];                               // Avisos, Novidades e Debug: ícones na Sidebar
  readonly overlays: readonly ((ctx: ShellContext) => ReactNode)[];   // aviso interrupt, alerta de canto, painel de debug, banner de notificação
  readonly menuItems: readonly { readonly label: string; readonly visible: (ctx: ShellContext) => boolean; readonly onSelect: (ctx: ShellContext) => void }[];
  readonly messageRenderers: { readonly announcement?: (m: AnnouncementRefMessage, ctx: ShellContext) => ReactNode };
};
// apps/internal/src/shell/registry.ts
export function createShellSlots(): ShellSlots;   // Onda 0b devolve tudo vazio; a Gemini preenche
```

- O `ChatPanel` e a `Sidebar` (Cursor) renderizam os slots, e não importam nada de `announcements/`, `debug/` nem `notifications/`.
- O `main.tsx` e o `App.tsx`, **congelados depois da 0b**, chamam `createShellSlots()` e `wrapTransportForDebug(transport, flags)`. Essa função fica em `src/debug/index.ts`, e a 0b a entrega como identidade.
- `ChatSessionState` ganha `bootstrap: Bootstrap | null`, só leitura. Assim os módulos de avisos e de notificações leem `announcements` e `firstLoginOfDay` sem que o `ChatSession` precise entender avisos.
- Ponte de avisos: o estado vivo dos avisos (quadro, recibos e tallies) fica em `src/announcements/AnnouncementStore.ts` (Gemini). Ele é inicializado por `state.bootstrap.announcements` e assina `transport.subscribe` para os eventos `announcement*`. O `ChatSession` **ignora** esses eventos. Um dono por pedaço de estado.

---

## Parte C. Flag de debug

**Objetivo:** com a flag ligada, registrar tudo o que a sessão faz (eventos do transporte, chamadas, mudanças de estado, ações e erros) num painel lateral com filtro, tempo e exportação JSON. Com a flag desligada, custo zero e nenhum registro.

### C.1 Ligar e desligar

- `?debug=1` liga na aba e grava em `sessionStorage` (`viavoip.chat.debug=1`). `?debug=0` desliga.
- Toggle do admin: um item "Modo debug neste navegador" no menu do usuário, visível só para o admin (slot `menuItems`). Ele grava em `localStorage` e recarrega. **É local ao navegador.** Não existe flag remota (D-V1-8).
- **Desligado por padrão.** O `wrapTransportForDebug` devolve o transporte original, sem `Proxy` e sem buffer. O teste prova isso: com a flag desligada, `wrapTransportForDebug(t, off) === t`, e `debugAction` não aloca nada.
- O selo "DEBUG" fica fixo no topo enquanto a flag estiver ligada.

### C.2 Modelo de trace (`apps/internal/src/debug/trace.ts`)

```ts
export type TraceId = Brand<number, 'TraceId'>;
export type Redacted = Readonly<Record<string, unknown>> | readonly unknown[] | string | number | boolean | null; // saída de redact()
export type TraceError = { readonly name: string; readonly message: string; readonly stack?: string };
export type TraceEntry =
  | { readonly kind: 'ws-in'; readonly id: TraceId; readonly t: number; readonly eventType: ChatEvent['type']; readonly event: Redacted }
  | { readonly kind: 'api'; readonly id: TraceId; readonly t: number; readonly method: keyof ChatTransport; readonly request: Redacted;
      readonly outcome: { readonly ok: true; readonly ms: number; readonly response: Redacted } | { readonly ok: false; readonly ms: number; readonly error: TraceError } }
  | { readonly kind: 'state'; readonly id: TraceId; readonly t: number; readonly changed: readonly (keyof ChatSessionState)[]; readonly summary: Redacted }
  | { readonly kind: 'error'; readonly id: TraceId; readonly t: number; readonly source: 'window' | 'promise' | 'session' | 'react'; readonly error: TraceError }
  | { readonly kind: 'action'; readonly id: TraceId; readonly t: number; readonly name: string; readonly detail: Redacted }; // ex.: 'composer.send', 'announcement.ack'
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export interface TraceBuffer {
  push(e: DistributiveOmit<TraceEntry, 'id'>): void;
  entries(): readonly TraceEntry[];
  clear(): void;
  subscribe(l: () => void): () => void;
}
export function createTraceBuffer(opts: { readonly capacity: number }): TraceBuffer;   // anel; capacidade 2000
```

As fontes:
- **`TracingTransport`** (`debug/TracingTransport.ts`) é um decorador de `ChatTransport`: mede cada método (`api`) e cada evento do `subscribe` (`ws-in`). Funciona igual com o `MockTransport` e com o `SocketTransport` futuro. No mock, é o que faz o papel do websocket; na F6, é o socket de verdade.
- **`state`**: um overlay compara o `ShellContext.state` anterior com o atual, olhando só as chaves de topo. O `summary` leva só contagens: conversas, mensagens por conversa, uploads e conexão.
- **`error`**: `window.onerror`, `unhandledrejection`, as mudanças em `state.error` e um error boundary em volta do painel.
- **`action`**: `debugAction(name, detail)`, exportada por `debug/index.ts`, que vira no-op com a flag desligada. A UI chama nos pontos-chave. É a **única** importação de `debug/` permitida fora de `debug/`, `main.tsx` e `App.tsx`.

### C.3 Redação: sem vazar dados sensíveis (`debug/redact.ts`, pura e testada em tabela)

| Campo | Vira |
|---|---|
| `text`, `caption`, `body`, `title`, `question`, `note`, `excerpt`, `query`, `shortcut` e opções de enquete | `{ len: n }` |
| `url` e `posterUrl` (`blob:` ou http) | `{ scheme, len }` |
| `fileName` | `{ ext, len }` |
| `name` e `author.name` | `{ len }` |
| chave que casa com `/token\|password\|secret\|authorization\|cookie\|credential/i` | `'[redacted]'` |
| `Blob` e `File` | `{ size, type }` |
| ids (`UserId`, `ConversationId`, `MessageId` etc.), `type`, `kind`, `phase`, `status`, `emoji`, contagens e horários | mantidos |

- A redação é **por lista de permissão**: uma string em campo novo e desconhecido vira `{ len }`. Só passa em claro o que está na lista.
- O teste de propriedade (fast-check) gera eventos e requests arbitrários com uma string sentinela em todo campo de texto, e a sentinela nunca pode aparecer no buffer nem no JSON exportado.
- O buffer fica só em memória: nunca em `localStorage`, nunca enviado à rede. Ele é limpo em `switchUser`, em `session-ended` e ao desligar a flag.

### C.4 Painel (`debug/DebugPanel.tsx`)

- É lateral e redimensionável. No 390, ocupa a tela inteira, abre pelo selo "DEBUG" e fecha com "Fechar".
- Mostra as últimas 500 entradas após o filtro, com o tempo relativo (`+123 ms`) e o absoluto (HH:MM:SS.mmm, no fuso do navegador). Clicar numa linha expande o JSON redigido.
- Filtros por tipo (ws-in, api, state, error, action), mais busca por `method` ou `eventType` e "só erros".
- Ações: pausar a captura, limpar e **Exportar JSON**.
- A exportação baixa `debug-<tenantId>-<userId>-<AAAAMMDD-HHMMSS>.json` (Blob e `a[download]`):

```json
{ "schema": "viavoip.chat.debug/1", "app": { "version": "1.0.7" },
  "exportedAt": "2026-11-18T18:30:00.000Z", "tenantId": "ics", "userId": "ics-ana",
  "userAgent": "…", "entries": [] }
```

- O painel é acessível: axe limpo, `role="log"` na lista e foco preso só no modo tela cheia.

---

## Parte D. Versionamento e notas (formato do SM Report Studio, adaptado ao `apps/internal`)

### D.1 O que o arquivo de referência mostra [verificado]

Fonte: `/workspace/chat-interno-v1/referencia-SM-Report-Studio-RELEASE_NOTES.md`. O `RELEASE_NOTES.md` do SM Report Studio está na versão `1.7.36`, de 17/11/2026.

- **Número:** `<MAJOR>.<MINOR>.<BUILD>`, **sem zeros à esquerda** (`1.7.9`, `1.7.10`). A série base é `MAJOR.MINOR` (`1.7`). O BUILD **começa em 1** em cada série; não existe `x.y.0`. O build `1.7.3` registra a conversão retroativa que tirou os zeros à esquerda do histórico.
- **A cada pedido:** BUILD sobe +1. Atualizam-se as constantes `APP_BUILD_NUMBER` e `RELEASE_NOTES_HISTORY` em `src/version.ts`, e o bloco novo entra no topo do histórico em `RELEASE_NOTES.md`. Alternativa: `node scripts/bump-version.mjs "<Título da alteração>" "<Detalhe 1>"`.
- **Remix (nova série):** `APP_BASE_VERSION` muda para a série nova e `APP_BUILD_NUMBER` volta para 1 (`1.8.1`), **preservando todo o histórico**. Alternativa: `node scripts/bump-version.mjs --remix 1.8 "Início da série 1.8"`.
- **Estrutura do `RELEASE_NOTES.md`:**
  - título;
  - cabeçalho em citação com "Versão Atual de Compilação", "Série Base Atual" e "Última Atualização";
  - a seção do protocolo (`[AI_STUDIO_VERSIONING_PROTOCOL]`);
  - uma seção por série, da mais nova para a mais antiga: `` ## 📦 Histórico de Alterações — Série `1.7` (`1.7.1` a `1.7.36`) ``;
  - dentro da série, blocos do mais novo para o mais antigo: `` ### Build `1.7.36` — *17/11/2026* ``, uma linha com o **título em negrito** e os itens em lista, com subitens quando preciso.
- O app mostra a versão ativa num badge (`v1.6.12` no rodapé, build 1.6.12) e tem um modal de release notes (`ReleaseNotesModal.tsx`, citado no 1.7.26).

O conteúdo do `src/version.ts` e do `bump-version.mjs` do SM Report Studio **não está no arquivo**: só os nomes das constantes e a linha de comando. O desenho abaixo é meu, e segue esses nomes.

### D.2 Adaptação ao monorepo (decidido)

| No SM Report Studio | No Chat Interno |
|---|---|
| `/src/version.ts` | `apps/internal/src/version.ts` |
| `/RELEASE_NOTES.md` | `apps/internal/RELEASE_NOTES.md` |
| `/scripts/bump-version.mjs` | `apps/internal/scripts/bump-version.mjs` (Node puro, sem dependência), mais o script `pnpm --filter @viavoip/internal version:bump` |
| "Remix" no AI Studio, ou mudança em `metadata.json` | Nova série só quando o Luan pedir ("vamos iniciar a 1.1"). Não há `metadata.json` aqui |
| Série inicial | **`1.0`, começando em `1.0.1`** (o build da 0c). Isso troca o "1.0.0" da v0 desta spec: o formato real não tem `.0` |
| Escopo | Pedidos que alterem `apps/internal/` ou `packages/internal-domain/` (decisão 9) |
| Badge | `v{APP_VERSION}` na tela Novidades e no item de menu "Novidades" (Gemini, frente D) |
| Página Novidades no app | Lê `RELEASE_NOTES_HISTORY` de `version.ts` (dado estruturado, sem parser de Markdown no app) |
| Branches paralelos | Regra nova (D.5): pendente em JSON e consolidação pelo script, porque `version.ts` e `RELEASE_NOTES.md` dariam conflito em todo rebase |

### D.3 Desenho de `apps/internal/src/version.ts`

```ts
// Gerenciado por scripts/bump-version.mjs. Regra em AGENTS.md ("Versão e notas").
// O trecho entre @bump-begin e @bump-end é JSON válido (aspas duplas): o script lê e regrava.

export type ReleaseNote = {
  readonly version: string;            // "1.0.3", sem zeros à esquerda
  readonly date: string;               // "18/11/2026" (DD/MM/AAAA, America/Sao_Paulo)
  readonly title: string;              // a linha em negrito
  readonly details: readonly string[]; // ≥ 1 item
};

export const APP_BASE_VERSION = '1.0';
export const APP_BUILD_NUMBER = 1;
export const APP_VERSION = `${APP_BASE_VERSION}.${APP_BUILD_NUMBER}`;

/** Do mais novo para o mais antigo, todas as séries. */
export const RELEASE_NOTES_HISTORY: readonly ReleaseNote[] = /* @bump-begin */ [
  {
    "version": "1.0.1",
    "date": "18/11/2026",
    "title": "Sistema de versionamento incremental e release notes do Chat Interno",
    "details": [
      "Criação de `src/version.ts`, `RELEASE_NOTES.md` e `scripts/bump-version.mjs`, no formato do SM Report Studio.",
      "Regra no `AGENTS.md`: a IA sobe o BUILD a cada pedido."
    ]
  }
] /* @bump-end */;
```

### D.4 Desenho de `apps/internal/scripts/bump-version.mjs`

```
node apps/internal/scripts/bump-version.mjs "<Título da alteração>" "<Detalhe 1>" ["<Detalhe 2>" ...]
node apps/internal/scripts/bump-version.mjs --remix 1.1 "<Título>" "<Detalhe 1>" [...]
node apps/internal/scripts/bump-version.mjs --from-pending apps/internal/release-notes/pendentes/<branch>.json
node apps/internal/scripts/bump-version.mjs --check
# opções: --dry-run (mostra o diff e não grava)
```

Comportamento:
1. Lê `version.ts` por regex (`APP_BASE_VERSION`, `APP_BUILD_NUMBER`) e o JSON entre `@bump-begin` e `@bump-end`. Não executa TypeScript.
2. Bump normal: `build + 1`. Com `--remix X.Y`: X.Y precisa ser maior que a série atual, e o build vira 1.
3. A data é a de hoje em `America/Sao_Paulo` (`Intl.DateTimeFormat('pt-BR')`), no formato DD/MM/AAAA.
4. Grava, numa operação só (arquivo temporário e `rename`; se um falhar, nenhum muda):
   - `version.ts`: as duas constantes e a entrada nova no topo de `RELEASE_NOTES_HISTORY`;
   - `RELEASE_NOTES.md`:
     - o cabeçalho em citação (as três linhas);
     - a faixa da série no título da seção (`` (`1.0.1` a `1.0.N`) ``);
     - o bloco novo no topo da seção da série;
     - numa remix, a seção nova acima da anterior, com `---` entre as duas.
5. `--from-pending <arquivo>`: o arquivo é `[{ "title": "...", "details": ["..."] }, ...]`, do mais antigo para o mais novo. O script aplica um bump por item, na ordem, e apaga o arquivo no fim.
6. `--check`: valida, sem gravar, o mesmo que `version.test.ts` (D.6). Sai com código 1 e a lista de problemas. A CI pode chamar depois; o `ci.yml` só muda com autorização.
7. Recusa: título ou detalhe vazio; `APP_BUILD_NUMBER` incoerente com o topo do histórico; `--check` falhando antes do bump. Nesses casos, sai com código 1 sem gravar.
8. Testes do script: `apps/internal/scripts/bump-version.test.ts` (Vitest), com diretório temporário cobrindo bump, remix, pendente, `--check` e as recusas.

### D.5 Arquivo `RELEASE_NOTES.md` inicial (0c)

```markdown
# Chat Interno ViaVoip — Release Notes & Controle de Versão de Compilação

> **Versão Atual de Compilação:** `1.0.1`  
> **Série Base Atual:** `1.0`  
> **Última Atualização:** `18/11/2026`

---

## 🤖 Protocolo de versionamento (resumo)

Formato `<MAJOR>.<MINOR>.<BUILD>` sem zeros à esquerda. A cada pedido, BUILD +1 via `scripts/bump-version.mjs`. Nova série só quando o Luan pedir (`--remix`), reiniciando em `.1` e preservando o histórico. Regra completa em `AGENTS.md` ("Versão e notas").

---

## 📦 Histórico de Alterações — Série `1.0` (`1.0.1` a `1.0.1`)

### Build `1.0.1` — *18/11/2026*
**Sistema de versionamento incremental e release notes do Chat Interno**
- Criação de `src/version.ts`, `RELEASE_NOTES.md` e `scripts/bump-version.mjs`, no formato do SM Report Studio.
- Regra no `AGENTS.md`: a IA sobe o BUILD a cada pedido.
```

A data real é a do dia em que a 0c rodar.

### D.6 Teste de guarda (`apps/internal/src/version.test.ts`)

- `APP_VERSION` é igual ao "Versão Atual de Compilação" do cabeçalho, ao primeiro `### Build` do arquivo e a `RELEASE_NOTES_HISTORY[0].version`. "Série Base Atual" é igual a `APP_BASE_VERSION`.
- Sem zeros à esquerda em nenhum número. Nenhum build `.0`.
- Em cada série, os builds são **contíguos** de N até 1, sem lacuna. As séries aparecem em ordem decrescente.
- A faixa no título de cada série bate com os blocos dela.
- Cada bloco do Markdown tem o mesmo número, data, título e itens da entrada correspondente de `RELEASE_NOTES_HISTORY`, na mesma ordem.
- As datas estão em DD/MM/AAAA e não descem do mais antigo para o mais novo.
- Fixtures negativas para cada regra.

### D.7 Texto exato para colar no `AGENTS.md`

```markdown
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
```

---

## Parte E. Fora da v1

Ficam fora:
- chamada de voz e vídeo, stories e "zap virtual" (plano v1);
- backend real (F5 a F12 do plano de fusão);
- prévia de link com busca de metadados (precisa de servidor, por SSRF e privacidade);
- integração automática com a pausa do SM;
- comentários em aviso (Etapa 9 da v2.2), por decisão do Luan (D-V1-7);
- antivírus;
- Service Worker e Push (decisão do Luan: nada com o navegador fechado).

---

## Parte F. Decisões do Luan (18/11/2026)

O Luan aceitou, via Maestro, os 13 padrões propostos na v0 desta spec. Também confirmou que **tudo nasce no mock** e que **o aviso tem o modo obrigatório** (A.5). Daqui em diante, isto é regra, não pergunta:

| # | Regra |
|---|---|
| D-V1-1 | O aviso `interrupt` trava o chat interno até o 👍 (overlay modal, chat `inert`). O agente pode adiar trocando para Pausa ou Ausente, e o aviso volta no próximo Disponível. O modo `board` segue a v2.2 e não trava (B.9.4) |
| D-V1-2 | Publicar aviso `interrupt` exige só o que publicar já exige. Não há capacidade nova (B.9.3) |
| D-V1-3 | Apagar para todos: só o autor, até 48 h. Editar: só o autor, até 15 min. Supervisor e admin não moderam mensagens de terceiros na v1 (B.3) |
| D-V1-4 | Encaminhar mensagem comum é livre como no WhatsApp: dentro da empresa, entre conversas em que o ator participa, por cópia com selo. "Nunca amplia o público" vale para avisos, encaminhados só por referência e só para destinos cobertos (B.3 e B.9.6) |
| D-V1-5 | Limites de gravação: vídeo de aviso até 5 min e 16 MB; áudio de mensagem até 15 min (B.9.7) |
| D-V1-6 | Respostas rápidas: a pessoal é de qualquer um com `chat.use`; a de ilha, do supervisor dessa ilha ou do admin; a da empresa, só do admin. Não há capacidade nova (B.8.3) |
| D-V1-7 | Comentários em aviso ficam fora da v1 (Parte E) |
| D-V1-8 | O debug é só local ao navegador (`?debug=1` ou o toggle do admin neste navegador). Não há flag remota (C.1) |
| D-V1-9 | A regra de versão e notas vale só para `apps/internal` e `packages/internal-domain`. A série inicial é `1.0`. Pelo formato real (D.2), o primeiro build é `1.0.1`, não `1.0.0` |
| D-V1-10 | A página "Novidades do WebChat" do hml passa a ler as notas do Chat Interno. É uma tarefa separada do Maestro, no gerador do box (`/workspace/smw-deploy/generate_notes.py`), fora das 3 frentes |
| D-V1-11 | Fixar mensagem: em direta, qualquer um dos dois; em grupo, só quem gerencia o grupo |
| D-V1-12 | Os recibos de grupo ("dados da mensagem") são vistos só pelo autor da mensagem. O supervisor não vê os de terceiros (B.6) |
| D-V1-13 | Se o design base da Arena não chegar antes da frente A do Cursor, ela segue o layout atual (100dvh, tokens), e o visual da Arena entra depois só como tokens e CSS, sem mexer no contrato |
| D-V1-14 | Tudo nasce no mock. A `contract.suite.ts` é obrigatória já na v1, e o servidor (F5 em diante) implementa contra ela (A.5, item 1) |
| D-V1-15 | O aviso tem dois modos de entrega: `board` (v2.2) e `interrupt` (obrigatório, com 👍 e, quando pedido, reprodução completa) (A.5, item 2, e B.9) |
