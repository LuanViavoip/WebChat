import { describe, expect, it } from 'vitest';
import { MockSMAdapter, PendingSmContractError, createSMAdapter } from '../src/index.js';

describe('SMAdapter', () => {
  it('entrega o mock e guarda as notificações em memória', async () => {
    const adapter = createSMAdapter('mock');
    expect(adapter).toBeInstanceOf(MockSMAdapter);
    if (!(adapter instanceof MockSMAdapter)) return;
    await adapter.onConversationQueued({
      tenantId: '11111111-1111-4111-8111-111111111111',
      conversationId: 'cccccccc-1111-4111-8111-ccccccccccc1',
      siteId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa1',
      queueId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa2',
    });
    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0]?.method).toBe('onConversationQueued');
  });

  it('recusa qualquer adaptador real enquanto o contrato do SM não existe', () => {
    expect(() => createSMAdapter('viavoip')).toThrow(PendingSmContractError);
    expect(() => createSMAdapter('viavoip')).toThrow(/pendente/);
  });
});
