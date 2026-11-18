// Gerenciado por scripts/bump-version.mjs. Regra em AGENTS.md ("Versão e notas").
// O trecho entre @bump-begin e @bump-end é JSON válido (aspas duplas): o script lê e regrava.

export type ReleaseNote = {
  readonly version: string;            // "1.0.3", sem zeros à esquerda
  readonly date: string;               // "18/11/2026" (DD/MM/AAAA, America/Sao_Paulo)
  readonly title: string;              // a linha em negrito
  readonly details: readonly string[]; // ≥ 1 item
};

export const APP_BASE_VERSION = '1.0';
export const APP_BUILD_NUMBER = 1;
export const APP_VERSION = `${APP_BASE_VERSION}.${String(APP_BUILD_NUMBER)}`;

/** Do mais novo para o mais antigo, todas as séries. */
export const RELEASE_NOTES_HISTORY: readonly ReleaseNote[] = /* @bump-begin */ [
  {
    "version": "1.0.1",
    "date": "18/11/2026",
    "title": "Sistema de versionamento incremental e release notes do Chat Interno",
    "details": [
      "Criação de `src/version.ts`, `RELEASE_NOTES.md` e `scripts/bump-version.mjs`, no formato do SM Report Studio.",
      "Regra no `AGENTS.md`: a IA sobe o BUILD a cada pedido."
    ]
  }
] /* @bump-end */;
