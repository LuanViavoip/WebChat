# Contrato da mensagem normalizada (rascunho)

Este documento descreve o formato **interno** do ChatWeb. Ainda não há acesso ao repositório do SM; o alinhamento com o payload do canal WhatsApp do SM virá numa etapa posterior.

## Identidade

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | string | Identificador da mensagem. No cliente, a mensagem otimista começa com `id === clientId`; o servidor atribui o id definitivo (`msg:${tenantId}:${n}` no mock) e a sessão alia os dois. |
| `clientId` | string (opcional) | Id estável gerado **no cliente** antes do round-trip. Confirmações de status correlacionam por `clientId` ou `id`. |
| `tenantId` | `TenantId` (branded) | Empresa dona da mensagem. Toda entidade de domínio carrega o tenant; o servidor nunca entrega uma mensagem a quem é de outro tenant. |
| `conversationId` | `ConversationId` (branded) | Conversa. Direta: `dm:${tenantId}:${menor}:${maior}`. Todo `send`, `upload`, `markRead` e evento leva o `conversationId`. Até o Bloco 3 a `ChatSession` ainda é de uma conversa só: `start(id)` limpa as mensagens e carrega o histórico do `Bootstrap`; `reconnect()` preserva o que há. O mock guarda as URLs de mídia por conversa e as revoga ao desconectar ou ao trocar de usuário. |
| `authorId` | `UserId` (branded) | Quem escreveu. Substitui `direction`: a UI alinha à direita as mensagens em que `authorId` é o usuário logado. |
| `author` | `{ id, name }` | Nome para exibição (snapshot). Quem é o autor de verdade é `authorId`; a UI passará a derivar o nome do diretório. |
| `timestamp` | string ISO-8601 | Relógio do emissor. |
| `status` | `sending` \| `sent` \| `delivered` \| `read` \| `error` | Ticks estilo WhatsApp. Só avança (`sending→sent→delivered→read`); `error` pode aplicar a qualquer momento. Status que chega antes da mensagem fica pendente. |
| `type` | união discriminada | Ver abaixo. |

## Sessão e Bootstrap (`ChatTransport.connect`)

```ts
type ConnectRequest = { tenantId: TenantId; userId: UserId }

type Bootstrap = {
  tenant: Tenant
  me: StaffUser                                   // com grants
  directory: Directory                            // SÓ do tenant
  conversations: ConversationSummary[]            // só as conversas em que `me` participa
  recent: Record<ConversationId, ChatMessage[]>   // últimas mensagens de cada uma (até 50)
  unread: number                                  // total de não lidas (cada summary traz a sua)
}

connect(request: ConnectRequest): Promise<Bootstrap>
```

O `tenantId` de qualquer outra chamada **não** vem do cliente: o servidor usa o da sessão. `connect` com usuário que não existe na partição do tenant (inclusive id de outro tenant) rejeita com `ForbiddenError`. Reconectar o mesmo usuário preserva uploads em andamento; conectar como outro usuário, ou `disconnect`, aborta tudo e revoga as URLs. `firstLoginOfDay` e o quadro de avisos entram na Etapa 8.

## Envio (`ChatTransport.send`)

O transporte **não** recebe string solta. O cliente monta:

```ts
type SendRequest = {
  conversationId: ConversationId
  clientId: string
  payload: OutboundPayload
}

type OutboundPayload =
  | { type: 'text'; text: string }
  | { type: 'image'; caption?: string; mimeType: string; url: string }
  | { type: 'audio'; mimeType: string; url: string; durationMs?: number }
  | { type: 'video'; caption?: string; mimeType: string; url: string }
  | { type: 'document'; fileName: string; mimeType: string; url: string; sizeBytes?: number }
  | { type: 'sticker'; mimeType: string; url: string }
```

Fluxo:

1. UI gera `clientId` e insere mensagem otimista (`status: sending`).
2. `send({ conversationId, clientId, payload })` — o servidor valida com `can(ator, 'conversation.send')`, guarda a mensagem (`sent`) e entrega `message` aos participantes; o eco do autor volta com o mesmo `clientId` (reenvio com o mesmo `clientId` é idempotente). Conversa de outro tenant, inexistente ou sem permissão rejeita com `ForbiddenError`.
3. Falha de `connect`/`send` vira `connection: error` ou `status: error`; o texto permanece e há **Reenviar** / **Reconectar**.
4. Mídia (Etapa 2) segue **subir → enviar**; ver “Envio de mídia”. `send` só recebe mídia já com `url`.

