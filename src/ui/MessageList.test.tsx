import { render, screen } from '@testing-library/react';
import type { ChatMessage, TextMessage } from '../domain/message';
import { MessageList } from './MessageList';
import { LOCAL_TENANT_ID, LOCAL_USER_ID, PEER_USER_ID } from '../chat/localIdentity';
import { asConversationId } from '../domain/conversation';
import type { UserId } from '../domain/identity';

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
    id,
    tenantId: LOCAL_TENANT_ID,
    conversationId: asConversationId('c'),
    authorId,
    author,
    timestamp,
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
      text('a', PEER_USER_ID, AGENT, '2026-11-10T10:00:00.000Z', 'primeiro colega'),
      text('b', PEER_USER_ID, AGENT, '2026-11-10T10:00:10.000Z', 'segundo colega'),
      text('c', LOCAL_USER_ID, CLIENT, '2026-11-10T10:00:20.000Z', 'cliente'),
      text('d', PEER_USER_ID, AGENT, '2026-11-11T10:00:00.000Z', 'outro dia'),
    ];
    render(
      <MessageList messages={messages} selfId={LOCAL_USER_ID} typing={{ isTyping: false, actorName: '' }} />,
    );

    expect(bubble(/primeiro colega/)).toHaveClass('has-tail');
    expect(bubble(/segundo colega/)).not.toHaveClass('has-tail');
    expect(bubble(/^Você: cliente$/)).toHaveClass('has-tail');
    expect(bubble(/outro dia/)).toHaveClass('has-tail');
  });
});
