# Residuais

Itens **propositadamente não implementados** (Etapa 1 / 1.1):

- Mídia real: imagem, áudio, vídeo, documento, sticker, upload, gravação, preview (o contrato `OutboundPayload` já reserva os tipos; o mock recusa)
- Integração real com o SM / canal WhatsApp (hoje só `MockTransport`)
- Mapear `clientId` → id definitivo do servidor quando o canal WhatsApp existir
- Chat interno de agentes e supervisores
- Grupos, pastas, transferência, fila, troca de fila
- Encerramento com pesquisa de satisfação (NPS/CSAT) de ponta a ponta — o mock só encerra com a opção `0`
- Autenticação do paciente, SSO, vínculo com prontuário
- Persistência / histórico entre reloads (reconectar hoje recomeça a conversa)
- Temas claro/escuro além da base WhatsApp + ICS
- Internacionalização além de pt-BR
- Biblioteca de emojis completa (seletor curto próprio, agora com setas de listbox)
- PWA, push, notificações nativas
- Widget SDK publicável (npm) — o modo widget continua `?modo=widget`
- Check de contraste/axe no GitHub Actions (rodado localmente com evidência no PR da 1.1)

## Ressalvas da revisão a4a6b60

Parecer do Codex no head `a4a6b60`: **aprovado com ressalvas** para a Etapa 2 (sem P0/P1). Registrado a pedido do Luan. Sem correção de código nesta passagem.

1. **P2 (integração real) — mesclar pendência quando um evento de status associa os IDs.** Com mensagem otimista já presente por `clientId`, um `read` antecipado pelo id do servidor e depois um evento que associa os dois, `ChatSession.ts` (~199, `apply` de `status`) atualiza a mensagem mas não consome a pendência antiga; o status visível pode ficar em `sent`. Falta teste: otimista existente + associação só no evento de status.

2. **P2 (integração real) — limitar o índice de aliases** (`idAlias.ts` ~19). Hoje só limpa em novo atendimento (`start`). Na integração com eventos reais, definir política de descarte/limite para o índice não crescer sem teto.

3. **P3 (etapa 2) — testes de retry.** Cobrir rejeição tardia após restart/unmount também no `retry` (hoje o caso é só em `send`); reenvio de payload de mídia com o mesmo `clientId`; decidir se o `MockTransport` aceita mídia simulada (hoje recusa em `MockTransport.ts` ~128) ou testar explicitamente essa recusa.

4. **P3 (manual) — leitor de tela real (NVDA/VoiceOver).** `role="log"` e os papéis `alert`/`status` têm semântica viva implícita além da região de digitação. Confirmar no teste manual do Luan que os anúncios não se repetem.
