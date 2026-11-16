import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ACCEPT_ATTRIBUTE } from '@viavoip/internal-domain';
import { Composer } from './Composer';

function Harness({
  onSend = vi.fn(),
  disabled = false,
  onPickFiles,
}: {
  onSend?: (text: string) => void;
  disabled?: boolean;
  onPickFiles?: (files: File[]) => void;
}) {
  const [value, setValue] = useState('');
  return (
    <Composer
      value={value}
      onChange={setValue}
      onSend={onSend}
      disabled={disabled}
      {...(onPickFiles ? { onPickFiles } : {})}
    />
  );
}

describe('Composer', () => {
  it('mostra microfone desabilitado e troca para enviar ao digitar', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Gravar áudio (em breve)' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Enviar' })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Mensagem'), 'oi');
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Gravar áudio (em breve)' })).not.toBeInTheDocument();
  });

  it('envia o texto pelo botão e limpa o campo', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    const field = screen.getByLabelText('Mensagem');
    await user.type(field, 'Olá equipe');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(onSend).toHaveBeenCalledWith('Olá equipe');
    expect(field).toHaveValue('');
  });

  it('Enter envia e Shift+Enter quebra a linha', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    const field = screen.getByLabelText('Mensagem');
    await user.type(field, 'linha 1{Shift>}{Enter}{/Shift}linha 2');
    expect(onSend).not.toHaveBeenCalled();
    expect(field).toHaveValue('linha 1\nlinha 2');
    await user.type(field, '{Enter}');
    expect(onSend).toHaveBeenCalledWith('linha 1\nlinha 2');
  });

  it('não envia Enter enquanto o IME está compondo', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    const field = screen.getByLabelText('Mensagem');
    await user.type(field, 'oi');
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('insere emoji na posição do cursor', async () => {
    const user = userEvent.setup();
    render(<Harness />);
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

  it('substitui a seleção ao inserir emoji', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const field = screen.getByRole('textbox', { name: 'Mensagem' });
    if (!(field instanceof HTMLTextAreaElement)) {
      throw new Error('esperava textarea');
    }
    await user.type(field, 'hello');
    field.setSelectionRange(1, 4);
    await user.click(screen.getByRole('button', { name: 'Abrir seletor de emojis' }));
    await user.click(screen.getByRole('option', { name: 'Emoji 💚' }));
    expect(field).toHaveValue('h💚o');
  });

  it('navega o listbox de emojis com setas e confirma com Enter', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const field = screen.getByRole('textbox', { name: 'Mensagem' });
    await user.click(screen.getByRole('button', { name: 'Abrir seletor de emojis' }));
    const listbox = screen.getByRole('listbox', { name: 'Seletor de emojis' });
    listbox.focus();
    await user.keyboard('{ArrowRight}{Enter}');
    expect(field).toHaveValue('😁');
  });

  it('habilita Anexar arquivo e desabilita com disabled', () => {
    const { rerender } = render(<Harness onPickFiles={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Anexar arquivo' })).toBeEnabled();
    rerender(<Harness onPickFiles={vi.fn()} disabled />);
    expect(screen.getByRole('button', { name: 'Anexar arquivo' })).toBeDisabled();
  });

  it('o input file usa ACCEPT_ATTRIBUTE e dispara onPickFiles, inclusive o mesmo arquivo duas vezes', async () => {
    const user = userEvent.setup();
    const onPickFiles = vi.fn();
    render(<Harness onPickFiles={onPickFiles} />);
    const input = document.querySelector('input[type="file"]');
    expect(input).toHaveAttribute('accept', ACCEPT_ATTRIBUTE);
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('esperava input file');
    }
    const file = new File([new Uint8Array(8)], 'foto.png', { type: 'image/png' });
    await user.upload(input, file);
    await user.upload(input, file);
    expect(onPickFiles).toHaveBeenCalledTimes(2);
  });
});
