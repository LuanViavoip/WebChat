import type { ObjectUrlFactory } from '../transport/objectUrls';

export function createFakeObjectUrls(): ObjectUrlFactory & {
  created: string[];
  revoked: string[];
} {
  const created: string[] = [];
  const revoked: string[] = [];
  let seq = 0;
  return {
    created,
    revoked,
    create() {
      seq += 1;
      const url = `blob:fake/${String(seq)}`;
      created.push(url);
      return url;
    },
    revoke(url) {
      revoked.push(url);
    },
  };
}
