# Comandos idempotentes

Código de referência: `02f5373`. Fontes: `apps/server/src/modules/company-receipt.ts`, `packages/protocol/src/company.ts`, migrations `009` e `010`.

## Envelope

`POST /company/commands` recebe `{ requestId, command }`, onde `requestId` é um UUID gerado pelo cliente e `command` é um dos comandos discriminados por `kind` (por exemplo `agent.suspend`, `site.origins_replace`, `sla.publish`). O corpo é estrito: campos extras são recusados. A resposta traz o painel atualizado (`desk`) e o recibo `{ requestId, replayed, appliedAt }`.

## Como funciona

Cada comando roda em uma transação do tenant (`withTenant`) e passa por `withCommandReceipt`:

1. Adquire um lock consultivo de transação por `tenantId:actorId:requestId`. Se outro processo já o detém, a resposta é `conflict` ("Comando em andamento").
2. Apaga os recibos expirados do mesmo ator.
3. Procura um recibo para `(tenant, ator, requestId)`.
   - **Existe e o conteúdo é o mesmo** (hash SHA-256 do JSON canônico do comando): devolve `replayed: true` com o `appliedAt` original, sem reaplicar.
   - **Existe com outro conteúdo**: `conflict` ("Comando já usado com outro conteúdo").
   - **Existe sem ter sido aplicado**: `conflict` ("Comando em andamento").
4. Não existe: grava o recibo `in_flight`, executa o comando, marca `applied` e devolve `replayed: false`.

Como recibo e efeito estão na mesma transação, uma falha desfaz os dois e o cliente pode repetir o mesmo `requestId`.

## Retenção

O recibo vive **24 horas** (`expires_at`, coluna da migration 010, padrão `now() + 24 h`). Depois disso o mesmo `requestId` é tratado como comando novo. A limpeza é feita na própria chamada do mesmo ator, não por rotina agendada. A migration 010 concede `DELETE` na tabela ao papel `webchat_app` e cria o índice `company_command_receipts_expiry`.

## Tabela `company_command_receipts`

Chave primária `(tenant_id, actor_id, request_id)`, `command_kind`, `payload_hash` (64 hexadecimais), `status` (`in_flight` ou `applied`), `applied_at`, `created_at`, `expires_at`. RLS forçada por tenant e trigger que recusa ator de outra empresa.

## Revogação junto do comando

Comandos que mudam o acesso de uma pessoa devolvem à rota a lista de sessões removidas, e a rota desconecta os sockets correspondentes depois do commit ([Revogação de sessão](revogacao-de-sessao.md)). O `replayed: true` não repete esse efeito.
