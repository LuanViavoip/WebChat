# Quadro de anúncios

Tabelas: `announcements`, `announcement_sectors`, `announcement_revisions`, `announcement_reads`.

| Tema | Comportamento |
|---|---|
| Criação | `announcement.publish { title, body, pinned?, audience, sectorIds?, expiresAt? }` (título ≤160, corpo ≤4000) |
| Público-alvo | `audience = tenant` (toda a empresa) ou `sectors` (setores em `announcement_sectors`) |
| Quem publica | Agente não publica. `tenant` é exclusivo do admin. Supervisor publica só para setores que supervisiona |
| Fixação | Coluna `pinned` (a UI atual publica sempre com `pinned: false`) |
| Expiração | `expires_at`; expirados e arquivados ficam ocultos, salvo `includeArchived` (apenas supervisão) |
| Edição | `announcement.update` grava uma revisão em `announcement_revisions`; não permitido se arquivado |
| Arquivamento | `announcement.archive`, idempotente (`archived_at`) |
| Leitura | `announcement.read` grava `announcement_reads` por agente |
| Auditoria | `announcement.publish`, `.update`, `.archive` em `audit_events` |
| Eventos | `announcement.published`, `announcement.updated` — só avisam quem está conectado; o dado fica no Postgres |

Estado derivado de timestamps: arquivado, expirado ou vigente. O console oferece fixação, expiração, edição e arquivamento conforme as permissões.
