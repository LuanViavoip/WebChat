import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { stubDesktopMatchMedia } from './test/matchMedia';
import { MockBackend } from './transport/mock/MockBackend';
import { MemoryMockStore } from './transport/mock/MockStore';
import { MockTransport } from './transport/mock/MockTransport';
import { ICS_ILHAS, ICS_TENANT_ID, ICS_USERS } from './transport/mock/seed';
import { SESSION_STORAGE_KEY } from './ui/sessionIdentity';

const instant = { connectMs: 0, sentMs: 0, deliveredMs: 0, readMs: 0 };
const MARCOS = { tenantId: ICS_TENANT_ID, userId: ICS_USERS.marcos };
const MESSAGE = 'Sua conta foi desativada. Fale com o administrador.';

beforeEach(() => {
  stubDesktopMatchMedia();
});

afterEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

async function waitForChat() {
  await waitFor(() => {
    expect(screen.getByRole('textbox', { name: /mensagem/i })).toBeEnabled();
  });
}

/** Cadastrado novo ainda não tem conversa: não há composer, só a lista (e o cabeçalho com o papel). */
async function waitForSidebar() {
  expect(await screen.findByLabelText('Lista de conversas')).toBeInTheDocument();
  expect(await screen.findByText('Agente · ICS Saúde')).toBeInTheDocument();
}

