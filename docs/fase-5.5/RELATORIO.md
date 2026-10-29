# Relatório final — Fase 5.5

Redesign do console, correção do widget pela causa raiz e demo do webchat dentro do site institucional. Fora do front-end, a única mudança de contrato é pequena: `GET /auth/me` passou a devolver `canChangeOwnActivity` (`apps/server/src/auth/sessions.ts` e `authMeSchema` em `packages/protocol/src/http.ts`, com testes). Não há migrations nem alterações no seed. O código está no commit `3d9e2cf`; em `Site_ViaVoip` existe só o commit baseline local, sem remote.

Data da validação: 2026-10-29. Ambiente: containers descartáveis (Postgres 16, Redis 7, nginx 1.27) e servidor local em `127.0.0.1:3000`, conforme `.cursor/skills/verify/SKILL.md`.

## 1. Escopo entregue

| Etapa | Entrega |
|---|---|
| B | Design system (`apps/console/src/ui/`), AppShell com sidebar e topbar, login, rotas por hash, separação entre conectividade e presença |
| C | Central do Agente: filas, conversa, detalhes, layout responsivo, compositor `<textarea>` |
| D | Supervisor (cartões agrupados, tabela de agentes) e Qualidade (relatório por escopo e período) |
| E | Administração com oito seções, `useCompanyCommand`, Chat interno, Setores, Anúncios e Atividades |
| F | Widget: painel nasce fechado, geometria pelo viewport do site, API `open()/close()`, novo visual |
| G | Site institucional com o widget no lugar do "Fale agora" e demo local |
| H | `verify-visual.mjs`, validação completa e documentação |

## 2. Estado antes

- Console com navegação horizontal por `useState`, CSS global sem tokens (paleta bege e verde-azulado que não é da ViaVoip), uma única tela de comando de empresa (`queue.create`) e Qualidade e Administração como stubs.
- O backend já expunha `companyDeskSchema` e cerca de 25 comandos, usados só em parte.
- O widget aparecia cortado no canto inferior direito; não havia demo dentro do site.
- Capturas do estado anterior: `artifacts/visual/antes/` (login, central, supervisão, administração e widget em 1366x768 e 390x844).

## 3. Design system e shell

Tokens da ViaVoip (índigo `#3740b0`, navy `#112349`, ciano `#08e4e7` só sobre navy, sombras do site), Montserrat e Open Sans servidas localmente, cores semânticas derivadas com contraste AA. A sidebar é montada a partir de `sectionsFor()`, que continua sendo a única matriz de permissões. Detalhes em `DESIGN_SYSTEM.md`.

Correção da confusão entre conectividade e presença: o chip do topo mostra só o socket; a presença do agente tem controle próprio, `presenceLabel('offline')` virou "Offline", a desconexão não sobrescreve a presença e o select não converte `offline` em `available`.

## 4. Central do Agente

Cartões de fila com contagem, itens com avatar, prévia da última mensagem (das mensagens já carregadas, sem endpoint novo), horário, não lidas e estado; balões diferenciados, separador de dia, `white-space: pre-wrap`, compositor com Enter e Shift+Enter, confirmações para encerrar e devolver à fila. Três layouts (três colunas, detalhes em gaveta, telas separadas) medidos pela largura da área de conteúdo. Em tela estreita, a conversa que sai da lista (encerrada ou devolvida) devolve o agente à lista.

## 5. Supervisor e Qualidade

Cartões em grupos (Presença, Fila, Operação) com ícone, cor semântica e tooltip; "Maior espera" mostra "—" quando o servidor devolve `null` (sem ninguém na fila) e "0 s" quando é zero. "Atualizado às" usa `generatedAt`. A tabela de agentes separa Presença e Conectividade em badges.

A tela de Qualidade usa só `GET /quality/report` e os campos do schema. O servidor permite ao supervisor consultar setores em que é responsável e filas sob sua supervisão (nunca a empresa); o administrador consulta qualquer escopo. O seletor de escopo reflete essa regra e o período é limitado a 31 dias no cliente.

## 6. Administração e módulos internos

Oito seções (Empresa, Usuários e Permissões, Filas, Classificações, Sites e Widgets, SLA, Pesquisa, Auditoria). Todos os formulários enviam exatamente o `companyCommandSchema` e são validados no cliente antes do envio. `useCompanyCommand` mantém o `requestId` da tentativa lógica: reaproveita ao reenviar o mesmo conteúdo após falha de rede ou timeout, descarta após sucesso, recusa do servidor, mudança do conteúdo ou fechamento do formulário, e desabilita o botão durante o envio. Ações destrutivas usam diálogo de confirmação. O agente registra a própria atividade quando o administrador concedeu a permissão: `GET /auth/me` expõe `canChangeOwnActivity` e o histórico de versões de SLA aparece na seção SLA.

