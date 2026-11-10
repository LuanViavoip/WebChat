# Contrato da mensagem normalizada (rascunho)

Este documento descreve o formato **interno** do ChatWeb. Ainda não há acesso ao repositório do SM; o alinhamento com o payload do canal WhatsApp do SM virá numa etapa posterior.

## Identidade

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | string | Identificador da mensagem. No envio do cliente, começa igual ao `clientId`. |
| `clientId` | string (opcional) | Id estável gerado **no cliente** antes do round-trip. Confirmações de status correlacionam por `clientId` ou `id`. |
| `conversationId` | string | Conversa / ticket. Novo id a cada `start()`. |
| `direction` | `client` \| `agent` \| `bot` \| `system` | Quem originou. No cliente web, `client` alinha à direita. |
| `author` | `{ id, name }` | Exibição. Bot de pré-atendimento: `ICS Pré-atendimento`. |
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
  | { type: 'document'; fileName: string; mimeType: string; url: string }
  | { type: 'sticker'; mimeType: string; url: string }
```

Fluxo:

1. UI gera `clientId` e insere mensagem otimista (`status: sending`).
2. `send({ clientId, payload })` — o mock ecoa a mensagem com o mesmo id e emite `status` com `messageId`/`clientId`.
3. Falha de `connect`/`send` vira `connection: error` ou `status: error`; o texto permanece e há **Reenviar** / **Reconectar**.
4. Etapa 1.1 ainda **não envia mídia de verdade**. Os tipos existem no contrato; o mock recusa payload ≠ `text`.

## Tipos (`type`) da mensagem persistida

União discriminada. **Etapa 1 implementa apenas `text`.**

### `text`

```ts
{
  type: 'text'
  text: string
  menu?: { key: string; label: string }[]
}
```

`menu` é extensão do ChatWeb. Clique envia o `key` como texto. Após encerrar (`0`), o último bot **não** carrega menu: composer e chips desligam até **Iniciar novo atendimento**.

### Reservados (não implementados na UI)

- `image`, `audio`, `video`, `document`, `sticker` — campos como na tabela de `OutboundPayload`.

## Eventos de transporte

- `connection` — `disconnected` \| `connecting` \| `connected` \| `error`
- `message` — mensagem normalizada (replay deve ser idempotente por `id`/`clientId`)
- `status` — `{ messageId, clientId?, status }`
- `typing` — indicador de digitação
- `ended` — atendimento encerrado nesta conversa

Implementação atual: `MockTransport`. Uma implementação SM/WhatsApp deve respeitar a mesma interface, inclusive abortar waits ao `disconnect` e ignorar eventos de época anterior.

## Pendências de alinhamento com o SM

- Nomes de campos do payload oficial do canal WhatsApp
- Mapeamento inbound/outbound vs. `direction`
- Troca de `clientId` por id do servidor quando o canal atribuir um id definitivo
- IDs de mídia / storage
- Eventos de fila, troca de fila, encerramento e pesquisa de satisfação
