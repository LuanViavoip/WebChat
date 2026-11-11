import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImageViewer } from './ImageViewer';

describe('ImageViewer', () => {
  it('abre com foco em Fechar, Esc e Fechar encerram e devolvem o foco', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    function Harness({ open }: { open: boolean }) {
      return (
        <>
          <button type="button" aria-label="Abrir foto em tela cheia">
            mini
          </button>
          <ImageViewer
            image={open ? { url: '/x.png', alt: 'rx', fileName: 'foto.png' } : null}
            onClose={onClose}
          />
        </>
      );
    }
    const { rerender } = render(<Harness open />);
    const dialog = screen.getByRole('dialog', { name: 'Foto em tela cheia' });
    expect(dialog).toBeVisible();
    expect(screen.getByRole('button', { name: 'Fechar foto' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
    rerender(<Harness open={false} />);
    onClose.mockClear();
    rerender(<Harness open />);
    await user.click(screen.getByRole('button', { name: 'Fechar foto' }));
    expect(onClose).toHaveBeenCalled();
  });
});
