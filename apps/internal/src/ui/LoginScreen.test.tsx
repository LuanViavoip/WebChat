import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MockTransport } from '../transport/mock/MockTransport';
import { ICS_ILHAS } from '../transport/mock/seed';
import { LoginScreen } from './LoginScreen';

const SERVER = new MockTransport().loginGroups();

describe('LoginScreen', () => {
  it('tem o título Entrar como e um grupo por empresa', () => {
    render(<LoginScreen groups={SERVER} onPick={() => undefined} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Entrar como' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'ICS Saúde',
      'Clínica Boa Vista',
    ]);
  });

  it('lista os usuários de cada empresa com nome e role em português', () => {
    render(<LoginScreen groups={SERVER} onPick={() => undefined} />);
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
    render(<LoginScreen groups={SERVER} onPick={onPick} />);
    await user.click(screen.getByRole('button', { name: /Rui Cardoso/ }));
    expect(onPick).toHaveBeenCalledWith('bv-rui');
  });

  it('Tab alcança o primeiro usuário (botões nativos, foco por teclado)', async () => {
    const user = userEvent.setup();
    render(<LoginScreen groups={SERVER} onPick={() => undefined} />);
    await user.tab();
    expect(screen.getByRole('button', { name: /Marcos Dono/ })).toHaveFocus();
  });

  it('mostra o aviso (conta desativada) como alerta e some quando não há aviso', () => {
    const { rerender } = render(<LoginScreen groups={SERVER} onPick={() => undefined} notice="Sua conta foi desativada. Fale com o administrador." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Sua conta foi desativada. Fale com o administrador.');
    rerender(<LoginScreen groups={SERVER} onPick={() => undefined} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('usuário desativado não é listado; cadastrado depois aparece (a lista é a do servidor, não a da seed)', () => {
    const [ics, ...rest] = SERVER;
    if (!ics) {
      throw new Error('seed');
    }
    const [first, ...others] = ics.users;
    if (!first) {
      throw new Error('seed');
    }
    const novo = { ...first, id: 'ics-novo' as typeof first.id, name: 'Zélia Nova', role: 'agent' as const, ilhaIds: [ICS_ILHAS.sul] as const };
    const groups = [{ ...ics, users: [{ ...first, active: false }, ...others, novo] }, ...rest];
    render(<LoginScreen groups={groups} onPick={() => undefined} />);
    const list = within(screen.getByRole('region', { name: 'ICS Saúde' }));
    expect(list.queryByRole('button', { name: /Marcos Dono/ })).not.toBeInTheDocument();
    expect(list.getByRole('button', { name: 'Zélia Nova Agente' })).toBeInTheDocument();
    expect(list.getAllByRole('button')).toHaveLength(9);
  });
});
