# Chat Interno ViaVoip — Release Notes & Controle de Versão de Compilação

> **Versão Atual de Compilação:** `1.0.3`  
> **Série Base Atual:** `1.0`  
> **Última Atualização:** `19/11/2026`

---

## 🤖 Protocolo de versionamento (resumo)

Formato `<MAJOR>.<MINOR>.<BUILD>` sem zeros à esquerda. A cada pedido, BUILD +1 via `scripts/bump-version.mjs`. Nova série só quando o Luan pedir (`--remix`), reiniciando em `.1` e preservando o histórico. Regra completa em `AGENTS.md` ("Versão e notas").

---

## 📦 Histórico de Alterações — Série `1.0` (`1.0.1` a `1.0.3`)

### Build `1.0.3` — *19/11/2026*
**Contratos da v1 do Chat Interno e pontos de encaixe das frentes**
- Sem mudança visível (interno)
- Tipos e contrato de reações, respostas, encaminhar, editar e apagar, recibos, presença, enquete, agendada, respostas rápidas e avisos (packages/internal-domain, transport/contract)
- Digitando passa a ser atividade (digitando ou gravando áudio); slots de tela, debug e gravador prontos para as frentes

### Build `1.0.2` — *19/11/2026*
**Grupos de conversa no modelo de ilhas N:N**
- Supervisor e admin criam e editam grupos; o agente vê os grupos no topo da lista (packages/internal-domain/src/group.ts, transport/mock)
- Grupos de ilha atualizam os membros sozinhos quando alguém entra ou sai da ilha
- Quem sai do grupo mantém o histórico só para leitura

### Build `1.0.1` — *18/11/2026*
**Sistema de versionamento incremental e release notes do Chat Interno**
- Criação de `src/version.ts`, `RELEASE_NOTES.md` e `scripts/bump-version.mjs`, no formato do SM Report Studio.
- Regra no `AGENTS.md`: a IA sobe o BUILD a cada pedido.
