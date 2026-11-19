export function parseNowParam(search: string): string | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const raw = params.get('agora');
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return new Date(timestamp).toISOString();
}

export function createClockFromSearch(search: string): () => string {
  const fixed = parseNowParam(search);
  if (fixed !== null) {
    return () => fixed;
  }
  return () => new Date().toISOString();
}
