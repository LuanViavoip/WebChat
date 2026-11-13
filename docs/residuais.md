# Residuais

Itens **propositadamente não implementados** (Etapa 1 / 1.1 / 1.2 / 1.3 / 2):

- Sticker (envio e render) e gravação de áudio (mic continua “em breve”)
- Integração real com o SM / canal WhatsApp (hoje só `MockTransport`)
- Mapear `clientId` → id definitivo do servidor quando o canal WhatsApp existir
- Chat interno de agentes e supervisores
- Grupos, pastas, transferência, fila, troca de fila
- Encerramento com pesquisa de satisfação (NPS/CSAT) de ponta a ponta — o mock só encerra com a opção `0`
- Autenticação do paciente, SSO, vínculo com prontuário
- Persistência / histórico entre reloads (reconectar hoje recomeça a conversa; o histórico das outras conversas é mock só de front)
- Internacionalização além de pt-BR
- Biblioteca de emojis completa (seletor curto próprio, agora com setas de listbox)
- PWA, push, notificações nativas
- Widget SDK publicável (npm) — o modo widget continua `?modo=widget`
- Busca na conversa, menu ⋮, comunidades, status e nova conversa da coluna esquerda (ícones visíveis, desabilitados, tooltip “em breve”)
- Microfone / gravação real (MediaRecorder); o mic continua desabilitado e vira enviar ao digitar texto
- Lista de conversas ligada ao SM — no canal do cliente a coluna esquerda é mock (sessão ao vivo + dois históricos simulados)
- Rebrand do **nome** ICS → ViaVoip (esta etapa só aplica o visual; wordmark CSS “ViaVoip”, textos de negócio ICS permanecem)
- Tema escuro — os tokens `[data-theme='dark']` da etapa 1.2 foram retirados do CSS (não estavam ligados). Ficam como residual até haver um interruptor real
- Assets oficiais da ViaVoip ou do WhatsApp (wordmark em texto + Lucide; sem copiar logotipos)

## Etapa 1.3 — rodada 5 do PR #5

- **N13** — o baseline de “não vista” no reload (N11) assume que as boas-vindas chegam **antes** do status `connected`, como o `MockTransport` faz. O contrato não garante essa ordem. Um transporte real que emita `connected` e só depois a primeira mensagem ainda pode marcar essa mensagem como “Nova mensagem” no reload sobre o histórico.
- **N14** — coberto por teste unitário (`depois do reload no histórico, mensagem nova fica não vista`): depois do baseline, uma mensagem real que chega com o histórico aberto vira “Nova mensagem”.
- Validação manual com leitor de tela (NVDA/VoiceOver) no badge de atividade, no anúncio `aria-live` e no aviso de demonstração — o CI só tem axe + Testing Library.

## Etapa 1.3 — rodada 4 do PR #5

Correções: região `aria-live` permanente (só erro / reconexão / nova mensagem, e só com o histórico aberto); mensagens do carregamento inicial não contam como não vistas; `hadConnected` saiu do render.

## Etapa 1.3 — rodada 3 do PR #5

Correções: foco mobile no item de origem, mensagem não vista no histórico, item ao vivo pinado na busca, contraste com banner real, Conectando vs Reconectando, anúncio aria-live da atividade, e o workflow Playwright por digest.

O que **não** entrou (opcionais não triviais ou já cobertos em outro lugar):

- N6 — o teste unitário das caudas continua checando a classe `has-tail`; a cor da `::after` já é medida no e2e `conversations.spec.ts`. jsdom não resolve o cascade do `chat.css` para `getComputedStyle` da cauda
- Pixel-perfect do indicador de nova mensagem no botão Voltar (ponto lima) além do anúncio e do banner no painel

## Etapa 1.3 — revisão Codex do PR #5

Correções desta passagem (histórico fictício identificado, rascunho, history.state, atividade na lista, foco mobile, caudas e contraste computado). O que **não** entrou:

- Histórico real do SM — os itens continuam mock de front, agora com rótulo explícito de demonstração
- Persistência do rascunho entre reloads (só sobrevive à troca de conversa na mesma sessão)
- Leitor de tela real (NVDA/VoiceOver) no badge de atividade e no aviso de demonstração

## Etapa 1.3 — o que ficou de fora

- Pixel-perfect do site institucional ViaVoip (tokens e direção visual sóbria, não landing page)
- Dark mode aplicável pelo usuário
- Histórico persistido / vindo do SM (hoje transcrições estáticas em `conversations.ts`)
- Contagens reais de não lidas (o filtro permanece coerente, sem badges inventados)
- Emoji picker completo / stickers / GIF
- Reações, encaminhar, responder, estrela, info da mensagem
- Layout de três painéis (contato / conversa / perfil)
- Rascunhos por conversa além da sessão ao vivo (hoje só o composer do canal ao vivo persiste ao trocar de item)
- NVDA/VoiceOver reais no aviso de demonstração e nos badges de atividade da lista — o ambiente de CI só tem axe + Testing Library
- `getComputedStyle` no Vitest/jsdom não resolve o cascade do `chat.css` (devolve `canvastext`); o contraste computado de erro/foco/ativo roda no Playwright (`e2e/contrast.spec.ts`)

