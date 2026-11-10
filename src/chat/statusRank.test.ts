import { mergeStatus } from './statusRank';

describe('mergeStatus', () => {
  it('só avança na cadeia enviando → lido', () => {
    expect(mergeStatus('sent', 'delivered')).toBe('delivered');
    expect(mergeStatus('read', 'sent')).toBe('read');
    expect(mergeStatus('sending', 'read')).toBe('read');
  });

  it('aceita erro a partir de qualquer status', () => {
    expect(mergeStatus('delivered', 'error')).toBe('error');
    expect(mergeStatus('error', 'read')).toBe('error');
  });
});
