import { describe, expect, it } from 'vitest';
import { asConversationId } from './conversation';
import { previewOf, type AnnouncementRefMessage, type DeletedMessage, type PollMessage, type SystemMessage } from './message';
import { T1, uid } from './testing/domainFixtures';
import { asAnnouncementId, asIsoInstant, asMessageId, asPollOptionId } from './ids';

describe('previewOf', () => {
  it('usa o texto da mensagem de sistema como prévia', () => {
    const message: SystemMessage = {
      id: asMessageId('s1'),
      tenantId: T1,
      conversationId: asConversationId('g'),
      actorId: uid('sup-1'),
      timestamp: '2026-11-17T12:00:00.000Z',
      status: 'sent',
      type: 'system',
      action: 'created',
      text: 'Grupo criado',
    };
    expect(previewOf(message)).toBe('Grupo criado');
  });

  it('cobre enquete, aviso encaminhado e mensagem apagada', () => {
    const base = {
      id: asMessageId('m1'),
      tenantId: T1,
      conversationId: asConversationId('g'),
      authorId: uid('ag-1'),
      author: { id: 'ag-1', name: 'Agente 1' },
      timestamp: '2026-11-17T12:00:00.000Z',
      status: 'sent' as const,
    };
    const poll: PollMessage = {
      ...base,
      type: 'poll',
      question: 'Almoço às 12h?',
      options: [
        { id: asPollOptionId('o1'), text: 'Sim' },
        { id: asPollOptionId('o2'), text: 'Não' },
      ],
      multiple: false,
      closedAt: null,
    };
    const announcement: AnnouncementRefMessage = {
      ...base,
      type: 'announcement',
      announcementId: asAnnouncementId('av-1'),
    };
    const deleted: DeletedMessage = {
      ...base,
      type: 'deleted',
      deletedAt: asIsoInstant('2026-11-17T12:05:00.000Z'),
    };
    expect(previewOf(poll)).toBe('📊 Almoço às 12h?');
    expect(previewOf(announcement)).toBe('Aviso encaminhado');
    expect(previewOf(deleted)).toBe('Mensagem apagada');
  });
});
