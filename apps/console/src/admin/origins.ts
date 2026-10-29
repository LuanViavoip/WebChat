export type OriginsResult = { ok: true; origins: string[] } | { ok: false; message: string };

/**
 * Uma origem por linha. Normaliza para `esquema://host[:porta]` (sem caminho nem barra final)
 * e remove repetidas. O limite de 20 espelha o schema do protocolo.
 */
export function parseOrigins(text: string): OriginsResult {
  const origins: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let url: URL;
    try {
      url = new URL(line);
    } catch {
      return { ok: false, message: `“${line}” não é uma URL válida (ex.: https://www.empresa.com.br).` };
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return { ok: false, message: `“${line}” precisa começar com https:// ou http://.` };
    }
    if (!origins.includes(url.origin)) origins.push(url.origin);
  }
  if (origins.length > 20) return { ok: false, message: 'No máximo 20 origens.' };
  return { ok: true, origins };
}