## Ressalvas da revisão a4a6b60

Parecer do Codex no head `a4a6b60`: **aprovado com ressalvas** para a Etapa 2 (sem P0/P1). Registrado a pedido do Luan. Sem correção de código nesta passagem. A Etapa 1.3 não altera `ChatSession` / transporte / contrato.

1. **P2 (integração real) — mesclar pendência quando um evento de status associa os IDs.** Com mensagem otimista já presente por `clientId`, um `read` antecipado pelo id do servidor e depois um evento que associa os dois, `ChatSession.ts` (~199, `apply` de `status`) atualiza a mensagem mas não consome a pendência antiga; o status visível pode ficar em `sent`. Falta teste: otimista existente + associação só no evento de status.

2. **P2 (integração real) — limitar o índice de aliases** (`idAlias.ts` ~19). Hoje só limpa em novo atendimento (`start`). Na integração com eventos reais, definir política de descarte/limite para o índice não crescer sem teto.

3. **P3 (etapa 2) — testes de retry. Resolvido na Etapa 2:** o `MockTransport` aceita mídia simulada (`upload` + eco); `retry` depois de falha de upload reenvia o mesmo `File`/`clientId`; `retry` depois de falha de `send` reusa a URL remota; rejeição tardia de `retry` após `stop` é ignorada.

4. **P3 (manual) — leitor de tela real (NVDA/VoiceOver).** Pendência da Etapa 1.2: não há NVDA/VoiceOver neste ambiente. O `role="log"` permanece sempre ativo; o teste de resposta após falha de envio cobre só a estrutura (mensagem no log vivo), não o anúncio único. Erros usam `role="alert"` no banner, sem desligar o log. Encerrado não usa `status`/`alert`. Confirmar no dispositivo do Luan se o leitor anuncia cada mensagem uma vez ou se log + alerta se repetem. Vale também para progressbar de upload, alerta de falha de mídia e o dialog do visualizador.

## Etapa 2 — residuais de mídia

- **R1** Storage real do SM desconhecido (URL vs media id, expiração). `upload()` isolado no transporte.
- **R2** Limites/formatos reais do SM podem divergir da Cloud API. Fonte única: `MEDIA_RULES`.
- **R3** Sem magic bytes / antivírus no cliente; OGG precisa ser Opus e vídeo H.264/AAC no servidor.
- **R4** Object URLs e memória com arquivos grandes (documento até 100 MB) — dono único por URL, mas heap não foi medido.
- **R5** Gravação de áudio (mic).
- **R6** Upload real sem progresso fino.
- **R7** Leitor de tela real (NVDA/VoiceOver) em progressbar, alerta e dialog.
- **R8** jsdom sem `showModal`/`createObjectURL` (polyfill + `fakeObjectUrls`); `color-mix` em navegadores antigos.
- **R9** Legenda em documento (Cloud API aceita; contrato desta etapa não).
- **R10** Vários arquivos por envio, colar do clipboard, câmera, compressão, miniatura de vídeo.
- **R11** Sticker.
- **R12** Mídia recebida com URL externa / `download` cross-origin / CSP.
- **R13** Bot do mock não responde a mídia.
- **R14** Viewer no widget cobre a página hospedeira (é modal).
- **R15** Índice de aliases e pendências P2 de integração real.
- **N2** Mídia recebida em `image/webp`, `image/gif` ou com MIME em maiúsculas (`IMAGE/PNG`) baixa sem extensão. `extensionForMime` só casa o MIME minúsculo das regras desta etapa (JPG/PNG/MP4…); webp/gif não entram no envio e o download de recebidos cai no fallback `foto`. Não entra nesta correção.
- **N7** No widget, soltar um arquivo sobre o launcher (`.widget-fab`) abre o arquivo no navegador: o `preventDefault` de drop fica na superfície `.wa-shell`, e o botão de abrir o chat fica fora dela.
- **N8** Ao encerrar, a bolha do upload em andamento some sem avisar que a foto não foi enviada. O abort remove a mensagem otimista; não há toast nem linha no log.

## Etapa 2 — QA do PR #6 (não são bugs)

Limitações conferidas na revisão independente do head `3be32f7`. Não entram como correção.

- **Tab no visualizador:** a ordem é Fechar → Baixar → chrome do navegador → Fechar. O fundo fica `inert` porque o dialog usa `showModal`. É o comportamento nativo do Chrome e está aceitável.
- **Clique na própria foto:** clicar em (5,5) não fecha (é a barra superior). Clicar na imagem fecha, porque o stage tem `pointer-events: none`. UX menor.
- **Lista oculta com o preview aberto:** respostas do bot nesse intervalo não ficam visíveis nem são anunciadas até fechar o preview.
- **Factory injetável:** o `AttachmentPreview` não recebe a factory de `objectUrls` (`useObjectUrl` usa o default). Desvio pequeno do desenho, só afeta a costura de teste.
