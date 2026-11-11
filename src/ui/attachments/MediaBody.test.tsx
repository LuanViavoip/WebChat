import { render, screen } from '@testing-library/react';
import type { AudioMessage, DocumentMessage, ImageMessage, StickerMessage, VideoMessage } from '../../domain/message';
import { MediaBody } from './MediaBody';

const base = {
  id: 'm1',
  conversationId: 'c',
  direction: 'client' as const,
  author: { id: 'client', name: 'Você' },
  timestamp: '2026-11-10T12:00:00.000Z',
  status: 'sent' as const,
};

describe('MediaBody', () => {
  it('imagem tem botão de tela cheia e alt com legenda', () => {
    const message: ImageMessage = { ...base, type: 'image', mimeType: 'image/png', url: '/x.png', caption: 'rx' };
    render(<MediaBody message={message} />);
    expect(screen.getByRole('button', { name: 'Abrir foto em tela cheia' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'rx' })).toBeInTheDocument();
  });

  it('imagem sem legenda usa Foto de autor', () => {
    const message: ImageMessage = { ...base, type: 'image', mimeType: 'image/png', url: '/x.png' };
    render(<MediaBody message={message} />);
    expect(screen.getByRole('img', { name: 'Foto de Você' })).toBeInTheDocument();
  });

  it('áudio e vídeo têm controles nativos', () => {
    const audio: AudioMessage = { ...base, type: 'audio', mimeType: 'audio/mpeg', url: '/a.mp3' };
    const video: VideoMessage = { ...base, type: 'video', mimeType: 'video/mp4', url: '/v.mp4' };
    const { rerender } = render(<MediaBody message={audio} />);
    expect(screen.getByLabelText('Áudio de Você')).toHaveAttribute('controls');
    rerender(<MediaBody message={video} />);
    expect(screen.getByLabelText('Vídeo de Você')).toHaveAttribute('controls');
  });

  it('documento tem download com EXT e tamanho, e omite tamanho se ausente', () => {
    const withSize: DocumentMessage = {
      ...base,
      type: 'document',
      fileName: 'guia.pdf',
      mimeType: 'application/pdf',
      url: '/g.pdf',
      sizeBytes: 2048,
    };
    const { rerender } = render(<MediaBody message={withSize} />);
    expect(screen.getByRole('link', { name: 'Baixar guia.pdf, PDF, 2,0 KB' })).toHaveAttribute('download', 'guia.pdf');
    const noSize: DocumentMessage = {
      ...base,
      type: 'document',
      fileName: 'guia.pdf',
      mimeType: 'application/pdf',
      url: '/g.pdf',
    };
    rerender(<MediaBody message={noSize} />);
    expect(screen.getByRole('link', { name: 'Baixar guia.pdf, PDF' })).toBeInTheDocument();
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });

  it('sticker mantém o aviso', () => {
    const message: StickerMessage = { ...base, type: 'sticker', mimeType: 'image/webp', url: '/s.webp' };
    render(<MediaBody message={message} />);
    expect(screen.getByText('Mensagem de sticker ainda não suportada nesta etapa.')).toBeInTheDocument();
  });

  it('upload failed mostra alerta e esconde Reenviar genérico no UploadStatus', () => {
    const message: ImageMessage = { ...base, type: 'image', mimeType: 'image/png', url: '/x.png', status: 'error' };
    render(
      <MediaBody
        message={message}
        upload={{ phase: 'failed', message: 'Falha ao enviar exame.png.', fileName: 'exame.png' }}
        onCancelUpload={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Falha ao enviar exame.png.');
    expect(screen.getByRole('button', { name: 'Tentar enviar exame.png de novo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descartar exame.png' })).toBeInTheDocument();
  });

  it('uploading mostra progress e cancelar', () => {
    const message: ImageMessage = { ...base, type: 'image', mimeType: 'image/png', url: '/x.png', status: 'sending' };
    render(
      <MediaBody
        message={message}
        upload={{ phase: 'uploading', loaded: 20, total: 100, fileName: 'exame.png' }}
        onCancelUpload={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    const bar = screen.getByRole('progressbar', { name: 'Enviando exame.png' });
    expect(bar).toHaveAttribute('value', '20');
    expect(bar).toHaveAttribute('max', '100');
    expect(screen.getByRole('button', { name: 'Cancelar envio de exame.png' })).toBeInTheDocument();
  });
});
