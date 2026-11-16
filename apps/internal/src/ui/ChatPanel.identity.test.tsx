import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { stubDesktopMatchMedia } from '../test/matchMedia';
import { MockTransport } from '../transport/MockTransport';
import { ICS_TENANT_ID, ICS_USERS, LIVE_CONVERSATION_ID } from '../transport/mock/seed';
import { ChatPanel } from './ChatPanel';

const instant = { connectMs: 0, sentMs: 0, deliveredMs: 0, readMs: 0 };
const as = (userId: string) => ({ tenantId: ICS_TENANT_ID, userId: userId as typeof ICS_USERS.carla });

beforeEach(() => {
  stubDesktopMatchMedia();
  window.history.replaceState({ smPane: 'list', conversationId: LIVE_CONVERSATION_ID }, '');
});

function sidebar() {
  return within(screen.getByLabelText('Lista de conversas'));
}

function titlesIn(sectionName: string): string[] {
  const section = sidebar().getByRole('region', { name: sectionName });
  return within(section)
    .getAllByRole('button')
    .map((button) => button.querySelector('.conversation-title')?.textContent ?? '');
}

async function renderAs(userId: string, props: Partial<Parameters<typeof ChatPanel>[0]> = {}) {
  const transport = new MockTransport({ delays: instant });
  render(<ChatPanel transport={transport} identity={as(userId)} {...props} />);
  await screen.findByRole('textbox', { name: /mensagem/i });
  await waitFor(() => {
    expect(screen.getByRole('textbox', { name: /mensagem/i })).toBeEnabled();
  });
  return transport;
}

describe('seções da lista', () => {
  it('a supervisora vê Grupos e supervisão em cima e Colegas embaixo, cada uma por última atividade', async () => {
    await renderAs(ICS_USERS.carla);
    const headings = sidebar()
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual(['Grupos e supervisão', 'Colegas']);
    // Bruno e Camila são "agora" (sem mensagens); Ana tem conversa de 88 min atrás
    expect(titlesIn('Grupos e supervisão')).toEqual(['Ana Souza', 'Bruno Costa', 'Camila Ribeiro']);
    expect(titlesIn('Colegas')).toEqual(['Marcos Dono']);
  });

  it('para o agente, a direta com o supervisor fica em Grupos e supervisão e a com o colega em Colegas', async () => {
    await renderAs(ICS_USERS.bruno);
    expect(titlesIn('Grupos e supervisão')).toEqual(['Carla Mendes']);
    expect(titlesIn('Colegas')).toEqual(['Ana Souza']);
  });

  it('não lidas aparecem nas duas seções', async () => {
    await renderAs(ICS_USERS.carla);
    const priorityAna = sidebar().getByRole('button', { name: /Ana Souza/ });
    const colleagueMarcos = sidebar().getByRole('button', { name: /Marcos Dono/ });
    expect(priorityAna.querySelector('.unread-badge')).not.toBeNull();
    expect(colleagueMarcos.querySelector('.unread-badge')).not.toBeNull();
    expect(colleagueMarcos).toHaveAccessibleName(/1 mensagem não lida/);
  });

  it('a busca e o filtro Não lidas valem sobre a lista nova, nas duas seções', async () => {
    const user = userEvent.setup();
    await renderAs(ICS_USERS.carla);
    await user.type(sidebar().getByRole('searchbox', { name: 'Pesquisar conversa' }), 'marcos');
    expect(sidebar().queryByRole('heading', { name: 'Grupos e supervisão' })).not.toBeInTheDocument();
    expect(titlesIn('Colegas')).toEqual(['Marcos Dono']);
    await user.clear(sidebar().getByRole('searchbox', { name: 'Pesquisar conversa' }));
    await user.click(sidebar().getByRole('button', { name: 'Não lidas' }));
    expect(titlesIn('Grupos e supervisão')).toEqual(['Ana Souza']);
    expect(titlesIn('Colegas')).toEqual(['Marcos Dono']);
  });

  it('a primeira conversa da lista abre selecionada, com o título do outro participante', async () => {
    await renderAs(ICS_USERS.carla);
    expect(sidebar().getByRole('button', { name: /Bruno Costa/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('heading', { level: 2, name: 'Bruno Costa' })).toBeInTheDocument();
  });
});

describe('cabeçalho do chat', () => {
  it('mostra o nome e o role (em português) do outro lado', async () => {
    const user = userEvent.setup();
    await renderAs(ICS_USERS.carla);
    const header = () => within(document.querySelector<HTMLElement>('.chat-header') as HTMLElement);
    expect(header().getByText('Agente')).toBeInTheDocument();
    await user.click(sidebar().getByRole('button', { name: /Marcos Dono/ }));
    expect(header().getByRole('heading', { name: 'Marcos Dono' })).toBeInTheDocument();
    expect(header().getByText('Administrador')).toBeInTheDocument();
  });

  it('para o agente, o supervisor aparece como Supervisor(a)', async () => {
    await renderAs(ICS_USERS.bruno);
    const header = within(document.querySelector<HTMLElement>('.chat-header') as HTMLElement);
    expect(header.getByRole('heading', { name: 'Carla Mendes' })).toBeInTheDocument();
    expect(header.getByText('Supervisor(a)')).toBeInTheDocument();
  });
});

describe('Nova conversa', () => {
  it('lista só os colegas da mesma empresa que podem receber uma direta, agente com agente inclusive', async () => {
    const user = userEvent.setup();
    await renderAs(ICS_USERS.bruno);
    await user.click(screen.getByRole('button', { name: 'Nova conversa' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Nova conversa' }));
    expect(dialog.getByRole('button', { name: 'Diego Martins Agente' })).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Marcos Dono Administrador' })).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Carla Mendes Supervisor(a)' })).toBeInTheDocument();
    // 8 colegas (a empresa tem 9 usuários) + Fechar; ninguém da outra empresa e nem ele mesmo
    expect(dialog.getAllByRole('button')).toHaveLength(9);
    expect(dialog.queryByRole('button', { name: /Bruno Costa/ })).not.toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: /Paula|Otávio|Helena|Rui/ })).not.toBeInTheDocument();
  });

  it('Esc fecha e devolve o foco ao botão', async () => {
    const user = userEvent.setup();
    await renderAs(ICS_USERS.bruno);
    const open = screen.getByRole('button', { name: 'Nova conversa' });
    await user.click(open);
    expect(screen.getByRole('dialog', { name: 'Nova conversa' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Nova conversa' })).not.toBeInTheDocument();
      expect(open).toHaveFocus();
    });
  });

  it('escolher um colega abre a direta, que passa a aparecer em Colegas', async () => {
    const user = userEvent.setup();
    await renderAs(ICS_USERS.bruno);
    await user.click(screen.getByRole('button', { name: 'Nova conversa' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Nova conversa' })).getByRole('button', { name: /Diego Martins/ }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Diego Martins' })).toBeInTheDocument();
    });
    expect(titlesIn('Colegas')).toContain('Diego Martins');
    expect(sidebar().getByRole('button', { name: /Diego Martins/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.queryByRole('dialog', { name: 'Nova conversa' })).not.toBeInTheDocument();
  });
});

