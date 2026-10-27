# Arquitetura — visão geral

Monorepo pnpm (Node ≥ 22, TypeScript estrito). Diagramas: [contexto](../diagrams/rendered/context.svg), [containers](../diagrams/rendered/containers.svg), [componentes do backend](../diagrams/rendered/backend-components.svg).

## Componentes

| Pacote | Papel | Tecnologia |
|---|---|---|
| `apps/server` | HTTP + WebSocket, regras de domínio, migrations, seed, estáticos | Fastify 5, Socket.IO 4, `pg` (sem ORM), Zod 4, argon2 |
| `apps/widget` | UI do visitante (`/widget/`) e `loader.ts` (`/widget.js`) | React 19, Vite 8, esbuild |
| `apps/console` | Central do agente e do supervisor (`/console/`) | React 19, Vite 8 |
| `packages/protocol` | Schemas Zod de HTTP, eventos, modelos, erros e postMessage | Zod |
| `packages/sm-adapter` | Interface `SMAdapter`, `MockSMAdapter`, fábrica | TypeScript |
| `infra/` | `seed/seed.sql` e página demo (nginx) | — |

## Comunicação interna × externa

São domínios separados em tabelas, módulos e eventos:

- **Externa (atendimento):** `conversations`, `messages`, `conversation_events`, `survey_*`. Participam visitante e agente; o supervisor só observa/transfere.
- **Interna (corporativa):** `internal_conversations`, `internal_participants`, `internal_messages`, `internal_reads`, mais setores, anúncios, presença e atividades. Só usuários internos.

Um visitante nunca recebe eventos `internal.*`; o isolamento é por namespace (`/visitor`, `/agent`, `/supervisor`) e por sala.

## Persistência

PostgreSQL é a fonte da verdade: claim, presença, sessões e mensagens vivem nele. **Redis não guarda estado** — é só o adapter do Socket.IO (fan-out entre instâncias) e é desligado com `REDIS_URL` vazio. O limitador de taxa é **em memória por processo** (várias instâncias não o compartilham).

## Autenticação e autorização

- Tokens **opacos** (32 bytes aleatórios, base64url); só o hash SHA-256 é gravado (`auth_sessions`, `visitor_sessions`). O tenant vem da linha da sessão, nunca do cliente.
- Senhas: argon2id; login faz verificação fictícia quando o e-mail não existe (equaliza tempo).
- Papéis: `agent`, `supervisor`, `admin`. `/agent` aceita só `agent`; `/supervisor` aceita `supervisor` e `admin`.
- Visitante: acessa apenas a própria conversa no mesmo site.
- Regras por módulo: ver [modules/](../modules/). Matriz de permissões resumida em [STATUS.md](../STATUS.md).

## Eventos

Não há barramento interno. Cada handler chama o serviço de domínio e, **após o commit**, o `realtime/hub.ts` emite para salas (`tenant:{t}:conversation:{id}`, `queue:{id}`, `agent:{id}`, `supervisors`, `internal:{id}`, `sector:{id}`). O histórico durável fica em `conversation_events` (atendimento). Eventos de tempo real **não** são transacionais: não há outbox (F4-07). Lista de eventos: [websocket.md](websocket.md).

## Adaptadores externos

`SMAdapter` é chamado após o commit, dentro de `safeNotify` (erro é logado e ignorado). Ver [integration-sm.md](integration-sm.md).

## Planejado × implantado

O repositório contém apenas `Dockerfile` e `docker-compose.yml` (ambiente local). **Não há configuração de produção verificável** (sem Terraform, Kubernetes, CI ou manifests). Ver [environments.md](../deployment/environments.md).

## Boot do servidor

`main.ts`: `createSMAdapter` → migrations (até 30 tentativas, 500 ms) com o papel de migração → seed se `SEED=true` → `buildApp` → listen. Um `setInterval` de 15 s executa `presence.sweep()`.
