# Diário do Codex — Chat Interno v1

## Onda 0a — grupos N:N

- Base original: `2e8961a`; rebase sobre a 0c em `02e4ead`. A versão gerada é `1.0.2`.
- O porte usa `origin`: grupos personalizados têm dono; grupos de ilha recebem membros do diretório e recusam edição manual. A sincronização cobre agentes e supervisores.
- A criação é idempotente por `clientId`; remoção e saída mantêm acesso somente de leitura às mensagens do período de participação. O mock armazena os intervalos ocultos e migra o estado de v5 para v6.
- Uma ilha migrada sem grupo automático passa a tê-lo na primeira alteração de membros.
- A interface permite criar, editar, sair e consultar membros, filtrar grupos e identificar autores. O seletor de ilha pré-seleciona integrantes, mas cria grupo personalizado.
- Em relação à Etapa 6 original, o porte usa ilhas N:N, não atribui dono a grupos automáticos e inclui saída explícita, sincronização de supervisores e migração v5 para v6.
- Baseline anterior à 0c: 914 testes de domínio e 550 do aplicativo; Playwright registrado: 161 aprovados e 99 pulados. Após o porte, Playwright: 165 aprovados e 103 pulados; o baseline de testes da 0c acrescenta testes de versão.
- `MediaBody.tsx` e a expectativa de `e2e/conversations.spec.ts` foram alterados mediante autorização explícita: o primeiro restringe o tipo de mídia diante de mensagens de sistema; a segunda inclui os novos grupos na seed.
- A inclusão de `scripts/bump-version.test.ts` no `tsconfig.json` do aplicativo foi autorizada para corrigir o lint preexistente da 0c.
- A suíte do servidor não foi executada: servidor e Docker estão fora do escopo desta onda.
- Para a 0b: não há implementação de atividade, identificadores de mensagem da v1 ou novos contratos nesta onda. A 0b depende da integração da 0a à `main`.

## Onda 0b (`feat/v1-0b-contratos`, base `7a0ed91`)

### Entregues nesta onda
- **Domínio (`packages/internal-domain/src`):** identificadores da v1 (`ids.ts`), tipos v1 (`message.ts`, `receipts.ts`, `presence.ts`, `prefs.ts`, `poll.ts`, `schedule.ts`, `quickReply.ts`, `announcement.ts`, `audience.ts`, `announcementReceipt.ts`, `day.ts`, `messageOps.ts`, `reaction.ts`), `MEDIA_RULES` com `audio/webm`, `audio/ogg;codecs=opus` e `video/webm`, novas ações `announcement.*` em `permissions.ts`, e funções puras pequenas testadas em tabela (`parseEmoji`, `toggleReaction`, `canEdit`, `canDeleteForEveryone`, `tombstone`, `validatePoll`, `validateSchedule`, `nextReceipt`, `becameAvailable`, `announcementPrompt`, `canForwardAnnouncementTo`, além de `localDateIn` e `isFirstLoginOfDay`).
- **Migração mecânica:** `MessageBase.id: MessageId` e `clientId?: ClientId` (`69cca2a`, 25 arquivos), e `setTyping`/`typing` → `setActivity`/`activity` (`ComposeActivity`, `d4c435a`, 21 arquivos). Zero ocorrências residuais em `apps/internal/src` e `packages/internal-domain/src`.
- **Transporte, sessão e suíte de contrato (`apps/internal/src`):** contratos em `transport/contract/*.ts` reexportados por `ChatTransport.ts`, `NotImplementedError` em `transport/errors.ts` e `MockTransport` para operações da Onda 1a/1b, `Bootstrap` v1 no `MockServer` (`serverNow`, `firstLoginOfDay`, `presence` inicial), `contract.suite.ts` com 32 `it.todo` das novas invariantes/operações, `ChatSession` com assinaturas `ActionResult` e estado da v1, e `ScriptedTransport` programável.
- **Seams e configuração congelada:** `shell/slots.ts`, `shell/registry.ts`, integração de slots no `ChatPanel`, `Sidebar`, `MessageList` e `MessageBubble` (fallback `"Aviso encaminhado"`), `debug/index.ts` (stub identidade/no-op), `media/recorder.ts` (`RecorderPort` e `FakeRecorder`), `ui/pickers/ConversationPicker.tsx`, `devParams.ts` (`?agora=`), `main.tsx`, `App.tsx`, `playwright.config.ts` (flags de mídia falsa), `e2e/project.ts` (`setClock`), regra ESLint anti-`dangerouslySetInnerHTML`, 28 tokens claros da v1 em `styles/chat.css` com `contrast.ts`/`contrast.test.ts` e cópia fiel da spec em `docs/chat-interno-v1/spec.md`.
- **Versão gerada:** `1.0.3` (`apps/internal/src/version.ts` e `apps/internal/RELEASE_NOTES.md`).

### Arquivos congelados para a Onda 1 (Maestro)
- `packages/internal-domain/src/index.ts`
- `apps/internal/src/transport/ChatTransport.ts` e `apps/internal/src/transport/contract/*.ts`
- `apps/internal/src/shell/slots.ts`
- Assinatura pública de `apps/internal/src/debug/index.ts` (`readDebugFlags`, `wrapTransportForDebug`, `debugAction`) e stubs de assinatura de `apps/internal/src/media/recorder.ts`
- `apps/internal/src/ui/pickers/ConversationPicker.tsx`
- `apps/internal/src/devParams.ts`, `apps/internal/src/main.tsx`, `apps/internal/src/App.tsx`
- `apps/internal/playwright.config.ts` e `apps/internal/e2e/project.ts`
- `apps/internal/eslint.config.js`
- `packages/internal-domain/package.json`, `apps/internal/package.json`, `pnpm-lock.yaml`, `apps/internal/vite.config.ts`
- Bloco de tokens da v1 em `:root` de `apps/internal/src/styles/chat.css`

### Desvios da spec e motivos
1. `leaveGroup` mantém retorno `Promise<GroupConversation>` (em `ChatTransport.ts`, e `Promise<ActionResult<GroupConversation>>` em `ChatSession.ts`) em vez de `Promise<void>` indicado em B.4 da `spec.md`, preservando o contrato consolidado na Onda 0a para ex-membro somente leitura.
2. `MessageBase.timestamp` e `MarkReadRequest.upToMessageId` foram mantidos como `string` (e `UploadRequest` aceita `target?: UploadTarget` além de `conversationId?: ConversationId`) para manter compatibilidade com os testes da Onda 0a e preservar a migração de IDs dentro do limite de ~40 arquivos (`25` arquivos em `69cca2a`).
3. Não houve alteração de `PERSIST_VERSION = 6` nem criação de migrations nesta onda; novos campos persistidos entram nas Ondas 1a (`v7`) e 1b (`v8`).
4. `apps/server` não foi alterado nem executado nesta máquina (sem Docker).

### Contagens finais verificadas
- **Antes (após 0a + 0c, base `7a0ed91`):** domínio `923` testes (`14` arquivos); app Vitest `579` testes (`48` arquivos); Playwright `165` aprovados / `103` pulados (`268` no total).
- **Depois (Onda 0b):** domínio `1023` testes (`23` arquivos); app Vitest `663` aprovados e `32` `it.todo` (`57` arquivos, incluindo `32` `it.todo` em `contract.suite.ts`); Playwright `165` aprovados / `103` pulados (`268` nos 4 projects).
