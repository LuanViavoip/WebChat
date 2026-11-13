# sm-webchat

Chat interno da **ViaVoip** (Etapa 3): o app deixa de ser o canal do paciente e passa a ser um shell de conversa no estilo WhatsApp Web. Backend do SM ainda não está acessível; o fluxo ao vivo roda com `MockTransport`. Sem bot, widget, transcrições de demonstração ou encerramento de atendimento.

## Como rodar

```bash
npm install
npm run dev
```

Abra o endereço que o Vite imprimir (em geral `http://localhost:5173`).

Query strings úteis:

- `?falha=upload` — a primeira tentativa de upload falha; **Tentar de novo** conclui
- `?upload=lento` — upload em ~4 s, tempo para clicar em **Cancelar**
- `?falha=conectar` — a conexão inicial falha; **Reconectar** tenta de novo

A tag `cliente-widget-v1` guarda a versão anterior do widget do paciente.

## Scripts

| Script | Função |
| --- | --- |
| `npm run dev` | servidor de desenvolvimento |
| `npm run build` | typecheck + bundle de produção |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run lint` | ESLint |
| `npm test` | Vitest + Testing Library |
| `npm run test:e2e` | Playwright (1366, 1920, 2560, 390) + axe |

CI no GitHub Actions (`lint`, `typecheck`, `test`, `build`, `test:e2e`) em push e pull request. Screenshots da etapa vão como artifacts.

## Teste manual (Etapa 3)

1. `npm run dev` e abrir a página. O layout continua WhatsApp Web em duas colunas no desktop, tela cheia, cores só pelos tokens (`--surface`, `--accent`, `--bubble-out`, `--bubble-in`).
2. A lista tem **Conversa de teste**. Sem mensagens, o log mostra o estado vazio. Digite um texto, envie; os ticks chegam a **Lida**. Nenhuma resposta automática.
3. Clicar no **clipe**, escolher um PNG; conferir o preview, digitar legenda e **Enviar**. A bolha mostra a foto, a sidebar mostra a legenda ou “Foto”.
4. Clicar na miniatura: visualizador em tela cheia, **Esc** fecha e o foco volta.
5. Enviar PDF (card com **Baixar**), MP3 e MP4 (players nativos).
6. Tentar `.exe` ou PNG > 5 MB: faixa vermelha com o erro em pt-BR e **Fechar**.
7. `/?falha=upload`: enviar foto, **Tentar de novo**, chegar a Lida. `/?upload=lento`: **Cancelar** some a bolha.
8. Arrastar um arquivo para a conversa: overlay “Solte o arquivo para anexar”.
9. Em **~390px**: abre na **lista**. Tocar o item abre o chat; **Voltar** devolve o foco ao item.

## Arquitetura (mínima)

- `src/domain` — mensagem normalizada (união discriminada)
- `src/transport` — `ChatTransport` + `MockTransport` (uma conversa por conexão; `readyGate`)
- `src/chat` — sessão, datas, inserção de emoji, uploads
- `src/ui` — shell em tela cheia (sidebar + chat)
- `src/styles` — tokens `--vv-*`, camada semântica e contraste WCAG
- `docs/contrato-mensagem.md` — rascunho do contrato
- `docs/residuais.md` — o que fica para etapas seguintes
- `docs/screenshots/etapa-3/` — artefatos desta etapa
