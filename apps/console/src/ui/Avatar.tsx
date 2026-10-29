export function initials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (!first) return '?';
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  const letters = [first, last].flatMap((word) => (word ? [Array.from(word)[0] ?? ''] : []));
  return letters.join('').toLocaleUpperCase('pt-BR');
}

export function Avatar({ name, size = 36, group = false }: { name: string | null | undefined; size?: number; group?: boolean }) {
  return (
    <span
      className={group ? 'ui-avatar ui-avatar--group' : 'ui-avatar'}
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.36)) }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
