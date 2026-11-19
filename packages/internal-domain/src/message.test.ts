import { expect, it } from 'vitest';
import { asConversationId } from './conversation';
import { previewOf, type SystemMessage } from './message';
import { T1, uid } from './testing/domainFixtures';

it('usa o texto da mensagem de sistema como prévia', () => {
  const message: SystemMessage = { id: 's1', tenantId: T1, conversationId: asConversationId('g'), actorId: uid('sup-1'), timestamp: '2026-11-17T12:00:00.000Z', status: 'sent', type: 'system', action: 'created', text: 'Grupo criado' };
  expect(previewOf(message)).toBe('Grupo criado');
});
