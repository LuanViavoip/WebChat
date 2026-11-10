import { PendingStatusMap } from './pendingStatus';

describe('PendingStatusMap', () => {
  it('respeita o limite de tamanho, descartando as mais antigas', () => {
    const pending = new PendingStatusMap(2, 60_000, () => 1_000);
    pending.add('a', 'sent');
    pending.add('b', 'delivered');
    pending.add('c', 'read');
    expect(pending.size).toBe(2);
    expect(pending.take(['a'])).toBeUndefined();
    expect(pending.take(['b'])).toBe('delivered');
    expect(pending.take(['c'])).toBe('read');
  });

  it('expira entradas pelo TTL', () => {
    let now = 1_000;
    const pending = new PendingStatusMap(10, 500, () => now);
    pending.add('late', 'read');
    now = 2_000;
    expect(pending.take(['late'])).toBeUndefined();
  });

  it('mescla o maior rank quando o mesmo id recebe dois status', () => {
    const pending = new PendingStatusMap(10, 60_000, () => 1);
    pending.add('x', 'sent');
    pending.add('x', 'read');
    pending.add('x', 'delivered');
    expect(pending.take(['x'])).toBe('read');
  });
});
