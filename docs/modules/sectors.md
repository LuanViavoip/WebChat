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

A tabela `sector_queues` existe (com RLS, trigger e grants), mas **no commit documentado nenhum código a lê ou escreve e o seed não a popula**. Portanto a relação setor ↔ fila é uma **lacuna**: o escopo do supervisor por fila (F4-02) não pode se apoiar nela ainda.

## UI

O console cria setor e edita membros; não edita setor nem supervisores (F4-06).
