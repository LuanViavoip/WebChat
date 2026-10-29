# Design system do console e do widget

Identidade ViaVoip aplicada ao console (`apps/console`) e ao widget (`apps/widget`). Os valores da marca vêm de `Site_ViaVoip/src/app/globals.css` e `Site_ViaVoip/docs/DESIGN_SYSTEM.md`. CSS puro com custom properties, sem Tailwind e sem fontes externas em tempo de execução.

## Tokens (`apps/console/src/ui/tokens.css`)

| Token | Valor | Uso |
|---|---|---|
| `--color-primary` / `--color-primary-hover` | `#3740b0` / `#2c3490` | botões, foco, item ativo |
| `--color-navy` / `--color-navy-deep` | `#112349` / `#101f41` | sidebar, cabeçalho do widget, login |
| `--color-accent` | `#08e4e7` | somente sobre navy (foco e selo na sidebar); nunca como texto em fundo claro |
| `--color-on-navy` | `#c5cfe8` | texto sobre navy |
| `--color-text` / `--color-text-secondary` | `#1f2430` / `#4b5263` | títulos e corpo |
| `--color-bg` / `--color-surface` | `#f5f5f5` / `#fff` | fundo da página e cartões |
| `--color-tint` / `--color-tint-strong` | `#eff1fb` / `#e2e6f6` | seleção, ícones, balão do agente |
| `--color-border` | `#e6e6e6` | linhas e bordas |
| `--shadow-soft`, `--shadow-lift` | copiadas do site | cartões e diálogos |
| `--radius-control` | `999px` | botões e badges |
| `--radius-box` | `6px` | campos |
| `--radius-card`, `--radius-panel` | `12px`, `16px` | cartões e painéis |

Cores semânticas (success, warning, error, info, neutral) **não existem no site**: são variantes derivadas, em três formas (texto, fundo e borda), com contraste AA, no estilo de pill com tint. Estão marcadas como "derivadas" em `tokens.css`.

Outros tokens: espaçamento em escala de 4px (`--space-1` a `--space-10`), alturas de controle 36/44/48, camadas (`--z-topbar`, `--z-sidebar`, `--z-drawer`, `--z-modal`, `--z-toast`), transição de 150 ms, anel de foco de 3px índigo (`--focus-ring`). Breakpoints 640, 960 e 1280 ficam documentados em comentário, porque custom properties não valem em `@media`.

Tipografia: Montserrat 600/700 nos títulos e Open Sans 400/600 no corpo, servidas localmente por `@fontsource/montserrat` e `@fontsource/open-sans` (subconjunto latin). O widget usa as mesmas famílias só se já estiverem instaladas no visitante, com fallback para fontes do sistema, sem requisições externas.

## Arquivos de estilo

- `ui/tokens.css`: tokens.
- `ui/base.css`: reset mínimo, tipografia, foco, `[hidden]`, `.sr-only`, redução de movimento.
- `ui/ui.css`: componentes e o shell (sidebar, topbar, diálogos, toasts, tabelas).
- `ui/panels.css`: layout das telas de gestão (`.page`, `.stat-grid`, `.toolbar`, `.form-grid`, `.admin`, `.card-grid`, `.chat`).
- `desk/desk.css`: Central do Agente. `auth/login.css`: login.

## Componentes (`apps/console/src/ui/`)

| Componente | Arquivo | Observações |
|---|---|---|
| `AppShell`, `Sidebar`, `Topbar`, `PageHeader` | `AppShell.tsx`, `Sidebar.tsx`, `Topbar.tsx`, `PageHeader.tsx` | A sidebar recebe grupos montados de `sectionsFor()`; recolhe para ícones (estado em `localStorage`) e vira gaveta em até 960px. A navegação fica em `nav[aria-label="Central"]`. |
| `Button` | `Button.tsx` | `primary`, `secondary`, `ghost`, `danger`; tamanhos `sm`, `md`, `lg`; botão só com ícone exige `aria-label`. |
| `Field`, `Input`, `Select`, `Textarea` | `Field.tsx` | `Field` envolve o controle em `<label>`, com dica e erro. |
| `Card`, `StatCard`, `StatusBadge`, `Avatar` | `Card.tsx`, `StatusBadge.tsx`, `Avatar.tsx` | `StatCard` renderiza `article` com `strong`; a descrição vai só em `title`. |
| `Modal`, `Drawer`, `ConfirmDialog` | `Dialog.tsx` | `<dialog>` nativo aberto com `showModal()`: o navegador prende o foco e fecha com Esc. O conteúdo só existe enquanto aberto. |
| `Tabs` | `Tabs.tsx` | Teclas de seta, Home e End; variante lateral em telas largas. |
| `DataTable` | `DataTable.tsx` | `<table>` semântica; linhas com `role="row"` explícito; rolagem horizontal só dentro do cartão. |
| `EmptyState`, `LoadingState`, `ErrorState` | `states.tsx` | |
| `ToastProvider`, `useToast` | `Toast.tsx` | Substitui as linhas de aviso; cada toast leva `data-testid="notice"`. |
| `Composer`, `MessageBubble` | `Composer.tsx`, `MessageBubble.tsx` | Compartilhados pela central e pelo chat interno. Enter envia, Shift+Enter quebra a linha. |
| `useNow`, `useHashRoute`, `useElementWidth`, `useStoredFlag` | `hooks.ts`, `route.ts` | Rotas por hash (`#/atendimentos`). |

## Padrões de uso

- **Conectividade x presença.** O chip do topo (`ConnectionChip`) mostra só o estado do socket. A presença do agente é um controle próprio (Disponível, Ocupado, Ausente, Offline); sem conexão ela aparece como "—" e o valor guardado não é sobrescrito.
- **Layout responsivo da central.** Medido pela largura da área de conteúdo: 960px ou mais, três colunas; de 680 a 959px, lista e conversa com detalhes em `Drawer`; abaixo disso, lista e conversa em telas separadas com botão voltar. `height: 100dvh` mantém o compositor visível com o teclado virtual.
- **Comandos da empresa.** `useCompanyCommand` reaproveita o `requestId` ao reenviar o mesmo conteúdo depois de falha de rede ou timeout; descarta o id após sucesso, recusa do servidor, mudança do conteúdo ou fechamento do formulário; desabilita o envio enquanto houver pendência.
- **Ações destrutivas** (suspender, revogar sessões, retirar classificação ou SLA, pausar site, arquivar, encerrar e devolver à fila) passam por `ConfirmDialog` ou por um formulário com motivo.
- **Seletores de teste.** `data-testid` (`login-*`, `presence`, `connection`, `conversation`, `message`, `claim`, `composer`, `notice`, `close`, `supervisor-metrics`, `queue-name`, `queue-create`, `command-result`) e os rótulos do menu são contrato com `scripts/verify-browser.mjs`.

## Widget (`apps/widget/src`)

- Cabeçalho navy, botões índigo, `--brand` vindo das configurações do site (cor definida no console), foco de 3px.
- Painel com `overflow: hidden`, lista de mensagens com rolagem, compositor fixo no rodapé, pesquisa com rolagem e `env(safe-area-inset-*)`.
- Geometria do iframe em `frame-geometry.ts` (função pura, testada): botão 88x88 com 8px de folga para sombra e foco; painel `min(400, largura-32) x min(640, altura-32)` com margem de 16px; até 640px, tela cheia (`100vw x 100dvh`).
