# Setores

## Entidade

`sectors` (nome único por tenant, descrição ≤ 500, `active`). Membros em `sector_members` e supervisores em `sector_supervisors`, ambos com remoção lógica (`removed_at`). O trigger `enforce_sector_supervisor` exige papel `supervisor` ou `admin` para supervisionar.

## Operações

`sector.list`, `sector.save` (cria/atualiza e substitui supervisores), `sector.member.add`, `sector.member.remove`. Criar um setor cria sua conversa de grupo no chat interno. Todas as mutações gravam `audit_events` (`sector.save`, `sector.member_added`, `sector.member_removed`).

## Permissões

- **admin**: gere qualquer setor.
- **supervisor**: gere apenas setores em que é supervisor ativo.
- **agente**: lista, sem gestão.

## Relação com filas

A relação `sector_queues` vincula setores e filas para limitar o escopo dos supervisores. O seed de demonstração popula vínculos; ambientes existentes precisam configurá-los adequadamente.

## UI

O console permite criar e editar setores, responsáveis e membros.
