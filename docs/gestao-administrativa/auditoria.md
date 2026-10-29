# Auditoria

Código de referência: `02f5373`. Fontes: `apps/server/src/modules/audit-query.ts`, `packages/protocol/src/company.ts`, migration `009`. Na Fase 4 a tabela `audit_events` era só escrita; a consulta é nova na Fase 5 e **exclusiva do administrador**.

## Rota

`GET /audit/events` com os parâmetros opcionais `from`, `to`, `action` e `cursor`.

| Parâmetro | Regra |
|---|---|
| `from` / `to` | Instantes ISO 8601; devem vir juntos; `from` menor que `to`; janela de no máximo 31 dias. Sem os dois, a consulta cobre as últimas 24 horas |
| `action` | Uma das ações conhecidas |
| `cursor` | Valor `nextCursor` da página anterior |

Parâmetros fora dessas regras resultam em `invalid_payload`.

## Resposta

`{ entries, nextCursor }`. Cada entrada traz `id`, `at`, `actorId`, `actorName`, `action` e `resource` (tipo e, quando existe, identificador). A ordem é do mais recente para o mais antigo, desempatada por `id`.

- **Paginação por cursor** (base64url de `instante|id`), sem `OFFSET`. O serviço lê `pageSize + 1` linhas para saber se há próxima página.
- **Tamanho da página: 50.** O contrato Zod aceita até 100 entradas por resposta, mas o serviço usa 50.
- Ação desconhecida (gravada por versão futura ou anterior) aparece como `{ kind: 'unrecognized', raw }`, sem quebrar a leitura.

## Ações conhecidas

- Fase 4: `conversation.watch`, `sector.save`, `sector.member_added`, `sector.member_removed`, `announcement.publish`, `announcement.update`, `announcement.archive`, `activity.type_save`, `activity.assign`, `activity.finish`.
- Fase 5 (um registro por comando de gestão aplicado): `agent.create`, `agent.suspend`, `agent.reactivate`, `agent.role_change`, `agent.queues_replace`, `agent.activity_authority`, `agent.credential_reset`, `agent.sessions_revoke`, `queue.create`, `queue.rename`, `disposition.create`, `disposition.rename`, `disposition.retire`, `survey.publish`, `company.rename`, `company.concurrency_limit`, `company.time_zone`, `site.create`, `site.appearance_replace`, `site.acceptance_set`, `site.origins_replace`, `site.service_windows_replace`, `sla.publish`, `sla.retire`.

## Garantias e limites

- A auditoria do comando é gravada na mesma transação do efeito.
- A migration 009 faz `REVOKE UPDATE, DELETE ON audit_events FROM webchat_app`: o servidor não altera nem apaga registros.
- A resposta não traz metadados do evento, apenas ator, ação e recurso.
- Não há retenção nem expurgo definidos.
