export type RouteSlugs<T extends string> = Record<T, string>;

export function routeHash<T extends string>(route: T, slugs: RouteSlugs<T>): string {
  return `#/${slugs[route]}`;
}

/**
 * Converte `#/slug` na rota correspondente. Hash vazio, desconhecido ou fora da lista
 * permitida (por exemplo, uma seção de outro papel) cai na rota padrão.
 */
export function parseHashRoute<T extends string>(
  hash: string,
  slugs: RouteSlugs<T>,
  allowed: readonly T[],
  fallback: T,
): T {
  const slug = hash.replace(/^#\/?/, '').split(/[/?]/, 1)[0] ?? '';
  for (const route of allowed) {
    if (slugs[route] === slug) return route;
  }
  return fallback;
}