describe('Administração e Trocar usuário', () => {
  it('o link de Administração só aparece com admin.console e abre o console real (sem placeholder)', async () => {
    const user = userEvent.setup();
    await renderAs(ICS_USERS.marcos);
    await user.click(screen.getByRole('button', { name: 'Administração' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Administração' })).toBeInTheDocument();
    expect(screen.queryByText(/chega na Etapa 5/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Voltar ao chat' }));
    expect(screen.getByLabelText('Lista de conversas')).toBeInTheDocument();
  });

  it.each([ICS_USERS.carla, ICS_USERS.bruno])('%s não vê o link de Administração', async (userId) => {
    await renderAs(userId);
    expect(screen.queryByRole('button', { name: /Administração/ })).not.toBeInTheDocument();
  });

  it('Trocar usuário chama o callback e a sessão para ao desmontar', async () => {
    const user = userEvent.setup();
    const onSwitchUser = vi.fn();
    const transport = await renderAs(ICS_USERS.carla, { onSwitchUser });
    const disconnect = vi.spyOn(transport, 'disconnect');
    await user.click(screen.getByRole('button', { name: 'Trocar usuário' }));
    expect(onSwitchUser).toHaveBeenCalledTimes(1);
    expect(disconnect).not.toHaveBeenCalled();
  });
});

describe('erro por conversa', () => {
  it('o erro de envio de uma conversa não aparece em outra e volta ao reabrir a primeira', async () => {
    const user = userEvent.setup();
    const transport = new MockTransport({ delays: instant, failSend: true });
    render(<ChatPanel transport={transport} identity={as(ICS_USERS.carla)} />);
    const field = await screen.findByRole('textbox', { name: /mensagem/i });
    await waitFor(() => {
      expect(field).toBeEnabled();
    });
    await user.type(field, 'oi');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await user.click(sidebar().getByRole('button', { name: /Camila Ribeiro/ }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(sidebar().getByRole('button', { name: /Bruno Costa/ }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