"Copiar script" monta o snippet com a origem do console e o `publicId` real, sem tokens. Chat interno com selo de não lidas em tempo real na sidebar; Setores com seleção de pessoas por nome (mesmos payloads); Anúncios com cartões, fixados em destaque e formulário em modal; Atividades com atividade atual, histórico e catálogo.

## 7. Widget: causa raiz e correção

**Causa raiz.** `WidgetApp` iniciava com `panelOpen = true`. O aviso de tamanho (`resize`) para o site só saía depois de `setParentOrigin`, que acontecia no fim de `boot()`, depois de criar a sessão. Até lá, e para sempre se o boot falhasse (origem não autorizada, referrer vazio, erro de rede), o painel inteiro era desenhado dentro do iframe de 72x72 do loader, o que produzia o recorte no canto. Agravantes: o widget medindo o próprio iframe (origem do bug já corrigido em `2cdc8a5`), nenhum recálculo ao redimensionar ou girar a tela, `.panel` sem `overflow`, nenhuma área segura e anel de foco cortado pelo iframe justo.

**Correção.**

1. O painel nasce fechado quando embutido; a origem validada (`authorizedParent`) vira `parentOrigin` logo depois de buscar a configuração, antes de qualquer sessão, e é a única origem para a qual o widget posta. Sem origem válida, nada é enviado, o iframe fica do tamanho do botão e o botão fica inerte.
2. O loader calcula a geometria pelo viewport do site, com a função pura `frameGeometry` (`apps/widget/src/frame-geometry.ts`): botão em iframe de 88x88 (folga de 8px para sombra e foco); painel `min(400, largura-32) x min(640, altura-32)` com margem de 16px; até 640px, tela cheia (`100vw x 100dvh`, com área segura dentro do widget).
3. O widget informa só se está aberto ou fechado, pelos eventos `open` e `close` que já existem no protocolo. O schema de `resize` do protocolo é estrito (`width` e `height`), então não foi acrescentado um campo `mode`: o loader usa `open` e `close` como fonte do modo e trata `resize` apenas como compatibilidade com versões antigas.
4. Recalcula em `resize`, `orientationchange` e `visualViewport.resize`, e quando o site muda variáveis CSS ou classes. Deslocamentos por `data-offset-bottom`, `data-offset-right`, `data-offset-bottom-var`, `data-offset-right-var` e `--viavoip-webchat-bottom`.
5. `window.ViaVoipWebchat.open()` e `close()` enviam `postMessage` só para a origem do iframe, no formato de `parentToWidgetSchema`. Estilos inline com `setProperty(..., 'important')`. Mantidos o guard de instância única e a validação de `event.origin` e `event.source`.
6. Visual ViaVoip: cabeçalho navy, botões índigo, `--brand` vindo da configuração do site, painel com `overflow: hidden`, lista de mensagens com rolagem, compositor fixo, pesquisa com rolagem, `100dvh`, sem requisições de fontes externas.
7. Ao carregar, o widget não rouba o foco do site: o foco só volta ao botão depois de o painel ter sido aberto.

Cobertura: `frame-geometry.test.ts` (geometria, estilos, deslocamentos, modo) e `panel-size.test.ts`; e, no navegador, `verify-visual.mjs` confere o botão de 88x88, o painel dentro do viewport nos cinco tamanhos e o caso de origem não autorizada (iframe continua 88x88 e botão inerte).

## 8. Site institucional e demo

`Site_ViaVoip` ganhou um repositório git local (sem remote) com o commit `chore: baseline local antes da demo do webchat`. A única alteração fora desse commit é `src/app/layout.js`: com `NEXT_PUBLIC_WEBCHAT_SITE_ID` definida, carrega o widget com `next/script` (`afterInteractive`) no lugar do `ClickToCall`; sem a variável, o site fica igual. O widget sobe acima do banner de cookies por `data-offset-bottom-var="--cookie-banner-height"`. As variáveis `NEXT_PUBLIC_WEBCHAT_URL` e `NEXT_PUBLIC_WEBCHAT_SITE_ID` ficam em `.env.local` (não versionado). As origens `http://localhost:3100` e `http://127.0.0.1:3100` e a cor `#3740b0` foram configuradas pelo próprio console admin, sem tocar em `seed.sql`. Passo a passo em `DEMO_SITE_LOCAL.md`.

## 9. Validação (resultados reais)

