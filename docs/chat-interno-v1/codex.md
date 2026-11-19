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
