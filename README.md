# sm-webchat

ChatWeb do **SM (ICS — Instituto Curitiba de Saúde)**: canal web de atendimento ao cliente com cara de WhatsApp.

Esta é a **Etapa 1** (com correções **1.1**). Backend do SM ainda não está acessível; o fluxo roda com `MockTransport` (pré-atendimento simulado). Não há mídia, chat interno nem integração real.

## Como rodar

```bash
npm install
npm run dev
```

Abra o endereço que o Vite imprimir (em geral `http://localhost:5173`).

Query strings úteis:

- `?nome=Ana%20Souza` — saudação do bot usa esse nome (padrão: Maria Silva)
- `?modo=widget` — demonstra o chat como widget flutuante numa página hospedeira

## Scripts

| Script | Função |
| --- | --- |
| `npm run dev` | servidor de desenvolvimento |
| `npm run build` | typecheck + bundle de produção |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run lint` | ESLint |
| `npm test` | Vitest + Testing Library |

CI no GitHub Actions (`lint`, `typecheck`, `test`, `build`) em push e pull request.

## Teste manual (Etapa 1)

1. `npm run dev` e abrir a página cheia.
2. Conferir cabeçalho verde ICS, avatar, status **online**, fundo de conversa e a mensagem de boas-vindas com o nome do paciente e o menu `1 / 2 / 3 / 4 / 0`.
3. Esperar o indicador **digitando…** antes da primeira mensagem do bot.
4. Clicar num chip de menu (ex.: “1 — Primeira vez / Orientação”): a opção deve ir como mensagem sua; ticks passam por enviada → entregue → **lida**; o bot responde.
5. Digitar `4` e enviar com **Enter**. **Shift+Enter** deve quebrar linha sem enviar.
6. Abrir o seletor de emojis, inserir um emoji no meio do texto, enviar.
7. Redimensionar para mobile: cabeçalho, lista e composer continuam usáveis.
8. Abrir `/?modo=widget`, clicar em **Chat ICS**, conversar, **Fechar** (o foco deve voltar ao botão).
9. Percorrer o teclado (Tab) nos botões de menu, setas no seletor de emojis, campo e enviar.
10. Encerrar com `0`: composer e chips desligam; **Iniciar novo atendimento** reabre o menu.
11. Enviar duas mensagens rápido: as duas devem aparecer na hora, sem esperar o bot.

## Arquitetura (mínima)

- `src/domain` — mensagem normalizada (união discriminada)
- `src/transport` — `ChatTransport` + `MockTransport`
- `src/chat` — sessão, datas, inserção de emoji
- `src/ui` — painel estilo WhatsApp e modo widget
- `docs/contrato-mensagem.md` — rascunho do contrato
- `docs/residuais.md` — o que fica para etapas seguintes
