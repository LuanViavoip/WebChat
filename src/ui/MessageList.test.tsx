import { render, screen } from '@testing-library/react';
import type { ChatMessage, TextMessage } from '../domain/message';
import { MessageList } from './MessageList';

const AGENT = { id: 'agent', name: 'Colega' };
const CLIENT = { id: 'client', name: 'Você' };

function text(
  id: string,
  direction: TextMessage['direction'],
  author: TextMessage['author'],
  timestamp: string,
  body: string,
): TextMessage {
  return {
    id,
    conversationId: 'c',
    direction,
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
      text('a', 'agent', AGENT, '2026-11-10T10:00:00.000Z', 'primeiro colega'),
      text('b', 'agent', AGENT, '2026-11-10T10:00:10.000Z', 'segundo colega'),
      text('c', 'client', CLIENT, '2026-11-10T10:00:20.000Z', 'cliente'),
      text('d', 'agent', AGENT, '2026-11-11T10:00:00.000Z', 'outro dia'),
    ];
    render(
      <MessageList messages={messages} typing={{ isTyping: false, actorName: '' }} />,
    );

    expect(bubble(/primeiro colega/)).toHaveClass('has-tail');
    expect(bubble(/segundo colega/)).not.toHaveClass('has-tail');
    expect(bubble(/^Você: cliente$/)).toHaveClass('has-tail');
    expect(bubble(/outro dia/)).toHaveClass('has-tail');
  });
});
