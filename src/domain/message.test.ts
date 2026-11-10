import { textOf, type ChatMessage, type TextMessage } from './message';

const base = {
  id: '1',
  conversationId: 'c',
  direction: 'bot' as const,
  author: { id: 'b', name: 'Bot' },
  timestamp: '2026-11-10T12:00:00.000Z',
  status: 'delivered' as const,
};

describe('textOf', () => {
  it('devolve o texto da mensagem de texto', () => {
    const message: TextMessage = { ...base, type: 'text', text: 'Olá' };
    expect(textOf(message)).toBe('Olá');
  });

  it('usa legenda ou nome do arquivo nos tipos futuros', () => {
    const image: ChatMessage = { ...base, type: 'image', mimeType: 'image/jpeg', url: '/x', caption: 'foto' };
    const doc: ChatMessage = {
      ...base,
      type: 'document',
      mimeType: 'application/pdf',
      url: '/x',
      fileName: 'guia.pdf',
    };
    expect(textOf(image)).toBe('foto');
    expect(textOf(doc)).toBe('guia.pdf');
  });
});
