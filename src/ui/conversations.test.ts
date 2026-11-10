import { CLIENT_CONVERSATIONS, filterConversations } from './conversations';

describe('filterConversations', () => {
  it('não inclui conversas de demonstração no filtro Não lidas', () => {
    const unread = filterConversations(CLIENT_CONVERSATIONS, '', 'unread', 'preview');
    expect(unread).toEqual([]);
    expect(CLIENT_CONVERSATIONS.filter((item) => item.demo).every((item) => item.unread === 0)).toBe(true);
  });

  it('mostra os itens de demonstração no filtro Tudo', () => {
    const all = filterConversations(CLIENT_CONVERSATIONS, '', 'all', 'preview');
    expect(all.map((item) => item.title)).toEqual([
      'ICS Pré-atendimento',
      'Atendimento anterior',
      'Exames e vacinas',
    ]);
    expect(all.filter((item) => item.demo)).toHaveLength(2);
  });
});
