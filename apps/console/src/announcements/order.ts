import type { Announcement } from '@viavoip/protocol';

/** Fixados primeiro; dentro de cada grupo, os mais recentes primeiro. Arquivados vão para o fim. */
export function orderAnnouncements(items: Announcement[]): Announcement[] {
  const rank = (item: Announcement) => (item.archivedAt ? 2 : item.pinned ? 0 : 1);
  return [...items].sort((left, right) => rank(left) - rank(right) || right.publishedAt.localeCompare(left.publishedAt));
}