## Envio de mídia (`ChatTransport.upload`, Etapa 2)

```ts
type UploadRequest = {
  conversationId: ConversationId  // upload em c1 não é afetado por envio/troca em c2
  clientId: string            // o mesmo da mensagem otimista
  file: Blob
  fileName: string
  mimeType: string            // canônico, ver tabela de formatos
  signal: AbortSignal         // cancelar
  onProgress: (p: { loaded: number; total: number }) => void
}
upload(request: UploadRequest): Promise<{ url: string }>
```

Fluxo:

1. O cliente valida tipo/tamanho **antes** de qualquer chamada (ver limites).
2. Insere a mensagem otimista (`status: sending`) com `url` local (object URL) para pré-visualização.
3. `upload` reporta progresso; ao concluir devolve a `url` definitiva. A mensagem troca a `url` local pela definitiva.
4. `send({ conversationId, clientId, payload })` com a `url` definitiva — daqui em diante é igual ao texto (`status`, ticks, **Reenviar**).
5. Falha no upload → `status: error` com **Tentar de novo** (sobe o mesmo arquivo de novo, mesmo `clientId`). Falha no `send` depois do upload → **Reenviar** reutiliza a `url` definitiva, sem novo upload.
6. Cancelar (só durante o upload ou após falha do upload) aborta o `signal` e **remove** a mensagem otimista. Nada chega ao canal.

O progresso do upload é estado do cliente, **não** campo da mensagem persistida. Rejeição por aborto usa `UploadCanceledError`; por falha, `UploadFailedError`.

### Formatos e limites (alinhados à WhatsApp Cloud API; confirmar com o SM)

| `type` | Extensões | MIME canônico | Limite | Legenda |
| --- | --- | --- | --- | --- |
| `image` | .jpg .jpeg .png | image/jpeg, image/png | 5 MB | sim (até 1024) |
| `video` | .mp4 .3gp | video/mp4, video/3gpp | 16 MB | sim (até 1024) |
| `audio` | .mp3 .m4a .aac .amr .ogg | audio/mpeg, audio/mp4, audio/aac, audio/amr, audio/ogg | 16 MB | não |
| `document` | .pdf .doc .docx .xls .xlsx .ppt .pptx .txt | ver `src/domain/attachment.ts` | 100 MB | não (nesta etapa) |

`sticker` continua reservado (sem envio na UI). MB = 1024 × 1024 bytes.

## Tipos (`type`) da mensagem persistida

União discriminada. Etapa 1 implementou `text`; **Etapa 2 implementa `image`, `audio`, `video` e `document`**. `sticker` segue reservado.

### `text`

```ts
{
  type: 'text'
  text: string
}
```

O mock da Etapa 3 **não** responde automaticamente. Ticks: `sending → sent → delivered → read`.

### `image` / `video`

```ts
{ type: 'image' | 'video'; mimeType: string; url: string; caption?: string }
```

### `audio`

```ts
{ type: 'audio'; mimeType: string; url: string; durationMs?: number }
```

### `document`

```ts
{ type: 'document'; fileName: string; mimeType: string; url: string; sizeBytes?: number }
```

`sizeBytes` é opcional (mensagens antigas e do canal podem não ter); o card omite o tamanho quando ausente.

### Reservado

- `sticker` — campos como na tabela de `OutboundPayload`; a UI mostra aviso de não suportado.

## Outras operações

```ts
markRead({ conversationId, upToMessageId }): Promise<void>   // só participante; gera `read` + status 'read' para o autor
openDirect({ with: UserId }): Promise<DirectConversation>     // can(ator, 'direct.open'); idempotente: (a,b) == (b,a)
setTyping({ conversationId, isTyping }): void
```

Usuário ou conversa de outro tenant, id inexistente e falta de permissão viram o **mesmo** `ForbiddenError` (`src/transport/errors.ts`): o erro não diz se a entidade existe em outra empresa. `reason` só traz o motivo (`no-chat-use`, `not-participant`, `same-user`...) para negações dentro do tenant.

## Eventos de transporte

