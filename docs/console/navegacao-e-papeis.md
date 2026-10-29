# Interface do console

Código de referência: Fase 5.5. Fontes: `apps/console/src/shell/` (`nav.ts`, `roles.ts`, `Shell.tsx`, `ConnectionChip.tsx`, `PresenceControl.tsx`), `apps/console/src/ui/` e `apps/console/src/desk/layout.ts`. O console é servido em `/console/` pelo próprio servidor Webchat. O visual segue o [design system ViaVoip](../fase-5.5/DESIGN_SYSTEM.md).

## Estrutura da tela

- **Menu lateral** (`Sidebar`): fundo navy, seções agrupadas em *Atendimento*, *Gestão*, *Equipe* e *Sistema*. Pode ser recolhido para ícones (o estado fica em `localStorage`, chave `viavoip.sidebarCollapsed`) e, em telas de até 960 px, vira uma gaveta. A navegação fica em `nav[aria-label="Central"]`.
- **Barra superior** (`Topbar`): título da seção, chip de conexão, controle de presença e menu da conta.
- **Rotas por hash**: cada seção tem um endereço (`#/atendimentos`, `#/qualidade` etc.), o que permite recarregar a página ou compartilhar o endereço de uma tela.

## Navegação por papel

A lista de seções vem de uma única função, `sectionsFor(role)` (`shell/roles.ts`); a sidebar só agrupa o que ela devolve. A interface esconde o que o servidor já recusa, mas a autorização está no servidor.

| Papel | Seções (na ordem do menu) |
|---|---|
| Agente | Atendimentos, Chat interno, Setores, Anúncios, Minha atividade |
| Supervisor | Visão geral, Agentes, Qualidade, Setores, Atendimentos, Atividades, Anúncios, Chat interno |
| Administrador | Visão geral, Agentes, Administração, Qualidade, Setores, Atendimentos, Atividades, Anúncios, Chat interno |

Agrupamento na sidebar:

| Grupo | Seções |
|---|---|
| Atendimento | Atendimentos, Chat interno |
| Gestão | Visão geral, Agentes, Qualidade |
| Equipe | Setores, Atividades (ou Minha atividade), Anúncios |
| Sistema | Administração |

Slugs de URL: `visao-geral`, `agentes`, `atendimentos`, `chat-interno`, `setores`, `anuncios`, `atividades`, `administracao`, `qualidade`. Um endereço de seção que o papel não possui não abre a tela. O Chat interno mostra na sidebar o selo de mensagens não lidas, atualizado em tempo real.

## Conectividade × presença

Na Fase 5.5 as duas informações deixaram de se confundir.

| Conceito | Onde aparece | O que significa |
|---|---|---|
| **Conectividade** | Chip no topo (`ConnectionChip`) | Estado do socket com a central: conectado, reconectando ou desconectado. |
| **Presença** | Controle próprio ao lado do chip (`PresenceControl`) | Disponível, Ocupado, Ausente ou Offline, calculado no servidor. |

Regras:

- O chip mostra **só** o socket. Não diz nada sobre a presença.
- Para o agente, a presença é um seletor (Disponível, Ocupado, Ausente). Sem conexão, o seletor fica desabilitado e mostra "Presença: —"; "Offline" aparece como valor informado pelo servidor e não pode ser escolhido.
- Perder a conexão **não sobrescreve** a presença guardada, e o seletor nunca converte `offline` em `available`.
- Supervisor e administrador veem a presença como um selo somente leitura, omitido quando offline.
- Na tabela de agentes da supervisão, Presença e Conectividade são badges separados.

Ver também [Presença](../modules/presence.md).

## Layout da Central do Agente

O layout da central é escolhido pela largura da **área de conteúdo** (viewport menos a sidebar), em `deskLayout()`:

| Largura da área | Layout |
|---|---|
| 960 px ou mais | Três colunas: fila, conversa e detalhes |
| 680 a 959 px | Fila e conversa; detalhes em gaveta (`Drawer`) |
| Abaixo de 680 px | Fila e conversa em telas separadas, com botão voltar |

Detalhes da operação em [Central do Agente](../modules/agent.md).

## Acessibilidade e teclado

Foco visível em todos os controles (anel de 3 px índigo), diálogos nativos `<dialog>` com foco preso e fechamento por Esc, abas com setas, Home e End, e `prefers-reduced-motion` respeitado. O compositor de mensagens envia com Enter e quebra a linha com Shift+Enter.
