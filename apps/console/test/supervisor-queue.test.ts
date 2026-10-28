import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QueueColumn } from '../src/desk/QueueColumn.js';
import { upsertConversation } from '../src/desk/state.js';
import type { ConversationSummary } from '@viavoip/protocol';

describe('lista de atendimentos da supervisão', () => {
  it('mostra atendimento de outro agente e encerrado com status, agente e espera', () => {
    const conversation: ConversationSummary = {
      id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa1', status: 'assigned',
      queueId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa2', queueName: 'Suporte',
      visitorId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa3', visitorDisplayName: 'Cliente',
      agentId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa4', agentName: 'Ana', dispositionId: null,
      createdAt: '2026-10-28T12:00:00.000Z', queuedAt: '2026-10-28T12:00:00.000Z',
      assignedAt: '2026-10-28T12:01:00.000Z', endedAt: null,
    };
    const html = renderToStaticMarkup(createElement(QueueColumn, {
      queues: [{ id: conversation.queueId, name: 'Suporte' }],
      conversations: [conversation, { ...conversation, id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa5', status: 'closed', visitorDisplayName: 'Cliente encerrado', endedAt: '2026-10-28T12:02:00.000Z' }],
      messages: {}, cursors: {}, selectedId: null, selfId: 'outro', now: Date.parse('2026-10-28T12:02:00.000Z'),
      active: true, onSelect: () => {}, supervisory: true,
    }));
    expect(html).toContain('Cliente encerrado');
    expect(html).toContain('Em atendimento');
    expect(html).toContain('Ana');
    expect(html).toContain('Espera 1 min');
    const closed = { ...conversation, status: 'closed' as const, endedAt: '2026-10-28T12:02:00.000Z' };
    expect(upsertConversation([conversation], closed, true)).toEqual([closed]);
  });
});
