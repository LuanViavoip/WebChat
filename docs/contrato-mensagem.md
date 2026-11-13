# Contrato da mensagem normalizada (rascunho)

Este documento descreve o formato **interno** do ChatWeb. Ainda não há acesso ao repositório do SM; o alinhamento com o payload do canal WhatsApp do SM virá numa etapa posterior.

## Identidade

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | string | Identificador da mensagem. No envio do cliente, começa igual ao `clientId`. |
| `clientId` | string (opcional) | Id estável gerado **no cliente** antes do round-trip. Confirmações de status correlacionam por `clientId` ou `id`. |
| `conversationId` | string | Conversa / ticket. Nesta etapa o id é fixo (`conversa-teste`); `start()` reconecta na mesma conversa e o mock preserva as URLs de mídia. |
| `direction` | `client` \| `agent` \| `system` | Quem originou. No cliente web, `client` alinha à direita. `authorId` entra na Etapa 4. |
| `author` | `{ id, name }` | Exibição. |
| `timestamp` | string ISO-8601 | Relógio do emissor. |
| `status` | `sending` \| `sent` \| `delivered` \| `read` \| `error` | Ticks estilo WhatsApp. Só avança (`sending→sent→delivered→read`); `error` pode aplicar a qualquer momento. Status que chega antes da mensagem fica pendente. |
| `type` | união discriminada | Ver abaixo. |

## Envio (`ChatTransport.send`)

O transporte **não** recebe string solta. O cliente monta:

```ts
type SendRequest = {
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
2. `send({ clientId, payload })` — o mock ecoa a mensagem com o mesmo id e emite `status` com `messageId`/`clientId`.
3. Falha de `connect`/`send` vira `connection: error` ou `status: error`; o texto permanece e há **Reenviar** / **Reconectar**.
4. Mídia (Etapa 2) segue **subir → enviar**; ver “Envio de mídia”. `send` só recebe mídia já com `url`.

## Envio de mídia (`ChatTransport.upload`, Etapa 2)

```ts
type UploadRequest = {
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
4. `send({ clientId, payload })` com a `url` definitiva — daqui em diante é igual ao texto (`status`, ticks, **Reenviar**).
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

## Eventos de transporte

- `connection` — `disconnected` \| `connecting` \| `connected` \| `error`
- `message` — mensagem normalizada (replay deve ser idempotente por `id`/`clientId`)
- `status` — `{ messageId, clientId?, status }`
- `typing` — indicador de digitação

`connect({ conversationId })` não leva `patientName`. Enquanto o status é `connecting`, `send`/`upload` esperam o `readyGate`.

Implementação atual: `MockTransport`. Uma implementação SM/WhatsApp deve respeitar a mesma interface, inclusive abortar waits ao `disconnect` e ignorar eventos de época anterior.

## Pendências de alinhamento com o SM

- Nomes de campos do payload oficial do canal WhatsApp
- Mapeamento inbound/outbound vs. `direction`
- Troca de `clientId` por id do servidor quando o canal atribuir um id definitivo
- IDs de mídia / storage: endpoint real de `upload`, se devolve URL ou media id, expiração da URL (a Cloud API expira download em minutos)
- Limites e formatos reais do SM (a tabela acima segue a Cloud API pública)
- Antivírus / validação de conteúdo no servidor
- Eventos de fila, troca de fila, encerramento e pesquisa de satisfação
