# Chat interno

Domínio separado do atendimento externo. Tabelas: `internal_conversations`, `internal_participants`, `internal_messages`, `internal_reads`. Diagrama: [sequência](../diagrams/rendered/internal-chat-sequence.svg).

## Conversas e participantes

- **`direct`**: par de usuários; unicidade por `pair_key` (ids ordenados e unidos por `:`).
- **`group`**: **uma por setor** (`sector_id`); criada automaticamente com o setor, com participantes sincronizados.
- CHECK: grupo tem `sector_id` e não tem `pair_key`; direta é o inverso.
- Saída de participante é lógica (`removed_at`); a política única de histórico é `retain_until_removed` (o removido mantém o histórico até a saída).

## Regras de conversa direta (`assertCanDirect`)

Dois agentes **não** conversam diretamente. Admin abre direta com qualquer pessoa; dois membros da supervisão podem; um agente só com um supervisor com quem compartilhe setor.

## Mensagens

`internal.message.send { conversationId, requestId, body }`: corpo 1–4000 caracteres, idempotente por `UNIQUE(conversation_id, request_id)`. Evento `internal.message.new` na sala `internal:{id}`.

## Histórico e não lidas

`internal.history` pagina por cursor (`beforeMessageId` **ou** `afterMessageId`, nunca ambos; limite padrão 50, máximo 100). `internal.message.read` grava o cursor em `internal_reads` e emite `internal.message.read`. Contadores de não lidas derivam desse cursor.

## Isolamento e limitações

Tudo passa por `withTenant`/RLS. Falhas conhecidas no commit documentado: participante removido reentra na sala ao chamar `internal.history` (F4-01); salas não acompanham mudanças de setor e admin não participante entra em grupos (F4-05); a UI não pagina e não ressincroniza ao reconectar (F4-06/F4-09).
