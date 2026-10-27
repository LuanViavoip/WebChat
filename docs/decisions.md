# Decisões

## Sessão opaca em vez de JWT com tenant

O token é aleatório e só o hash fica no banco. O tenant é lido da linha da sessão. Um cliente não consegue reescrever o tenant de um token.

## RLS além do filtro na query

As queries recebem o tenant do principal autenticado. O RLS impede que uma query esquecida vaze outro tenant. As funções de bootstrap (`lookup_site_by_public_id`, `lookup_agent_by_email`, `lookup_auth_session`, `lookup_visitor_session`) são `SECURITY DEFINER` porque ainda não existe tenant no momento da leitura.

## Claim no Postgres

O Redis não decide quem assumiu a conversa. Duas instâncias disputam a mesma linha e o `UPDATE ... WHERE status = 'queued' AND agent_id IS NULL` elege um vencedor.

## Ack depois do commit

`withTenant` só retorna depois do `COMMIT`. O handler emite o evento e só então responde o ack. A queda entre o commit e o ack se recupera no `history.sync`, e o `requestId` impede uma segunda gravação.

## Encerramento em dois passos

Classificar muda o status para `awaiting_survey` e abre a pesquisa. A resposta do visitante muda para `closed`. O mock do SM é notificado na classificação, que é o fim operacional do atendimento. A pesquisa permanece interna até existir contrato.

## Transferência só para fila

A fase 1 devolve a conversa para outra fila do mesmo tenant e remove o agente. Transferência direta para outro agente fica fora. Na fase 3 o agente só escolhe uma fila em que já está escalado. O supervisor continua podendo mover para qualquer fila do próprio tenant.

## Senha local

Não há IdP do SM. Agentes de demonstração usam argon2id. A coluna `password_hash` não é legível pelo papel da aplicação; o login passa pela função definidora.

## Presença no servidor

O status efetivo sai das conexões autenticadas, do heartbeat e da escolha do agente. `offline` só acontece quando não resta conexão fresca. Várias abas compartilham o mesmo agente. O limite simultâneo fica em `tenants.max_concurrent_assignments` e o claim trava a presença do agente antes do `UPDATE` condicional da conversa. Atingir o limite publica `busy` sem encerrar os atendimentos abertos.

## Chat interno separado do atendimento

Mensagens entre agentes e supervisores ficam em `internal_conversations` e `internal_messages`. O atendimento externo continua em `conversations`, com fila, visitante, classificação e pesquisa. Os dois canais dividem o socket autenticado, o `withTenant` e a idempotência por `requestId`. Um comando interno não entra na máquina `queued → assigned → awaiting_survey → closed` e não chama o adaptador do SM.

O papel `admin` enxerga o tenant inteiro. O supervisor opera nos setores em que é responsável. A conversa direta é única por par e só liga agente com supervisor do mesmo setor, agente com administrador, ou dois membros da supervisão. Agente com agente fica de fora. Quem sai do setor perde o envio e as mensagens posteriores; o histórico até `removed_at` permanece, conforme `tenants.internal_history_policy`.

Presença e atividade não se alteram mutuamente. A presença efetiva continua a fórmula das conexões e do estado desejado, agora com um intervalo por transição. A alocação ativa é uma por agente.

## Página demo em outra origem

O site de exemplo sobe na porta 8090 e o webchat na 3000. Isso exercita iframe, `postMessage` e a allowlist do site sem cookie de terceiros.
