import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { validateFiles } from '../../domain/attachment';
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