| Verificação | Resultado |
|---|---|
| `pnpm test` na raiz (protocol, sm-adapter, widget, console e servidor com Testcontainers) | **192 de 192 testes passaram** (reexecutado em 2026-10-29 sobre o commit `3d9e2cf`): protocol 11, sm-adapter 2, widget 18 (2 arquivos), console 61 (13 arquivos), servidor 100 (25 arquivos) |
| `pnpm build` na raiz | sem erros nos cinco pacotes (`tsc` estrito e `vite build`; loader com esbuild) |
| `scripts/verify-browser.mjs` em containers recém-criados | **saída 0** (isolamento de empresa e setor, supervisão ao vivo, revogação, idempotência do retry do console, fluxo completo do widget) |
| `scripts/verify-visual.mjs` (1920x1080, 1366x768, 768x1024, 390x844 e 375x667; console e widget em :8090 e :3100) | **155 verificações, 0 falhas, 0 erros de console**, saída 0 |
| Fluxo manual da demo em :3100 (botão, departamento, fila, agente Ana assume, mensagens nos dois sentidos, encerramento com classificação, pesquisa respondida) | executado pelo próprio `verify-visual.mjs` em todos os viewports; capturas `demo-3100-*.png` |

O que `verify-visual.mjs` confere: ausência de rolagem horizontal; iframe do widget e compositores (agente e visitante) dentro do viewport; botão do widget com 88x88 e acima do banner de cookies quando houver; painel em tela cheia até 640px; origem não autorizada deixando o iframe com 88x88 e o botão inerte; foco visível ao navegar com Tab no menu lateral e dentro de um modal; nenhuma mensagem de erro no console.

`scripts/verify-browser.mjs` precisou de ajustes mínimos nos seletores, porque a interface mudou de forma intencional: clique no botão do widget antes de usá-lo (o painel agora nasce fechado), confirmação no diálogo de "Encerrar", e aba **Filas** mais botão **Nova fila** antes do formulário de fila. Os `data-testid` e os rótulos do menu foram preservados.

## 10. Capturas de tela

Todas em `artifacts/visual/` (ignorado pelo git):

- **Antes:** `artifacts/visual/antes/` (16 arquivos, 1366x768 e 390x844).
- **Depois, console:** `artifacts/visual/depois/` (`01` a `30`: login, central, supervisão, qualidade, cada seção de administração, chat interno, setores, anúncios, atividades e modais).
- **Depois, verificação visual (cinco viewports):** `artifacts/visual/depois/visual-<porta>-<viewport>-<tela>.png` e `visual-console-<viewport>-<tela>.png`; origem não autorizada em `visual-nao-autorizado-<viewport>.png`.
- **Demo no site (:3100), 1366x768:** `artifacts/visual/depois/demo-3100-01-site-botao.png` a `demo-3100-07-encerrado.png` (botão, departamentos, fila, agente assume, troca de mensagens, pesquisa e encerramento).

## 11. Pendências e recomendações para a próxima rodada

Pendências e riscos:

1. `MAX_QUALITY_WINDOW_MS` não é exportado pelo pacote de protocolo; `quality/period.ts` repete o valor (31 dias). Exportar a constante evitaria divergência.
2. O schema de `resize` do protocolo não permite um campo de modo; hoje o loader usa `open` e `close`. Se o time quiser o campo `mode`, é uma mudança de protocolo (fora desta fase).
3. O campo de cor da aparência combina seletor e texto hexadecimal; o rótulo do `Field` envolve dois controles, o que deixa a leitura por tecnologia assistiva menos limpa. Vale refatorar `Field` para associar o rótulo por `id`.
4. Em tabelas largas (Usuários, SLA) a rolagem horizontal fica dentro do cartão quando os nomes são longos.
5. A seleção de responsáveis do setor parte das pessoas já listadas nos setores; não há endpoint que liste todas as pessoas.
6. `verify-browser.mjs` suspende uma conta (Sofia): exige containers recém-criados a cada execução.
7. O `next dev` do site mostra o selo "Insight" no canto inferior esquerdo e avisa de uma vulnerabilidade na versão instalada do Next (16.4.0). Atualizar o Next é decisão do time do site.
8. Nenhum bug de backend foi encontrado durante a validação.
9. A migration `009_company_admin.sql` ainda traz no cabeçalho o comentário "NÃO é aplicado pelo migrate.ts", embora seja aplicada; corrigir o comentário é mudança de arquivo de migration e ficou de fora desta documentação.

Recomendações:

- Integrar `verify-visual.mjs` à rotina de CI (já roda sobre os mesmos containers descartáveis).
- Medir contraste das cores semânticas derivadas com a identidade e promovê-las ao `DESIGN_SYSTEM.md` do site se forem aprovadas.
- Planejar o caminho de produção do widget: `widget.js` com cache e versão, e hospedagem do site com HTTPS (hoje a demo usa `localhost`).
- Acrescentar testes de componente (React Testing Library) para `useCompanyCommand` e os formulários de administração; hoje a lógica pura está coberta e o fluxo, pelos scripts de navegador.
- Avaliar paginação e busca na lista de usuários quando a empresa passar de algumas dezenas de pessoas.
