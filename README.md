# sm-webchat

ChatWeb do **SM (ICS — Instituto Curitiba de Saúde)**: canal web de atendimento ao cliente com cara de WhatsApp.

Esta é a **Etapa 1.2**: o layout visual segue o **WhatsApp Web (desktop)** em duas colunas (tema claro, identidade ICS). Backend do SM ainda não está acessível; o fluxo roda com `MockTransport` (pré-atendimento simulado). Não há mídia, chat interno nem integração real.

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

## Teste manual (Etapa 1.2)

1. `npm run dev` e abrir a página cheia em **1366×768** ou **1920×1080**.
2. Conferir **duas colunas**: esquerda (avatar ICS, busca, filtros Tudo / Não lidas, lista) e direita (cabeçalho da conversa, doodle, balões, composer Web).
3. A conversa ativa é **ICS Pré-atendimento**; **Atendimento anterior** e **Exames e vacinas** são itens de **Demonstração** (desabilitados, sem badge de não lida). O filtro **Não lidas** não os lista.
4. Esperar **digitando…** e a boas-vindas com o nome do paciente. O menu `1 / 2 / 3 / 4 / 0` fica **no balão** (lista de botões), não solto.
5. Clicar em “1 — Primeira vez / Orientação”: ticks enviada → entregue → **lida** (azul); o bot responde.
6. Digitar no campo arredondado: o **microfone** vira **enviar**. Clipe de anexo permanece desabilitado (“em breve”). **Enter** envia; **Shift+Enter** quebra linha.
7. Abrir o seletor de emojis, inserir um emoji no meio do texto, enviar.
8. Redimensionar para **~390px**: a coluna esquerda some (uma coluna, como o Web).
9. Abrir `/?modo=widget`: coluna única compacta, conversar, **Fechar** (foco volta ao botão).
10. Encerrar com `0`: faixa amarela de encerrado, composer e botões do menu desligam; **Iniciar novo atendimento** reabre.
11. Enviar duas mensagens rápido: as duas devem aparecer na hora, sem esperar o bot.

## Arquitetura (mínima)

- `src/domain` — mensagem normalizada (união discriminada)
- `src/transport` — `ChatTransport` + `MockTransport`
- `src/chat` — sessão, datas, inserção de emoji
- `src/ui` — shell WhatsApp Web (sidebar + chat) e modo widget compacto
- `docs/contrato-mensagem.md` — rascunho do contrato
- `docs/residuais.md` — o que fica para etapas seguintes
