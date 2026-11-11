import { CLIENT_CONVERSATIONS, emptyConversationCopy, filterConversations, LIVE_CONVERSATION_ID } from './conversations';

describe('filterConversations', () => {
  it('não inclui conversas lidas no filtro Não lidas', () => {
    const unread = filterConversations(CLIENT_CONVERSATIONS, '', 'unread', 'preview');
    expect(unread).toEqual([]);
    expect(CLIENT_CONVERSATIONS.every((item) => item.unread === 0)).toBe(true);
  });

  it('mostra as três conversas no filtro Tudo', () => {
    const all = filterConversations(CLIENT_CONVERSATIONS, '', 'all', 'preview');
    expect(all.map((item) => item.title)).toEqual([
      'ICS Pré-atendimento',
      'Atendimento anterior',
      'Exames e vacinas',
    ]);
  });

  it('cada conversa de histórico tem transcrição mock', () => {
    const history = CLIENT_CONVERSATIONS.filter((item) => item.id !== LIVE_CONVERSATION_ID);
    expect(history).toHaveLength(2);
    for (const item of history) {
      expect(item.transcript.length).toBeGreaterThan(2);
    }
  });
});

describe('emptyConversationCopy', () => {
  it('usa Nenhum resultado encontrado quando a busca não acha nada', () => {
    expect(emptyConversationCopy('all', 'xyz')).toBe('Nenhum resultado encontrado');
    expect(emptyConversationCopy('unread', 'xyz')).toBe('Nenhum resultado encontrado');
  });

  it('usa Nenhuma conversa não lida só no filtro Não lidas sem busca', () => {
    expect(emptyConversationCopy('unread', '')).toBe('Nenhuma conversa não lida');
    expect(emptyConversationCopy('unread', '   ')).toBe('Nenhuma conversa não lida');
  });
});
