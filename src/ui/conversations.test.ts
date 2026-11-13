import {
  CLIENT_CONVERSATIONS,
  emptyConversationCopy,
  filterConversations,
  LIVE_CONVERSATION_ID,
} from './conversations';
import { pinsLiveConversation } from './liveActivity';

describe('filterConversations', () => {
  it('não inclui conversas lidas no filtro Não lidas', () => {
    const unread = filterConversations(CLIENT_CONVERSATIONS, '', 'unread', 'preview');
    expect(unread).toEqual([]);
    expect(CLIENT_CONVERSATIONS.every((item) => item.unread === 0)).toBe(true);
  });

  it('mostra a conversa de teste no filtro Tudo', () => {
    const all = filterConversations(CLIENT_CONVERSATIONS, '', 'all', 'preview');
    expect(all.map((item) => item.title)).toEqual(['Conversa de teste']);
  });

  it('mantém a conversa ao vivo quando a busca não casa e ela está pinada', () => {
    const filtered = filterConversations(CLIENT_CONVERSATIONS, 'zzzz-inexistente', 'all', 'preview', {
      pinLive: true,
    });
    expect(filtered.map((item) => item.id)).toEqual([LIVE_CONVERSATION_ID]);
  });
});

describe('pinsLiveConversation', () => {
  it('pina erro e mensagem não vista', () => {
    expect(pinsLiveConversation('error')).toBe(true);
    expect(pinsLiveConversation('unseen')).toBe(true);
    expect(pinsLiveConversation('idle')).toBe(false);
    expect(pinsLiveConversation('connecting')).toBe(false);
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
