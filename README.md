# sm-webchat

ChatWeb do **SM (ICS — Instituto Curitiba de Saúde)**: canal web de atendimento ao cliente, agora com visual **ViaVoip** (etapa 1.3). O nome de negócio ICS permanece.

Esta é a **Etapa 2**: mídia na conversa (imagem, áudio, vídeo e documento) sobre o layout da Etapa 1.3 (tela cheia, histórico somente leitura, tokens ViaVoip). Backend do SM ainda não está acessível; o fluxo ao vivo roda com `MockTransport`. Não há sticker, gravação, chat interno nem integração real.

## Como rodar

```bash
npm install
npm run dev
```

Abra o endereço que o Vite imprimir (em geral `http://localhost:5173`).

Query strings úteis:

- `?nome=Ana%20Souza` — saudação do bot usa esse nome (padrão: Maria Silva)
- `?modo=widget` — demonstra o chat como widget flutuante 380×640 numa página hospedeira
- `?falha=upload` — a primeira tentativa de upload falha; **Tentar de novo** conclui
- `?upload=lento` — upload em ~4 s, tempo para clicar em **Cancelar**

## Scripts

| Script | Função |
| --- | --- |
| `npm run dev` | servidor de desenvolvimento |
| `npm run build` | typecheck + bundle de produção |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run lint` | ESLint |
| `npm test` | Vitest + Testing Library |
| `npm run test:e2e` | Playwright (1366, 1920, 2560, 390 e widget) + axe |

CI no GitHub Actions (`lint`, `typecheck`, `test`, `build`, `test:e2e`) em push e pull request. Screenshots da etapa vão como artifacts.

## Teste manual (Etapa 2)

1. `npm run dev` e abrir a página. O layout continua WhatsApp Web em duas colunas no desktop, tela cheia, cores só pelos tokens (`--surface`, `--accent`, `--bubble-out`…).
2. Clicar no **clipe**, escolher um PNG; conferir o preview, digitar legenda e **Enviar**. A bolha mostra a foto, a sidebar mostra a legenda ou “Foto”, os ticks chegam a **Lida**.
3. Clicar na miniatura: visualizador em tela cheia, **Esc** fecha e o foco volta.
4. Enviar PDF (card com **Baixar**), MP3 e MP4 (players nativos).
5. Tentar `.exe` ou PNG > 5 MB: faixa vermelha com o erro em pt-BR e **Fechar**.
6. `/?falha=upload`: enviar foto, **Tentar de novo**, chegar a Lida. `/?upload=lento`: **Cancelar** some a bolha.
7. Arrastar um arquivo para a conversa: overlay “Solte o arquivo para anexar”.
8. Em **~390px** e `/?modo=widget`: o clipe e o preview continuam no mesmo shell; o widget permanece 380×640.

## Teste manual (Etapa 1.3, ainda vale)

1. `npm run dev` e abrir a página em **1366×768**, **1920×1080** e **2560×1440**: o shell (`.wa-shell`) preenche o viewport, sem faixa cinza nas laterais e sem scroll horizontal.
2. Conferir duas colunas no desktop: lista (wordmark **ViaVoip**, busca, Tudo / Não lidas) e conversa. Superfícies claras, azul de acento, cabeçalho em gradiente escuro; lima só sobre o ink do cabeçalho.
3. A conversa ativa é **ICS Pré-atendimento**. Clicar em **Atendimento anterior** e **Exames e vacinas** abre transcrições mock no mesmo `MessageList`, sem composer, com a faixa “Atendimento encerrado · somente leitura”. Os dois itens de histórico têm badge **Demonstração** e um aviso de conversa fictícia no painel.
4. Voltar para **ICS Pré-atendimento**: o histórico ao vivo continua lá (a sessão não chama `start()` de novo).
5. Filtro **Não lidas**: nenhuma conversa falsa; mensagem “Nenhuma conversa não lida”.
6. Teclado: Tab chega aos itens da lista; Enter ou Espaço abre a conversa. O item atual tem `aria-current`.
7. Esperar **digitando…** e a boas-vindas. O menu `1 / 2 / 3 / 4 / 0` fica **no balão**.
8. Encerrar com `0`: faixa de encerrado, composer desligado; **Iniciar novo atendimento** reabre.
9. Redimensionar para **~390×844**: abre na **lista**. Tocar um item abre o chat e move o foco para o campo ou o cabeçalho; o cabeçalho mostra **Voltar**. O botão Voltar e o voltar do navegador retornam à lista e devolvem o foco ao item. Voltar/avançar do navegador também restauram a conversa certa no desktop.
10. Abrir `/?modo=widget`: sem sidebar, 380×640, direto no chat ao vivo; **Fechar** devolve o foco ao botão.
11. Percorrer o teclado; labels e contraste devem permanecer legíveis (branco sobre `#1E3FCC` no envio; tick de lida azul no balão `#EEF2FF`).

## Arquitetura (mínima)

- `src/domain` — mensagem normalizada (união discriminada)
- `src/transport` — `ChatTransport` + `MockTransport`
- `src/chat` — sessão, datas, inserção de emoji
- `src/ui` — shell em tela cheia (sidebar + chat), histórico mock e modo widget compacto
- `src/styles` — tokens `--vv-*`, camada semântica e contraste WCAG
- `docs/contrato-mensagem.md` — rascunho do contrato
- `docs/residuais.md` — o que fica para etapas seguintes
- `docs/screenshots/etapa-1.3/` — antes/depois nos viewports pedidos
