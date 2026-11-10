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
