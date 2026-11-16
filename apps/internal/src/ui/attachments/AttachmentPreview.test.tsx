import { StrictMode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { validateFiles } from '@viavoip/internal-domain';
import { AttachmentPreview } from './AttachmentPreview';

function attach(name: string, type: string) {
  const result = validateFiles([new File([new Uint8Array(12)], name, { type })]);
  if (!result?.ok) {
    throw new Error('anexo inválido');
  }
  return result.attachment;
}

describe('AttachmentPreview', () => {
  it('foca a legenda em imagem e envia com Enter', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(
      <AttachmentPreview
        attachment={attach('foto.png', 'image/png')}
        initialCaption="rascunho"
        onSend={onSend}
        onCancel={vi.fn()}
        disabled={false}
      />,
    );
    const caption = screen.getByLabelText('Legenda');
    expect(caption).toHaveFocus();
    expect(caption).toHaveAttribute('maxLength', '1024');
    expect(caption).toHaveValue('rascunho');
    await user.type(caption, '{Enter}');
    expect(onSend).toHaveBeenCalledWith('rascunho');
  });

  it('Shift+Enter quebra linha e IME não envia', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(
      <AttachmentPreview
        attachment={attach('foto.png', 'image/png')}
        initialCaption=""
        onSend={onSend}
        onCancel={vi.fn()}
        disabled={false}
      />,
    );
    const caption = screen.getByLabelText('Legenda');
    await user.type(caption, 'linha 1{Shift>}{Enter}{/Shift}linha 2');
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(caption, { key: 'Enter', isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('Esc cancela e áudio não mostra legenda; foca Enviar', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <button type="button" aria-label="Anexar arquivo">
        clip
      </button>,
    );
    render(
      <AttachmentPreview
        attachment={attach('voz.mp3', 'audio/mpeg')}
        initialCaption="nao"
        onSend={vi.fn()}
        onCancel={onCancel}
        disabled={false}
      />,
    );
    expect(screen.queryByLabelText('Legenda')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
  });

  it('não usa object URL já revogada no preview sob StrictMode', () => {
    const created: string[] = [];
    const revoked: string[] = [];
    const originalCreate = URL.createObjectURL.bind(URL);
    const originalRevoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = originalCreate(blob);
      created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      revoked.push(url);
      originalRevoke(url);
    };
    try {
      render(
        <StrictMode>
          <AttachmentPreview
            attachment={attach('exame.png', 'image/png')}
            initialCaption=""
            onSend={() => {}}
            onCancel={() => {}}
            disabled={false}
          />
        </StrictMode>,
      );
      const img = screen.getByRole('img', { name: /Pré-visualização de exame.png/ });
      const src = img.getAttribute('src') ?? '';
      expect(revoked).not.toContain(src);
      const orphan = created.filter((url) => url !== src && !revoked.includes(url));
      expect(orphan).toEqual([]);
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  it('trunca a legenda inicial em 1024 caracteres', () => {
    render(
      <AttachmentPreview
        attachment={attach('foto.png', 'image/png')}
        initialCaption={'x'.repeat(1500)}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        disabled={false}
      />,
    );
    expect(screen.getByLabelText('Legenda')).toHaveValue('x'.repeat(1024));
  });

  it('documento não mostra legenda', () => {
    render(
      <AttachmentPreview
        attachment={attach('guia.pdf', 'application/pdf')}
        initialCaption=""
        onSend={vi.fn()}
        onCancel={vi.fn()}
        disabled={false}
      />,
    );
    expect(screen.queryByLabelText('Legenda')).not.toBeInTheDocument();
    expect(screen.getByText('guia.pdf')).toBeInTheDocument();
  });
});