describe('App: conta desativada', () => {
  it('quem está no chat volta ao Entrar como com a mensagem, sem reload, e não aparece mais na lista', async () => {
    const store = new MemoryMockStore();
    const backend = new MockBackend({ store });
    const admin = new MockTransport({ backend, delays: instant });
    await admin.connect(MARCOS);
    window.history.replaceState(null, '', '/?como=ics-bruno');
    const first = render(<App transport={new MockTransport({ backend, delays: instant })} />);
    await waitForChat();

    await act(async () => {
      await admin.deactivateUser({ userId: ICS_USERS.bruno });
    });

    expect(await screen.findByRole('heading', { level: 1, name: 'Entrar como' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(MESSAGE);
    expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(window.location.search).toBe('');
    const ics = within(screen.getByRole('region', { name: 'ICS Saúde' }));
    expect(ics.queryByRole('button', { name: /Bruno Costa/ })).not.toBeInTheDocument();
    expect(ics.getByRole('button', { name: /Ana Souza/ })).toBeInTheDocument();
    expect(ics.getAllByRole('button')).toHaveLength(8);

    // Reativado, volta à lista e entra; a mensagem some.
    await act(async () => {
      await admin.reactivateUser({ userId: ICS_USERS.bruno });
    });
    admin.disconnect();
    first.unmount();
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/?como=ics-bruno');
    render(<App transport={new MockTransport({ backend, delays: instant })} />);
    await waitForChat();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Trocar usuário' }));
    expect(within(screen.getByRole('region', { name: 'ICS Saúde' })).getByRole('button', { name: /Bruno Costa/ })).toBeInTheDocument();
  });

  it('?como= de um usuário já desativado cai no login com a mensagem clara', async () => {
    const backend = new MockBackend({ store: new MemoryMockStore() });
    const admin = new MockTransport({ backend, delays: instant });
    await admin.connect(MARCOS);
    await admin.deactivateUser({ userId: ICS_USERS.bruno });
    window.history.replaceState(null, '', '/?como=ics-bruno');
    render(<App transport={new MockTransport({ backend, delays: instant })} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGE);
    expect(screen.getByRole('heading', { level: 1, name: 'Entrar como' })).toBeInTheDocument();
    admin.disconnect();
  });
});

describe('App: Entrar como lê o estado do servidor', () => {
  it('lista quem foi cadastrado, mesmo depois de recriar o servidor a partir do storage', async () => {
    const store = new MemoryMockStore();
    const first = new MockBackend({ store });
    const admin = new MockTransport({ backend: first, delays: instant });
    await admin.connect(MARCOS);
    const agent = await admin.registerAgent({ name: 'Zélia Cadastrada', ilhaId: ICS_ILHAS.sul });
    const supervisor = await admin.registerSupervisor({ name: 'Sérgio Cadastrado', ilhaIds: [] });
    admin.disconnect();
    first.close();

    const reloaded = new MockBackend({ store });
    render(<App transport={new MockTransport({ backend: reloaded, delays: instant })} />);
    const ics = within(screen.getByRole('region', { name: 'ICS Saúde' }));
    expect(ics.getByRole('button', { name: 'Zélia Cadastrada Agente' })).toBeInTheDocument();
    expect(ics.getByRole('button', { name: 'Sérgio Cadastrado Supervisor(a)' })).toBeInTheDocument();
    expect(ics.getAllByRole('button')).toHaveLength(11);
    expect(within(screen.getByRole('region', { name: 'Clínica Boa Vista' })).getAllByRole('button')).toHaveLength(4);

    const user = userEvent.setup();
    await user.click(ics.getByRole('button', { name: 'Zélia Cadastrada Agente' }));
    await waitForSidebar();
    expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBe(agent.id);
    expect(supervisor.id).not.toBe(agent.id);
    reloaded.close();
  });

  it('um cadastrado entra por ?como= (o id novo vale)', async () => {
    const backend = new MockBackend({ store: new MemoryMockStore() });
    const admin = new MockTransport({ backend, delays: instant });
    await admin.connect(MARCOS);
    const agent = await admin.registerAgent({ name: 'Zélia ComoParam', ilhaId: ICS_ILHAS.norte });
    admin.disconnect();
    window.history.replaceState(null, '', `/?como=${agent.id}`);
    render(<App transport={new MockTransport({ backend, delays: instant })} />);
    await waitForSidebar();
    expect(screen.getByText('Agente · ICS Saúde')).toBeInTheDocument();
  });
});

describe('App: a tela "Entrar como" relê o servidor quando outra aba mexe', () => {
  it('cadastro e desativação feitos em outra aba aparecem ao voltar o foco e com o evento storage', async () => {
    const backend = new MockBackend({ store: new MemoryMockStore() });
    render(<App transport={new MockTransport({ backend, delays: instant })} />);
    const ics = () => within(screen.getByRole('region', { name: 'ICS Saúde' }));
    expect(ics().queryByRole('button', { name: /Zélia Outra Aba/ })).not.toBeInTheDocument();

    const otherTab = new MockTransport({ backend, delays: instant });
    await otherTab.connect(MARCOS);
    await otherTab.registerAgent({ name: 'Zélia Outra Aba', ilhaId: ICS_ILHAS.sul });
    // Nada mudou ainda: a tela só relê quando há motivo (foco, visibilidade, storage).
    expect(ics().queryByRole('button', { name: /Zélia Outra Aba/ })).not.toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(await ics().findByRole('button', { name: /Zélia Outra Aba/ })).toBeInTheDocument();

    await otherTab.deactivateUser({ userId: ICS_USERS.bruno });
    act(() => {
      window.dispatchEvent(new Event('storage'));
    });
    await waitFor(() => {
      expect(ics().queryByRole('button', { name: /Bruno Costa/ })).not.toBeInTheDocument();
    });
    otherTab.disconnect();
  });

  it('depois de entrar no chat a tela de login não relê mais (os ouvintes saem)', async () => {
    const backend = new MockBackend({ store: new MemoryMockStore() });
    const transport = new MockTransport({ backend, delays: instant });
    const spy = vi.spyOn(transport, 'loginGroups');
    window.history.replaceState(null, '', '/?como=ics-bruno');
    render(<App transport={transport} />);
    await screen.findByLabelText('Lista de conversas');
    spy.mockClear();
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(spy).not.toHaveBeenCalled();
    window.history.replaceState(null, '', '/');
  });
});
