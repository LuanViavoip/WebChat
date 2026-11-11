# Residuais

Itens **propositadamente não implementados** (Etapa 1 / 1.1 / 1.2):

- Mídia real: imagem, áudio, vídeo, documento, sticker, upload, gravação, preview (o contrato `OutboundPayload` já reserva os tipos; o mock recusa)
- Integração real com o SM / canal WhatsApp (hoje só `MockTransport`)
- Mapear `clientId` → id definitivo do servidor quando o canal WhatsApp existir
- Chat interno de agentes e supervisores
- Grupos, pastas, transferência, fila, troca de fila
- Encerramento com pesquisa de satisfação (NPS/CSAT) de ponta a ponta — o mock só encerra com a opção `0`
- Autenticação do paciente, SSO, vínculo com prontuário
- Persistência / histórico entre reloads (reconectar hoje recomeça a conversa)
- Alternância de tema claro/escuro na UI — tokens `[data-theme='dark']` existem no CSS, mas o app permanece no tema claro
- Internacionalização além de pt-BR
- Biblioteca de emojis completa (seletor curto próprio, agora com setas de listbox)
- PWA, push, notificações nativas
- Widget SDK publicável (npm) — o modo widget continua `?modo=widget`
- Check de contraste/axe no GitHub Actions (rodado localmente com evidência no PR)
- Busca na conversa, menu ⋮, comunidades, status e nova conversa da coluna esquerda (ícones visíveis, desabilitados, tooltip “em breve”)
- Anexo e microfone reais (clipe e mic desabilitados nesta etapa; o mic vira enviar ao digitar)
- Lista de conversas ligada ao SM — no canal do cliente a coluna esquerda é mock (conversa ativa + “Atendimento anterior” / “Exames e vacinas” indisponíveis)
- Papel de parede e ícones oficiais do WhatsApp (recriação própria + Lucide + verde ICS)

## Etapa 1.2 — o que ficou de fora do redesign

- Pixel-perfect de cada ícone/glyph do WhatsApp Web (Lucide equivalente, não assets proprietários)
- Dark mode aplicável pelo usuário
- Lista de conversas real, arquivadas, pinned, mute
- Emoji picker completo / stickers / GIF
- Reações, encaminhar, responder, estrela, info da mensagem
- Indicador de digitação no item da lista (só no cabeçalho/área da conversa)
- Layout de três painéis (contato / conversa / perfil)

## Ressalvas da revisão a4a6b60

Parecer do Codex no head `a4a6b60`: **aprovado com ressalvas** para a Etapa 2 (sem P0/P1). Registrado a pedido do Luan. Sem correção de código nesta passagem. A Etapa 1.2 não altera `ChatSession` / transporte.

1. **P2 (integração real) — mesclar pendência quando um evento de status associa os IDs.** Com mensagem otimista já presente por `clientId`, um `read` antecipado pelo id do servidor e depois um evento que associa os dois, `ChatSession.ts` (~199, `apply` de `status`) atualiza a mensagem mas não consome a pendência antiga; o status visível pode ficar em `sent`. Falta teste: otimista existente + associação só no evento de status.

2. **P2 (integração real) — limitar o índice de aliases** (`idAlias.ts` ~19). Hoje só limpa em novo atendimento (`start`). Na integração com eventos reais, definir política de descarte/limite para o índice não crescer sem teto.

3. **P3 (etapa 2) — testes de retry.** Cobrir rejeição tardia após restart/unmount também no `retry` (hoje o caso é só em `send`); reenvio de payload de mídia com o mesmo `clientId`; decidir se o `MockTransport` aceita mídia simulada (hoje recusa em `MockTransport.ts` ~128) ou testar explicitamente essa recusa.

4. **P3 (manual) — leitor de tela real (NVDA/VoiceOver).** Pendência da Etapa 1.2: não há NVDA/VoiceOver neste ambiente. O `role="log"` permanece sempre ativo; o teste de resposta após falha de envio cobre só a estrutura (mensagem no log vivo), não o anúncio único. Erros usam `role="alert"` no banner, sem desligar o log. Encerrado não usa `status`/`alert`. Confirmar no dispositivo do Luan se o leitor anuncia cada mensagem uma vez ou se log + alerta se repetem.
