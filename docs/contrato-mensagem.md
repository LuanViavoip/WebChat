# Contrato da mensagem normalizada (rascunho)

Este documento descreve o formato **interno** do ChatWeb. Ainda não há acesso ao repositório do SM; o alinhamento com o payload do canal WhatsApp do SM virá numa etapa posterior.

## Identidade

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | string | Identificador estável da mensagem no canal. |
| `conversationId` | string | Conversa / ticket. No mock: `conv-web`. |
| `direction` | `client` \| `agent` \| `bot` \| `sistema` no produto; no código: `client` \| `agent` \| `bot` \| `system` | Quem originou. No cliente web, `client` alinha à direita. |
| `author` | `{ id, name }` | Exibição. Bot de pré-atendimento: `ICS Pré-atendimento`. |
| `timestamp` | string ISO-8601 | Relógio do emissor. |
| `status` | `sending` \| `sent` \| `delivered` \| `read` \| `error` | Espelha ticks estilo WhatsApp. Só faz sentido em mensagens `client` nesta etapa. |
| `type` | união discriminada | Ver abaixo. |

## Tipos (`type`)

União discriminada. **Etapa 1 implementa apenas `text`.** Os demais existem no tipo para não quebrar o contrato quando a Etapa 2 (mídia) chegar.

### `text`

```ts
{
  type: 'text'
  text: string
  menu?: { key: string; label: string }[]
}
```

`menu` é uma extensão do ChatWeb (“WhatsApp turbinado”): o simulador do SM já mostra opções clicáveis. No canal WhatsApp real o usuário digitaria o número; o clique envia o `key` (`"1"`, `"0"`, …) como texto.

### Reservados (não implementados)

- `image`: `caption?`, `mimeType`, `url`
- `audio`: `mimeType`, `url`, `durationMs?`
- `video`: `caption?`, `mimeType`, `url`
- `document`: `fileName`, `mimeType`, `url`
- `sticker`: `mimeType`, `url`

## Eventos de transporte

A UI não fala com HTTP/WebSocket direto. Consome `ChatTransport`:

- `connection` — `disconnected` \| `connecting` \| `connected` \| `error`
- `message` — mensagem normalizada
- `status` — atualização de `messageId`
- `typing` — indicador de digitação

Implementação atual: `MockTransport`. Uma implementação SM/WhatsApp deve respeitar a mesma interface.

## Pendências de alinhamento com o SM

- Nomes de campos do payload oficial do canal WhatsApp
- Mapeamento inbound/outbound vs. `direction`
- IDs de mídia / storage
- Eventos de fila, troca de fila, encerramento e pesquisa de satisfação
