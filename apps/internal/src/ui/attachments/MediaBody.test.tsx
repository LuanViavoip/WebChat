import { asIsoInstant, asMessageId } from '@viavoip/internal-domain';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AudioMessage, DocumentMessage, ImageMessage, StickerMessage, VideoMessage } from '@viavoip/internal-domain';
import { MediaBody } from './MediaBody';
import { ICS_TENANT_ID, ICS_USERS } from '../../transport/mock/seed';
import { asConversationId } from '@viavoip/internal-domain';

const base = {
  id: asMessageId('m1'),
  tenantId: ICS_TENANT_ID,
  conversationId: asConversationId('c'),
  authorId: ICS_USERS.carla,
  author: { id: 'client', name: 'Você' },
  timestamp: asIsoInstant('2026-11-10T12:00:00.000Z'),
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

  it('abre o visualizador com o nome de download derivado do MIME, não foto.jpg fixo', async () => {
    const user = userEvent.setup();
    const onOpenImage = vi.fn();
    const png: ImageMessage = { ...base, type: 'image', mimeType: 'image/png', url: '/x.png' };
    const { rerender } = render(<MediaBody message={png} onOpenImage={onOpenImage} />);
    await user.click(screen.getByRole('button', { name: 'Abrir foto em tela cheia' }));
    expect(onOpenImage.mock.calls[0]?.[0]).toMatchObject({ fileName: 'foto.png' });
    expect(onOpenImage.mock.calls[0]?.[0].fileName).not.toBe('foto.jpg');

    onOpenImage.mockClear();
    const jpeg: ImageMessage = { ...base, type: 'image', mimeType: 'image/jpeg', url: '/x.jpg' };
    rerender(<MediaBody message={jpeg} onOpenImage={onOpenImage} />);
    await user.click(screen.getByRole('button', { name: 'Abrir foto em tela cheia' }));
    expect(onOpenImage.mock.calls[0]?.[0]).toMatchObject({ fileName: 'foto.jpg' });
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
