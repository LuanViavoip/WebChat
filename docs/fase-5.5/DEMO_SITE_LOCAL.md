# Demo local do webchat no site institucional

Roteiro para ver o widget da ViaVoip funcionando dentro de `Site_ViaVoip` e atender pelo console, tudo na máquina local. Nenhum valor secreto aparece aqui: os nomes das variáveis estão listados, os valores ficam em `.env` e `.env.local`, que não vão para o git.

## Serviços e portas

| Serviço | Porta | Origem |
|---|---|---|
| Postgres (WebChat) | 5434 no host (5432 na rede do Compose) | `docker compose`, serviço `postgres` |
| Redis | 6379 | `docker compose`, serviço `redis` |
| WebChat (API, console em `/console/`, widget em `/widget.js`) | 3000 | `docker compose`, serviço `server` |
| Página demo estática | 8090 | `docker compose`, serviço `demo` (nginx) |
| Site institucional (Next.js) | 3100 | `npx next dev -p 3100` em `Site_ViaVoip` |

A 3000 é do WebChat; por isso o site usa a 3100. Para verificações descartáveis (skill `verify`), os containers usam 55439 (Postgres) e 56379 (Redis), sem volumes.

## Variáveis de ambiente (só os nomes)

WebChat (`.env`, ver `.env.example`):

- `DATABASE_URL`, `MIGRATE_DATABASE_URL`, `REDIS_URL`
- `SM_ADAPTER`, `LOGIN_RATE_LIMIT_SECRET`
- `PORT`, `HOST`, `SEED`, `CORS_ORIGINS`, `SESSION_TTL_HOURS`

Site (`Site_ViaVoip/.env.local`, não versionado):

- `NEXT_PUBLIC_WEBCHAT_URL` — endereço do WebChat (`http://localhost:3000`)
- `NEXT_PUBLIC_WEBCHAT_SITE_ID` — identificador público do site no WebChat (`site_a`)

Sem `NEXT_PUBLIC_WEBCHAT_SITE_ID`, o site fica idêntico ao original, com o botão "Fale agora" (`ClickToCall`). Com ela, o `layout.js` carrega `<WEBCHAT_URL>/widget.js` com `next/script` (`afterInteractive`) e não monta o `ClickToCall`.

O script ainda recebe `data-offset-bottom-var="--cookie-banner-height"`: o widget lê essa variável CSS (publicada pelo `CookieConsent` do site) e sobe acima do banner de cookies.

## Subir tudo

```bash
# 1. WebChat: Postgres, Redis, servidor e página demo
cd /home/luan/ViaVoip/WebChat
docker compose up --build postgres redis server demo

# 2. Site institucional (outro terminal)
cd /home/luan/ViaVoip/Site_ViaVoip
npx next dev -p 3100
```

O seed do WebChat (`SEED=true` no Compose) cria o tenant A, os agentes e o site `site_a`, com as origens `http://localhost:8090` e `http://127.0.0.1:8090`.

## Autorizar o site 3100 pelo console admin

O widget só abre em origens autorizadas. O `seed.sql` não é alterado: a configuração é feita no console.

1. Abra `http://localhost:3000/console/` e entre como `otavio@tenant-a.local` (senha da demo informada na tela de login).
2. Menu lateral, **Administração**, aba **Sites e Widgets**.
3. No cartão **Site A**, clique em **Origens** e deixe uma por linha:
   - `http://localhost:8090`
   - `http://127.0.0.1:8090`
   - `http://localhost:3100`
   - `http://127.0.0.1:3100`
4. **Salvar origens**.
5. Em **Aparência**, defina a cor principal `#3740b0` e salve.

Se o banco for recriado, repita este passo. O botão **Copiar script** gera o snippet de instalação com a origem do console e o identificador público.

## Passo a passo do teste

1. Abra `http://localhost:3100/`. O botão redondo do chat aparece no canto inferior direito, acima do banner de cookies quando ele existir.
2. Em outro navegador (ou janela anônima), abra `http://localhost:3000/console/` e entre como `ana@tenant-a.local`. Deixe a presença em **Disponível**.
3. No site, clique no botão do chat. O painel abre (400x640 no desktop; tela cheia em telas de até 640px).
4. Escolha o departamento **Suporte**. O visitante entra na fila ("Aguardando atendente").
5. No console, **Atendimentos**: a conversa aparece em "Aguardando". Selecione e clique em **Assumir**.
6. Troquem mensagens: Enter envia, Shift+Enter quebra a linha. As mensagens aparecem dos dois lados em tempo real.
7. No console, escolha a classificação (por exemplo **Resolvido**), clique em **Encerrar** e confirme no diálogo.
8. No site, o widget mostra a pesquisa de satisfação. Escolha uma nota e **Enviar avaliação**.
9. O painel mostra "Atendimento encerrado". No console, a conversa aparece como **Encerrada** para a supervisão.

Também dá para testar em `http://localhost:8090/` (página demo estática) com o mesmo roteiro.

## Controle do widget pelo site

