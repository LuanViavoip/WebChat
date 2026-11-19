import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { asConversationId } from '@viavoip/internal-domain';
import { ConversationPicker, type ConversationPickerOption } from './ConversationPicker';

const OPTIONS: ConversationPickerOption[] = [
  { id: asConversationId('c-1'), label: 'Ana Silva', subtitle: 'Ilha Norte', kind: 'direct' },
  { id: asConversationId('c-2'), label: 'Bruno Costa', subtitle: 'Ilha Sul', kind: 'direct' },
  { id: asConversationId('c-3'), label: 'Plantão Geral', kind: 'group' },
  {
    id: asConversationId('c-4'),
    label: 'Grupo Encerrado',
    kind: 'group',
    disabledReason: 'Você não participa mais deste grupo.',
  },
  { id: asConversationId('c-5'), label: 'Carlos Lima', kind: 'direct' },
  { id: asConversationId('c-6'), label: 'Daniela Rocha', kind: 'direct' },
  { id: asConversationId('c-7'), label: 'Equipe Sul', kind: 'group' },
];

describe('ConversationPicker', () => {
  it('inicia com foco na busca, filtra por nome/subtítulo e preserva seleções', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(<ConversationPicker options={OPTIONS} onConfirm={onConfirm} onCancel={vi.fn()} />);

    const search = screen.getByRole('searchbox', { name: 'Pesquisar conversa' });
    expect(document.activeElement).toBe(search);

    await user.click(screen.getByRole('checkbox', { name: /Ana Silva/i }));
    await user.type(search, 'Plantão');
    expect(screen.queryByRole('checkbox', { name: /Ana Silva/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /Plantão Geral/i }));
    await user.clear(search);
    expect(screen.getByRole('checkbox', { name: /Ana Silva/i })).toBeChecked();

    await user.click(screen.getByRole('button', { name: /Encaminhar \(2\)/i }));
    expect(onConfirm).toHaveBeenCalledWith([asConversationId('c-1'), asConversationId('c-3')]);
  });

  it('suporta navegação e seleção por teclado e fecha com Escape', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(<ConversationPicker options={OPTIONS} onConfirm={vi.fn()} onCancel={onCancel} />);

    const ana = screen.getByRole('checkbox', { name: /Ana Silva/i });
    const bruno = screen.getByRole('checkbox', { name: /Bruno Costa/i });

    ana.focus();
    await user.keyboard(' ');
    expect(ana).toBeChecked();

    fireEvent.keyDown(ana, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(bruno);
    await user.keyboard(' ');
    expect(bruno).toBeChecked();

    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('exibe motivo do item desabilitado via aria-describedby e bloqueia marcação', () => {
    render(<ConversationPicker options={OPTIONS} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    const blocked = screen.getByRole('checkbox', { name: /Grupo Encerrado/i });
    expect(blocked).toBeDisabled();
    expect(blocked).toHaveAccessibleDescription('Você não participa mais deste grupo.');
    expect(screen.getByText('Você não participa mais deste grupo.')).toBeVisible();
  });

  it('bloqueia novos itens ao atingir o limite máximo e libera ao desmarcar', async () => {
    const user = userEvent.setup();
    render(<ConversationPicker options={OPTIONS} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    for (const name of [/Ana Silva/i, /Bruno Costa/i, /Plantão Geral/i, /Carlos Lima/i, /Daniela Rocha/i]) {
      await user.click(screen.getByRole('checkbox', { name }));
    }

    const sixth = screen.getByRole('checkbox', { name: /Equipe Sul/i });
    expect(sixth).toBeDisabled();
    expect(sixth).toHaveAccessibleDescription(/Limite de 5 destinos atingido/i);

    const ana = screen.getByRole('checkbox', { name: /Ana Silva/i });
    expect(ana).not.toBeDisabled();
    await user.click(ana);
    expect(sixth).not.toBeDisabled();
  });
});
