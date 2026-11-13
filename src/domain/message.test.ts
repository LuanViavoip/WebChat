import { previewOf, type ChatMessage, type TextMessage } from './message';

const base = {
  id: '1',
  conversationId: 'c',
  direction: 'agent' as const,
  author: { id: 'a', name: 'Colega' },
  timestamp: '2026-11-10T12:00:00.000Z',
  status: 'delivered' as const,
};

describe('previewOf', () => {
  it('devolve o texto da mensagem de texto', () => {
    const message: TextMessage = { ...base, type: 'text', text: 'Olá' };
    expect(previewOf(message)).toBe('Olá');
  });

  it('usa a legenda da foto quando existe', () => {
    const image: ChatMessage = { ...base, type: 'image', mimeType: 'image/jpeg', url: '/x', caption: 'foto' };
    expect(previewOf(image)).toBe('foto');
  });

  it('usa Foto quando a imagem não tem legenda', () => {
    const image: ChatMessage = { ...base, type: 'image', mimeType: 'image/png', url: '/x' };
    expect(previewOf(image)).toBe('Foto');
  });

  it('usa Áudio para mensagens de áudio', () => {
    const audio: ChatMessage = { ...base, type: 'audio', mimeType: 'audio/mpeg', url: '/x' };
    expect(previewOf(audio)).toBe('Áudio');
  });

  it('usa a legenda do vídeo quando existe', () => {
    const video: ChatMessage = { ...base, type: 'video', mimeType: 'video/mp4', url: '/x', caption: 'consulta' };
    expect(previewOf(video)).toBe('consulta');
  });

  it('usa Vídeo quando o vídeo não tem legenda', () => {
    const video: ChatMessage = { ...base, type: 'video', mimeType: 'video/mp4', url: '/x' };
    expect(previewOf(video)).toBe('Vídeo');
  });

  it('usa o nome do arquivo no documento', () => {
    const doc: ChatMessage = {
      ...base,
      type: 'document',
      mimeType: 'application/pdf',
      url: '/x',
      fileName: 'guia.pdf',
    };
    expect(previewOf(doc)).toBe('guia.pdf');
  });

  it('usa Figurinha para sticker', () => {
    const sticker: ChatMessage = { ...base, type: 'sticker', mimeType: 'image/webp', url: '/x' };
    expect(previewOf(sticker)).toBe('Figurinha');
  });
});