O loader expõe `window.ViaVoipWebchat.open()` e `window.ViaVoipWebchat.close()`. Os comandos vão por `postMessage` somente para a origem do iframe. Atributos opcionais no `<script>`:

- `data-offset-bottom` e `data-offset-right`: distância das bordas em px (padrão 16).
- `data-offset-bottom-var` e `data-offset-right-var`: nome de uma variável CSS do site cujo valor é somado ao deslocamento.
- `--viavoip-webchat-bottom` e `--viavoip-webchat-right`: variáveis que o site pode definir no `:root` para o mesmo fim.

## Verificações automáticas

Com o ambiente descartável da skill `verify` no ar (ver `.cursor/skills/verify/SKILL.md`):

```bash
export PLAYWRIGHT_PACKAGE_JSON=/tmp/webchat-verify-pw/package.json
export VERIFY_POSTGRES_CONTAINER=webchat-verify-pg VERIFY_INSPECT_ROOMS=true
node scripts/verify-browser.mjs      # fluxo completo, isolamento, idempotência (use containers recém-criados)
node scripts/verify-visual.mjs       # 5 viewports, console e widget em :8090 e :3100
```

`verify-visual.mjs` grava capturas em `artifacts/visual/depois/` (ignorado pelo git). Para só um host: `VERIFY_VISUAL_HOSTS=8090`.

## Problemas conhecidos

- O `next dev` mostra um selo "Insight" no canto inferior esquerdo; ele é do modo de desenvolvimento do Next e não faz parte do site.
- O `next dev` avisa de uma vulnerabilidade da versão do Next instalada (16.4.0). Atualizar é uma decisão do time do site e não foi feita aqui.

## Popular o sistema com dados de demonstração

`scripts/demo/populate.mjs` enche um WebChat já em execução com conversas realistas (em português, assuntos de telefonia e VoIP). Ele usa só as interfaces públicas, do mesmo jeito que o widget e o console: `POST /visitor/sessions`, `POST /auth/login`, `POST /company/commands` e socket.io nos namespaces `/visitor`, `/agent` e `/supervisor`. Nada é inserido direto no banco; por isso a supervisão, a qualidade e a auditoria mostram valores calculados pelo servidor.

```bash
cd /home/luan/ViaVoip/WebChat
node scripts/demo/populate.mjs                  # popula e fica conectado (padrão)
node scripts/demo/populate.mjs --no-keep-alive  # popula e encerra (agentes ficam offline)
```

Opções: `--base-url=http://localhost:3000`, `--site=site_a`, `--origin=http://localhost:8090` (origem autorizada do site), `--password=...` (ou `DEMO_PASSWORD`), `--fast` (pausas curtas, só para teste). Precisa do servidor no ar com o seed padrão (tenant A) e com a origem informada autorizada no site.

O que cria, em cerca de 1 minuto:

- 6 atendimentos encerrados em Suporte e Vendas (um transferido de Suporte para Vendas), com classificação e pesquisa respondida (notas de 2 a 5, com comentário), mais 1 visitante que desiste da fila.
- 3 atendimentos em andamento (Ana, Bruno e Diana, um deles com mensagens não lidas de Ricardo Nogueira para a Ana) e 3 visitantes aguardando na fila.
- Chat interno: conversa direta Ana e Sofia e mensagens no grupo do setor Suporte Técnico.
- 3 comunicados (um da empresa fixado, sobre a manutenção da URA no sábado às 22h).
- Catálogos reaproveitados se já existirem: classificações "Dúvida comercial" e "Encaminhado ao técnico", políticas de SLA para Suporte (espera 30 s, primeira resposta 90 s) e Vendas (45 s e 120 s), tipo de atividade "Pausa café" atribuído ao Eduardo.
- Presença: Ana, Bruno e Diana disponíveis; Eduardo ausente.

### Keep-alive

A presença do agente depende do socket aberto. Com `--keep-alive` (padrão), o script termina de popular e continua rodando: mantém os sockets dos agentes com `presence.heartbeat` a cada 15 s (o servidor considera morta a conexão sem batimento por 45 s) e os dos visitantes, para a Visão geral mostrar conectados, disponíveis e visitantes na fila. Para encerrar, use Ctrl+C no terminal ou `kill $(cat /tmp/webchat-demo-populate.pid)`; os agentes voltam a offline e as conversas continuam no banco.

Seu login no navegador funciona em paralelo, com a mesma conta. O script deixa a Ana com no máximo 1 atendimento ativo (o limite da empresa é lido de `/company/desk`; hoje 3), então ela ainda assume visitantes da fila.

### Rodar de novo

Pode repetir a qualquer momento: cada execução acrescenta novos atendimentos encerrados (com outros nomes de visitantes), mas não duplica os que já estão em andamento ou na fila, os comunicados, o setor, os tipos de atividade, as classificações nem o chat interno. Só deixe um keep-alive por vez (o script avisa quando já existe outro, pelo PID em `/tmp/webchat-demo-populate.pid`). Não há como apagar dados pelas interfaces públicas; para recomeçar do zero, recrie o banco descartável.
