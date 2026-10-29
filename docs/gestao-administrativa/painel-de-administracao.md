# Painel de administração

Código de referência: Fase 5.5. Fontes: `apps/console/src/admin/` (`AdminPanel.tsx`, `useCompanyCommand.ts`, `command-runner.ts`, `sla-history.ts`, `origins.ts`, `widget-script.ts`, `sections/`), `apps/server/src/auth/sessions.ts` e `packages/protocol/src/http.ts`. Seção **Administração** do console, exclusiva do papel administrador ([Papéis e permissões](papeis-e-permissoes.md)).

O painel carrega a empresa por `GET /company/desk` e envia cada alteração por `POST /company/commands` ([Comandos idempotentes](comandos-idempotentes.md)). Todos os formulários enviam exatamente o schema do comando e são validados no cliente antes do envio.

## Seções

| Seção | O que permite |
|---|---|
| Empresa | Nome, fuso horário e limite de atendimentos simultâneos por agente |
| Usuários e Permissões | Criar pessoas, papel, filas do agente, suspender e reativar, revogar sessões, redefinir senha, e quem registra a atividade do agente |
| Filas | Criar, renomear e arquivar filas |
| Classificações | Catálogo de classificações de encerramento |
| Sites e Widgets | Identidade e aparência do site, origens autorizadas, janelas de funcionamento, pausa e retomada, e o script de instalação |
| SLA | Política por fila e histórico de versões |
| Pesquisa | Definição da pesquisa de satisfação |
| Auditoria | Consulta dos eventos de auditoria ([Auditoria](auditoria.md)) |

As seções são abas laterais (`Tabs`) com navegação por teclado.

## Comandos idempotentes no console

`useCompanyCommand` envolve cada envio em um `CommandRunner`, que guarda o `requestId` da **tentativa lógica**:

- O id nasce no primeiro envio.
- Ao reenviar o **mesmo conteúdo** depois de uma falha de rede ou timeout (erro "retentável"), o **mesmo `requestId`** é reaproveitado. O servidor reconhece o recibo e devolve `replayed: true`, sem repetir o efeito.
- O id é descartado após sucesso, após recusa definitiva do servidor, quando o conteúdo do comando muda e quando o formulário é fechado (`reset()`).
- Enquanto há um envio pendente, novos envios são ignorados e o botão fica desabilitado.

Depois de cada comando, o painel mostra uma linha de resultado (`data-testid="command-result"`) com o `requestId` e se o resultado foi "Efeito único" ou "Repetido". O servidor guarda o recibo por 24 horas.

Ações destrutivas (suspender, revogar sessões, retirar classificação ou SLA, pausar site, arquivar fila) passam por diálogo de confirmação ou por formulário com motivo.

## Sites e Widgets

- **Origens**: uma por linha. O console normaliza para `esquema://host[:porta]` (sem caminho nem barra final), remove repetidas, aceita só `http://` e `https://` e limita a 20 origens, como o schema do protocolo.
- **Aparência**: nome exibido, cor principal (seletor mais campo hexadecimal), mensagem de boas-vindas, exigência de nome do visitante e logotipo `https://`.
- **Copiar script**: monta `<script async src="<origem do console>/widget.js" data-widget-id="<publicId>"></script>`. Usa a origem do console e o identificador público real; não inclui tokens. O `publicId` não muda depois de criado.
- Um site novo nasce pausado e sem origens ([Configuração por empresa](configuracao-por-empresa.md)).

Para a demonstração local, a autorização de origens é feita nesta seção ([Demo local no site institucional](../fase-5.5/DEMO_SITE_LOCAL.md)).

## SLA: histórico de versões

A seção SLA mostra a política vigente por fila e, para a fila escolhida, o **histórico de versões**, da mais recente para a mais antiga. As versões vêm do próprio `GET /company/desk` (vigentes e retiradas); o console numera da mais antiga (1) para a mais recente e classifica cada uma em relação ao instante atual:

| Estado | Significado |
|---|---|
| Vigente | Ativa e já em vigor |
| Agendada | Ativa, com início no futuro |
| Vigente até a troca | Retirada, mas com fim ainda no futuro |
| Encerrada | Retirada, com fim no passado |

Cada linha mostra espera na fila, primeira resposta e datas de início e fim. Publicar e retirar seguem as regras de [Política de SLA](../qualidade-operacional/politica-de-sla.md): nunca retroativo, sem lacuna e sem sobreposição.

## Permissão de atividade própria (`canChangeOwnActivity`)

Em **Usuários e Permissões**, o campo *Atividades* de um agente define quem registra as pausas e outras atividades dele:

| Valor (`activityAuthority`) | Efeito |
|---|---|
| `assigned_only` | Só supervisão e administração alocam atividades ao agente |
| `self_service` | O agente registra a própria atividade |

Ao mudar, a pessoa precisa entrar de novo. `GET /auth/me` passou a devolver `canChangeOwnActivity` (booleano obrigatório):

- Para o **agente**, é `true` somente quando `agents.can_change_own_activity` está concedido.
- Para **supervisor** e **administrador**, é sempre `true`.
- A regra é a mesma de `assertCanAllocate` no servidor; o console usa o campo só para mostrar ou esconder o formulário de registro. Um agente sem permissão que tente alocar a si mesmo continua sendo recusado pelo servidor.

Na seção "Minha atividade" (agente) o formulário de registro aparece apenas quando `canChangeOwnActivity` é verdadeiro. Ver [Atividades](../modules/activities.md).
