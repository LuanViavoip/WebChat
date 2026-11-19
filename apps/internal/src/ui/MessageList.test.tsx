import { asIsoInstant, asMessageId } from '@viavoip/internal-domain';
import { render, screen } from '@testing-library/react';
import type { ChatMessage, TextMessage } from '@viavoip/internal-domain';
import { MessageList } from './MessageList';
import { ICS_TENANT_ID, ICS_USERS } from '../transport/mock/seed';
import { asConversationId } from '@viavoip/internal-domain';
import type { UserId } from '@viavoip/internal-domain';

const AGENT = { id: 'agent', name: 'Colega' };
const CLIENT = { id: 'client', name: 'Você' };

function text(
  id: string,
  authorId: UserId,
  author: TextMessage['author'],
  timestamp: string,
  body: string,
): TextMessage {
  return {
    id: asMessageId(id),
    tenantId: ICS_TENANT_ID,
    conversationId: asConversationId('c'),
    authorId,
    author,
    timestamp: asIsoInstant(timestamp),
    status: 'read',
    type: 'text',
    text: body,
  };
}

function bubble(name: string | RegExp): HTMLElement {
  const node = screen.getByLabelText(name);
  if (!(node instanceof HTMLElement)) {
    throw new Error(`balão ausente: ${String(name)}`);
  }
  return node;
}

describe('MessageList caudas', () => {
  it('marca só a primeira mensagem de um grupo consecutivo', () => {
    const messages: ChatMessage[] = [
      text('a', ICS_USERS.bruno, AGENT, '2026-11-10T10:00:00.000Z', 'primeiro colega'),
      text('b', ICS_USERS.bruno, AGENT, '2026-11-10T10:00:10.000Z', 'segundo colega'),
      text('c', ICS_USERS.carla, CLIENT, '2026-11-10T10:00:20.000Z', 'cliente'),
      text('d', ICS_USERS.bruno, AGENT, '2026-11-11T10:00:00.000Z', 'outro dia'),
    ];
    render(
      <MessageList messages={messages} selfId={ICS_USERS.carla} typing={{ activity: 'idle', actorName: '' }} />,
    );

    expect(bubble(/primeiro colega/)).toHaveClass('has-tail');
    expect(bubble(/segundo colega/)).not.toHaveClass('has-tail');
    expect(bubble(/^Você: cliente$/)).toHaveClass('has-tail');
    expect(bubble(/outro dia/)).toHaveClass('has-tail');
  });
});
