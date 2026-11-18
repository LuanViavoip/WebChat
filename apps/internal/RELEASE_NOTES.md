# Chat Interno ViaVoip — Release Notes & Controle de Versão de Compilação

> **Versão Atual de Compilação:** `1.0.1`  
> **Série Base Atual:** `1.0`  
> **Última Atualização:** `18/11/2026`

---

## 🤖 Protocolo de versionamento (resumo)

Formato `<MAJOR>.<MINOR>.<BUILD>` sem zeros à esquerda. A cada pedido, BUILD +1 via `scripts/bump-version.mjs`. Nova série só quando o Luan pedir (`--remix`), reiniciando em `.1` e preservando o histórico. Regra completa em `AGENTS.md` ("Versão e notas").

---

## 📦 Histórico de Alterações — Série `1.0` (`1.0.1` a `1.0.1`)

### Build `1.0.1` — *18/11/2026*
**Sistema de versionamento incremental e release notes do Chat Interno**
- Criação de `src/version.ts`, `RELEASE_NOTES.md` e `scripts/bump-version.mjs`, no formato do SM Report Studio.
- Regra no `AGENTS.md`: a IA sobe o BUILD a cada pedido.
