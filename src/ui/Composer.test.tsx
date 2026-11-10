import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Composer } from './Composer';

describe('Composer', () => {
  it('envia o texto pelo botão e limpa o campo', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<Composer onSend={onSend} disabled={false} />);
    const field = screen.getByLabelText('Mensagem');
    await user.type(field, 'Olá equipe');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(onSend).toHaveBeenCalledWith('Olá equipe');
    expect(field).toHaveValue('');
  });

  it('Enter envia e Shift+Enter quebra a linha', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<Composer onSend={onSend} disabled={false} />);
    const field = screen.getByLabelText('Mensagem');
    await user.type(field, 'linha 1{Shift>}{Enter}{/Shift}linha 2');
    expect(onSend).not.toHaveBeenCalled();
    expect(field).toHaveValue('linha 1\nlinha 2');
    await user.type(field, '{Enter}');
    expect(onSend).toHaveBeenCalledWith('linha 1\nlinha 2');
  });

  it('insere emoji na posição do cursor', async () => {
    const user = userEvent.setup();
    render(<Composer onSend={vi.fn()} disabled={false} />);
    const field = screen.getByRole('textbox', { name: 'Mensagem' });
    if (!(field instanceof HTMLTextAreaElement)) {
      throw new Error('esperava textarea');
    }
    await user.type(field, 'ab');
    field.setSelectionRange(1, 1);
    await user.click(screen.getByRole('button', { name: 'Abrir seletor de emojis' }));
    await user.click(screen.getByRole('option', { name: 'Emoji 💚' }));
    expect(field).toHaveValue('a💚b');
  });
});
