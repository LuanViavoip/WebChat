import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginScreen } from './LoginScreen';

describe('LoginScreen', () => {
  it('tem o título Entrar como e um grupo por empresa', () => {
    render(<LoginScreen onPick={() => undefined} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Entrar como' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'ICS Saúde',
      'Clínica Boa Vista',
    ]);
  });

  it('lista os usuários de cada empresa com nome e role em português', () => {
    render(<LoginScreen onPick={() => undefined} />);
    const ics = within(screen.getByRole('region', { name: 'ICS Saúde' }));
    expect(ics.getAllByRole('button')).toHaveLength(9);
    expect(ics.getByRole('button', { name: 'Marcos Dono Administrador' })).toBeInTheDocument();
    expect(ics.getByRole('button', { name: 'Carla Mendes Supervisor(a)' })).toBeInTheDocument();
    expect(ics.getByRole('button', { name: 'Bruno Costa Agente' })).toBeInTheDocument();
    const bv = within(screen.getByRole('region', { name: 'Clínica Boa Vista' }));
    expect(bv.getAllByRole('button')).toHaveLength(4);
    expect(bv.getByRole('button', { name: 'Paula Teixeira Agente' })).toBeInTheDocument();
    expect(ics.queryByRole('button', { name: /Paula/ })).not.toBeInTheDocument();
  });

  it('clicar entra como aquele usuário', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<LoginScreen onPick={onPick} />);
    await user.click(screen.getByRole('button', { name: /Rui Cardoso/ }));
    expect(onPick).toHaveBeenCalledWith('bv-rui');
  });

  it('Tab alcança o primeiro usuário (botões nativos, foco por teclado)', async () => {
    const user = userEvent.setup();
    render(<LoginScreen onPick={() => undefined} />);
    await user.tab();
    expect(screen.getByRole('button', { name: /Marcos Dono/ })).toHaveFocus();
  });
});