Todo evento, exceto `connection`, leva `tenantId` (e os de conversa, `conversationId`). O cliente descarta eventos de outro tenant (defesa em profundidade), e o servidor só endereça a usuários do mesmo tenant.

- `connection` — `disconnected` \| `connecting` \| `connected` \| `error`
- `message` — `{ tenantId, message }`; replay idempotente por `id`/`clientId`
- `status` — `{ tenantId, conversationId, messageId, clientId?, status }`
- `typing` — `{ tenantId, conversationId, userId, isTyping }` (nunca volta para quem digita)
- `read` — `{ tenantId, conversationId, userId, upToMessageId }` (para os participantes, inclusive o próprio leitor em outras abas)
- `conversation` — `{ tenantId, conversation }` (direta nova, para os dois participantes)
- `grants` — `{ tenantId, userId, grants }` (mudança de capacidade, para todo o tenant)

O evento `ended` e o `patientName` não existem mais. Enquanto o status é `connecting`, `send`/`upload`/`markRead`/`openDirect` esperam o `readyGate`.

### Ticks no mock

`sent` ao aceitar; `delivered` quando o destinatário está conectado (ou ao conectar); `read` quando o destinatário chama `markRead`. O `MockTransport` só simula o destinatário com `simulateReceipts: true` (depois de `deliveredMs`/`readMs` ele "recebe" e "lê"); o padrão é `false`. `main.tsx` liga a simulação por ora, porque a UI de conversa única não tem outro humano (TODO Bloco 4: desligar). `markRead` e `setTyping` exigem `chat.use` e participação, como o envio.

## Mock (`src/transport/mock/`)

- `MockServer`: estado **puro e síncrono**, `Map<TenantId, TenantState>`. Cada operação recebe a sessão, resolve o ator no diretório da partição, valida com as mesmas funções do domínio (`can`, `directConversation`, `applyGrant`/`applyRevoke`) e devolve `{ result, deliveries }`, com as entregas endereçadas só a usuários do mesmo tenant. Relógio injetável (`now`).
- `MockStore`: `load`/`save`/`clear` do estado serializável; versão em memória e em `localStorage` (chave `sm-webchat-mock-v2`; `?reset=1` limpa).
- `TabSync`: `BroadcastChannel` entre abas do mesmo perfil, com no-op quando não existe (jsdom). A aba que escreve persiste e faz broadcast das entregas; as outras recarregam o estado e entregam aos usuários conectados nelas.
- Limitação de escrita concorrente: o `localStorage` não tem transação. Cada operação relê o store, aplica e grava, e isso é praticamente atômico dentro de uma aba, mas duas abas escrevendo no mesmo instante podem perder uma das escritas (última grava vence). Aceitável para o mock; o servidor real serializa. Se a gravação falhar (cota/bloqueio), a aba passa a operar só em memória e não relê o storage velho.
- Entradas não confiáveis: o estado lido do storage é validado por inteiro (`fromPersisted`; qualquer incoerência recria a seed) e cada entrega recebida pelo canal é revalidada contra o estado do tenant antes de chegar a um cliente.
- `MockBackend`: cola por aba (servidor + store + TabSync + clientes locais).
- `MockTransport`: o cliente de **um** usuário sobre o backend; mantém atrasos e falhas simuladas (`failConnect`, `failSend`, `failUpload`, `holdConnect`...).
- `seed`: "ICS Saúde" (`ics`, America/Sao_Paulo) e "Clínica Boa Vista" (`bv`, America/Manaus), ids legíveis (`ics-carla`, `bv-paula`...). Usuário padrão da UI até a tela "Entrar como": `ics-carla`.

Uma implementação SM/WhatsApp deve respeitar a mesma interface, inclusive abortar waits ao `disconnect` e ignorar eventos de época anterior.

## Pendências de alinhamento com o SM

- Nomes de campos do payload oficial do canal WhatsApp
- Mapeamento inbound/outbound vs. `authorId`
- Troca de `clientId` por id do servidor quando o canal atribuir um id definitivo
- IDs de mídia / storage: endpoint real de `upload`, se devolve URL ou media id, expiração da URL (a Cloud API expira download em minutos)
- Limites e formatos reais do SM (a tabela acima segue a Cloud API pública)
- Antivírus / validação de conteúdo no servidor
- Eventos de fila, troca de fila, encerramento e pesquisa de satisfação
