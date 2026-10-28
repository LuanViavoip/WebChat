# Configuração por empresa

Código de referência: `02f5373`. Fontes: `packages/protocol/src/company.ts`, `apps/server/src/modules/company-commands.ts`, migration `009_company_admin.sql`. Exclusivo do administrador (ver [Papéis e permissões](papeis-e-permissoes.md)).

## Leitura

`GET /company/desk` devolve o painel da empresa: perfil (nome, `slug`, fuso, limite de concorrência), sites, filas, classificações, pesquisa, pessoas e políticas de SLA. Limites do contrato: até 20 sites, 50 filas, 50 classificações, 500 pessoas e 200 políticas.

## Fuso da empresa

- Coluna `tenants.time_zone`, padrão `America/Sao_Paulo`, entre 1 e 64 caracteres.
- Comando `company.time_zone`: o protocolo valida o nome com `Intl.DateTimeFormat`; fuso desconhecido é recusado. O banco valida de novo no trigger `tenants_time_zone`.
- As janelas de atendimento dos sites são interpretadas neste fuso.

## Sites nascem pausados e sem origens

`site.create` insere o site com `acceptance = 'paused'`, `allowed_origins = {}` e motivo "Aguardando origens permitidas". Um site só passa a aceitar conversas depois que o administrador:

1. define as origens com `site.origins_replace` (até 20 URLs);
2. muda a aceitação com `site.acceptance_set` para `accepting`.

Regras que o servidor e o banco impõem:

- Site `accepting` sem nenhuma origem é recusado (`invalid_state`, "Site sem origens permitidas") e também pelo trigger `sites_origins_when_accepting`.
- Aceitação `paused` exige motivo de 1 a 200 caracteres; `accepting` não tem motivo (`sites_pause_reason_pair`).
- A coluna antiga `accepting_chats` continua existindo e é mantida sincronizada com `acceptance` pelo trigger `sites_acceptance_sync`.
- Esvaziar as origens de um site que está aceitando é recusado; pause o site antes.

## Janelas de atendimento

`site.service_windows_replace` troca o calendário inteiro do site. O calendário é `always_open` (sem linhas) ou `weekly` com 1 a 21 janelas: dia da semana 1–7, minuto inicial 0–1439, minuto final 1–1440 e final maior que inicial. O banco recusa janelas sobrepostas no mesmo dia (`site_service_windows`, trigger `site_service_windows_scope`). A aceitação efetiva do painel pode ser `accepting`, `paused` ou `outside_service_window`.

## Demais comandos de configuração

| Comando | Efeito |
|---|---|
| `company.rename` | Nome da empresa, 1 a 120 caracteres |
| `company.concurrency_limit` | Limite de atendimentos simultâneos por agente, 1 a 100 |
| `site.create` / `site.appearance_replace` | Identificador público, nome, cor `#RRGGBB`, logotipo `https`, mensagem de boas-vindas (até 300) e exigência de nome do visitante |
| `queue.create` / `queue.rename` | Filas; nome único por empresa |
| `disposition.create` / `rename` / `retire` | Classificações de encerramento; aposentar não apaga |
| `survey.publish` | Publica a pesquisa: pergunta (até 300) e escala 1 a 5; só uma pesquisa ativa por empresa |
| `agent.*` | Gestão de pessoas, ver [Revogação de sessão](revogacao-de-sessao.md) |
| `sla.publish` / `sla.retire` | Ver [Política de SLA](../qualidade-operacional/politica-de-sla.md) |

Todo comando é idempotente por `requestId` ([Comandos idempotentes](comandos-idempotentes.md)) e grava auditoria ([Auditoria](auditoria.md)).
