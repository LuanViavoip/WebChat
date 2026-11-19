import { asClientId } from '@viavoip/internal-domain';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CAPABILITIES } from '@viavoip/internal-domain';
import { stubDesktopMatchMedia, stubMobileMatchMedia } from '../test/matchMedia';
import { ScriptedTransport } from '../test/scriptedTransport';
import { ForbiddenError } from '../transport/errors';
import { MockBackend } from '../transport/mock/MockBackend';
import { MemoryMockStore } from '../transport/mock/MockStore';
import type { StaffUser } from '@viavoip/internal-domain';
import { MockTransport } from '../transport/mock/MockTransport';
import { ICS_ILHAS, ICS_TENANT_ID, ICS_USERS } from '../transport/mock/seed';
import { CAPABILITY_TEXT } from './admin/capabilityLabels';
import { ChatPanel } from './ChatPanel';

const instant = { connectMs: 0, sentMs: 0, deliveredMs: 0, readMs: 0 };
const as = (userId: string) => ({ tenantId: ICS_TENANT_ID, userId: userId as typeof ICS_USERS.carla });
type User = ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  stubDesktopMatchMedia();
  window.history.replaceState(null, '', '/');
});

/** Um servidor (MockBackend sobre um storage) e quantas sessões de UI se quiser, todas reais. */
function rig() {
  const backend = new MockBackend({ store: new MemoryMockStore() });
  const transports: MockTransport[] = [];
  return {
    backend,
    /** Uma sessão sem UI, para agir "em outra aba" ou preparar o estado. */
    async session(userId: string): Promise<MockTransport> {
      const transport = new MockTransport({ backend, delays: instant });
      await transport.connect(as(userId));
      transports.push(transport);
      return transport;
    },
    async open(userId: string, transport: MockTransport = new MockTransport({ backend, delays: instant })) {
      const holder = document.body.appendChild(document.createElement('div'));
      render(<ChatPanel transport={transport} identity={as(userId)} />, { container: holder });
      await within(holder).findByLabelText('Lista de conversas');
      await within(holder).findByText(/· ICS Saúde/);
      return holder;
    },
    close() {
      for (const transport of transports) {
        transport.disconnect();
      }
    },
  };
}

async function openConsole(user: User, name: 'Administração' | 'Equipe') {
  await user.click(screen.getByRole('button', { name }));
  expect(await screen.findByRole('heading', { level: 1, name })).toBeInTheDocument();
}

function element(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) {
    throw new Error(`sem elemento para ${selector}`);
  }
  return found;
}

function listPane() {
  return within(element('.admin-list'));
}

function detailPane() {
  return within(element('.admin-detail'));
}

async function pick(user: User, name: RegExp | string) {
  await user.click(listPane().getByRole('button', { name }));
  await waitFor(() => {
    expect(detailPane().getByRole('heading', { level: 2, name })).toBeInTheDocument();
  });
}

function capSwitch(capability: string): HTMLElement {
  return element(`[role="switch"][data-capability="${capability}"]`);
}

function capRow(capability: string): HTMLElement {
  return element(`[data-capability-row="${capability}"]`);
}

function optionsOf(select: HTMLElement): string[] {
  return within(select).getAllByRole('option').map((option) => option.textContent);
}

describe('Console: permissões por usuário (aceite da Etapa 5)', () => {
  it('o admin concede announcement.publish a um supervisor e a chave fica ligada (servidor real)', async () => {
    const user = userEvent.setup();
    const r = rig();
    const admin = await r.session(ICS_USERS.marcos);
    await admin.setGrant({ userId: ICS_USERS.rafael, capability: 'announcement.publish', granted: false });
    await r.open(ICS_USERS.marcos);
    await openConsole(user, 'Administração');
    await pick(user, /Rafael Lima/);
    expect(capSwitch('announcement.publish')).toHaveAttribute('aria-checked', 'false');
    expect(capSwitch('announcement.publish')).toBeEnabled();

    await user.click(capSwitch('announcement.publish'));

    await waitFor(() => {
      expect(capSwitch('announcement.publish')).toHaveAttribute('aria-checked', 'true');
    });
    expect(screen.getByRole('status')).toHaveTextContent('Publicar avisos ligada para Rafael Lima.');
    const stored = r.backend.query((server) => server.getState().get(ICS_TENANT_ID)?.directory.users[ICS_USERS.rafael]);
    expect(stored?.grants.has('announcement.publish')).toBe(true);
    r.close();
  });

  it('a linha do próprio admin é somente leitura: todas as chaves desabilitadas com "não pode alterar a si mesmo"', async () => {
    const user = userEvent.setup();
    const r = rig();
    await r.open(ICS_USERS.marcos);
    await openConsole(user, 'Administração');
    await pick(user, /Marcos Dono/);
    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(CAPABILITIES.length);
    for (const item of switches) {
      expect(item).toBeDisabled();
      expect(item).toHaveAccessibleDescription(/não pode alterar a si mesmo/);
    }
    expect(within(capRow('admin.console')).getByText('não pode alterar a si mesmo')).toBeVisible();
    await user.click(capSwitch('chat.use'));
    expect(capSwitch('chat.use')).toHaveAttribute('aria-checked', 'true');
    expect(r.backend.query((server) => server.grantLog(as(ICS_USERS.marcos)))).toMatchObject({ ok: true, value: [] });
    r.close();
  });

  it('capacidade fora do teto de agente aparece desabilitada com "acima do papel"', async () => {
    const user = userEvent.setup();
    const r = rig();
    await r.open(ICS_USERS.marcos);
    await openConsole(user, 'Administração');
    await user.click(listPane().getByRole('button', { name: 'Agentes' }));
    await pick(user, /Ana Souza/);
    expect(capSwitch('announcement.publish')).toBeDisabled();
    expect(capSwitch('announcement.publish')).toHaveAttribute('aria-checked', 'false');
    expect(capSwitch('announcement.publish')).toHaveAccessibleDescription(/acima do papel/);
    expect(within(capRow('announcement.publish')).getByText('acima do papel')).toBeVisible();
    expect(capSwitch('chat.use')).toBeEnabled();
    r.close();
  });

  it('as chaves são geradas do catálogo: uma por capacidade, na ordem de CAPABILITIES', async () => {
    const user = userEvent.setup();
    const r = rig();
    await r.open(ICS_USERS.marcos);
    await openConsole(user, 'Administração');
    await pick(user, /Rafael Lima/);
    expect(screen.getAllByRole('switch').map((item) => item.getAttribute('data-capability'))).toEqual([...CAPABILITIES]);
    for (const capability of CAPABILITIES) {
      expect(capSwitch(capability)).toHaveAccessibleName(CAPABILITY_TEXT[capability].label);
    }
    r.close();
  });

  it('o grantLog mostra quem, para quem, o quê, concedeu/revogou e quando, com nomes, e atualiza ao vivo', async () => {
    const user = userEvent.setup();
    const r = rig();
    await r.open(ICS_USERS.marcos);
    await openConsole(user, 'Administração');
    await user.click(listPane().getByRole('button', { name: 'Registro' }));
    expect(await screen.findByText('Nenhuma permissão concedida ou revogada ainda.')).toBeInTheDocument();

    // Outra aba muda uma permissão: o registro da tela aparece sem ação nenhuma.
    const other = await r.session(ICS_USERS.marcos);
    await other.setGrant({ userId: ICS_USERS.rafael, capability: 'announcement.moderate', granted: false });

    const log = await screen.findByRole('list', { name: 'Registro de permissões' });
    const item = within(log).getByText('Marcos Dono revogou Moderar comentários dos avisos de Rafael Lima');
    expect(item).toBeInTheDocument();
    const time = within(log).getByText(/\d{2}\/\d{2}\/\d{2,4}/);
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('datetime');
    expect(log.textContent).not.toContain(ICS_USERS.rafael);
    r.close();
  });
});

describe('Console: Supervisores, Ilhas e Agentes', () => {
  it('cadastra um supervisor (nome + ilhas) e ele aparece na lista, selecionado, com a ilha atribuída', async () => {
    const user = userEvent.setup();
    const r = rig();
    await r.open(ICS_USERS.marcos);
    await openConsole(user, 'Administração');
    await user.click(listPane().getByRole('button', { name: 'Novo supervisor' }));
    await user.type(detailPane().getByLabelText('Nome'), 'Paula Nova');
    await user.click(detailPane().getByRole('checkbox', { name: 'Exames' }));
    await user.click(detailPane().getByRole('button', { name: 'Cadastrar supervisor' }));

    const item = await listPane().findByRole('button', { name: /Paula Nova/ });
    expect(item).toHaveAttribute('aria-current', 'true');
    expect(detailPane().getByRole('heading', { level: 2, name: 'Paula Nova' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Supervisor Paula Nova cadastrado.');
    const ilhas = r.backend.query((server) => server.getState().get(ICS_TENANT_ID)?.directory.ilhas);
    const paula = r.backend.query((server) =>
      Object.values(server.getState().get(ICS_TENANT_ID)?.directory.users ?? {}).find((u) => u.name === 'Paula Nova'),
    );
    expect(ilhas?.[ICS_ILHAS.exames]?.supervisorIds).toEqual([ICS_USERS.rafael, paula?.id]);
    expect(detailPane().getByRole('list', { name: 'Ilhas de Paula Nova' })).toHaveTextContent('Exames');
    r.close();
  });

  it('desativa e reativa um supervisor, refletindo na lista e no botão', async () => {
    const user = userEvent.setup();
    const r = rig();
    await r.open(ICS_USERS.marcos);
    await openConsole(user, 'Administração');
    await pick(user, /Rafael Lima/);
    await user.click(detailPane().getByRole('button', { name: 'Desativar' }));
    expect(await listPane().findByText('Desativado')).toBeInTheDocument();
    expect(await detailPane().findByRole('button', { name: 'Reativar' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Rafael Lima desativado.');
    await user.click(detailPane().getByRole('button', { name: 'Reativar' }));
    await waitFor(() => {
      expect(listPane().queryByText('Desativado')).not.toBeInTheDocument();
    });
    expect(await detailPane().findByRole('button', { name: 'Desativar' })).toBeInTheDocument();
    r.close();
  });

  it('cria ilha (nome + supervisor), renomeia e atribui outro supervisor', async () => {
    const user = userEvent.setup();
    const r = rig();
    await r.open(ICS_USERS.marcos);
    await openConsole(user, 'Administração');
    await user.click(listPane().getByRole('button', { name: 'Ilhas' }));
    await user.click(listPane().getByRole('button', { name: 'Nova ilha' }));
    await user.type(detailPane().getByLabelText('Nome da ilha'), 'Leste');
    await user.selectOptions(detailPane().getByLabelText('Supervisor'), 'Rafael Lima');
    await user.click(detailPane().getByRole('button', { name: 'Criar ilha' }));
    const created = await listPane().findByRole('button', { name: /Leste/ });
    expect(created).toHaveTextContent('Rafael Lima · 0 agentes');
    expect(detailPane().getByRole('heading', { level: 2, name: 'Leste' })).toBeInTheDocument();

    const name = detailPane().getByLabelText('Nome da ilha');
    await user.clear(name);
    await user.type(name, 'Leste 2');
    await user.click(detailPane().getByRole('button', { name: 'Renomear' }));
    expect(await listPane().findByRole('button', { name: /Leste 2/ })).toBeInTheDocument();
    expect(listPane().queryByRole('button', { name: /^Leste Rafael/ })).not.toBeInTheDocument();

    await user.selectOptions(detailPane().getByLabelText('Supervisor da ilha'), 'Carla Mendes');
    await user.click(detailPane().getByRole('button', { name: 'Atribuir supervisor' }));
    await waitFor(() => {
      expect(listPane().getByRole('button', { name: /Leste 2/ })).toHaveTextContent('Rafael Lima, Carla Mendes · 0 agentes');
    });
    // N:N: atribuir ACRESCENTA; o subtítulo lista os dois, em ordem alfabética
    expect(detailPane().getByText('Supervisores: Carla Mendes, Rafael Lima')).toBeInTheDocument();
    // e o admin pode tirar um deles (o último não sai)
    await user.click(detailPane().getByRole('button', { name: 'Remover Rafael Lima' }));
    expect(await detailPane().findByText('Supervisor: Carla Mendes')).toBeInTheDocument();
    expect(detailPane().getByRole('button', { name: 'Remover Carla Mendes' })).toBeDisabled();
    r.close();
  });

  it('cadastra agente numa ilha, acrescenta e remove vínculo de ilha e desativa, e a lista acompanha', async () => {
    const user = userEvent.setup();
    const r = rig();
    await r.open(ICS_USERS.marcos);
    await openConsole(user, 'Administração');
    await user.click(listPane().getByRole('button', { name: 'Agentes' }));
    await user.click(listPane().getByRole('button', { name: 'Novo agente' }));
    await user.type(detailPane().getByLabelText('Nome'), 'Zeca Agente');
    await user.selectOptions(detailPane().getByLabelText('Ilha'), 'Sul');
    await user.click(detailPane().getByRole('button', { name: 'Cadastrar agente' }));
    const added = await listPane().findByRole('button', { name: /Zeca Agente/ });
    expect(added).toHaveTextContent('Agente · Ilha Sul');

    await user.selectOptions(detailPane().getByLabelText('Adicionar à ilha'), 'Exames');
    await user.click(detailPane().getByRole('button', { name: 'Adicionar' }));
    await waitFor(() => {
      expect(listPane().getByRole('button', { name: /Zeca Agente/ })).toHaveTextContent('Agente · Ilhas Sul, Exames');
    });
    expect(screen.getByRole('status')).toHaveTextContent('Zeca Agente agora também está na ilha Exames.');
    // mover = remover o vínculo antigo; o último vínculo não sai
    await user.click(detailPane().getByRole('button', { name: 'Remover da ilha Sul' }));
    await waitFor(() => {
      expect(listPane().getByRole('button', { name: /Zeca Agente/ })).toHaveTextContent('Agente · Ilha Exames');
    });
    expect(detailPane().getByRole('button', { name: 'Remover da ilha Exames' })).toBeDisabled();

    await user.click(detailPane().getByRole('button', { name: 'Desativar' }));
    expect(await listPane().findByText('Desativado')).toBeInTheDocument();
    r.close();
  });

  it('formulário: nome vazio é recusado no alert com o foco no campo, e Enter envia', async () => {
    const user = userEvent.setup();
    const r = rig();
    await r.open(ICS_USERS.marcos);
    await openConsole(user, 'Administração');
    await user.click(listPane().getByRole('button', { name: 'Agentes' }));
    await user.click(listPane().getByRole('button', { name: 'Novo agente' }));
    const field = detailPane().getByLabelText('Nome');
    await waitFor(() => {
      expect(field).toHaveFocus();
    });
    await user.click(detailPane().getByRole('button', { name: 'Cadastrar agente' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o nome.');
    expect(field).toHaveFocus();
    await user.type(field, '   ');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o nome.');
    expect(listPane().queryByRole('button', { name: /Via Enter/ })).not.toBeInTheDocument();

    await user.type(field, 'Via Enter{Enter}');
    expect(await listPane().findByRole('button', { name: /Via Enter/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    r.close();
  });

  it('a mensagem de erro do servidor aparece no alert', async () => {
    class RefusingTransport extends MockTransport {
      override registerAgent(): Promise<never> {
        return Promise.reject(new ForbiddenError('outside-islands'));
      }
    }
    const user = userEvent.setup();
    const r = rig();
    await r.open(ICS_USERS.marcos, new RefusingTransport({ backend: r.backend, delays: instant }));
    await openConsole(user, 'Administração');
    await user.click(listPane().getByRole('button', { name: 'Agentes' }));
    await user.click(listPane().getByRole('button', { name: 'Novo agente' }));
    await user.type(detailPane().getByLabelText('Nome'), 'Recusado{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Operação não permitida: fora das suas ilhas.');
    expect(listPane().queryByRole('button', { name: /Recusado/ })).not.toBeInTheDocument();
    r.close();
  });
});

describe('Equipe do supervisor', () => {
  it('não vê Administração; vê só os agentes das ilhas dele, sem as seções de gestão', async () => {
    const user = userEvent.setup();
    const r = rig();
    await r.open(ICS_USERS.carla);
    expect(screen.queryByRole('button', { name: 'Administração' })).not.toBeInTheDocument();
    await openConsole(user, 'Equipe');
    const sections = within(screen.getByRole('group', { name: 'Seções' })).getAllByRole('button');
    expect(sections.map((item) => item.textContent)).toEqual(['Agentes', 'Registro']);
    expect(listPane().queryByRole('button', { name: 'Supervisores' })).not.toBeInTheDocument();
    expect(listPane().queryByRole('button', { name: 'Ilhas' })).not.toBeInTheDocument();
    for (const mine of [/Ana Souza/, /Bruno Costa/, /Camila Ribeiro/, /Diego Martins/]) {
      expect(listPane().getByRole('button', { name: mine })).toBeInTheDocument();
    }
    // Agente só de outra ilha (Exames, do Rafael) nem aparece, então não é acionável.
    expect(listPane().queryByRole('button', { name: /Elisa Barbosa/ })).not.toBeInTheDocument();
    // N:N: Fábio está em Exames (Rafael) E em Plantão (Carla e Rafael): basta UMA ilha dela.
    expect(listPane().getByRole('button', { name: /Fábio Nunes/ })).toBeInTheDocument();
    expect(listPane().queryByRole('button', { name: /Rafael Lima/ })).not.toBeInTheDocument();
    r.close();
  });

  it('o seletor de ilha do cadastro e do vínculo só lista as ilhas dele', async () => {
    const user = userEvent.setup();
    const r = rig();
    await r.open(ICS_USERS.carla);
    await openConsole(user, 'Equipe');
    await user.click(listPane().getByRole('button', { name: 'Novo agente' }));
    expect(optionsOf(detailPane().getByLabelText('Ilha'))).toEqual(['Norte', 'Plantão', 'Sul']);
    await user.type(detailPane().getByLabelText('Nome'), 'Nina Nova');
    await user.selectOptions(detailPane().getByLabelText('Ilha'), 'Sul');
    await user.click(detailPane().getByRole('button', { name: 'Cadastrar agente' }));
    expect(await listPane().findByRole('button', { name: /Nina Nova/ })).toHaveTextContent('Ilha Sul');

    await pick(user, /Ana Souza/);
    // Ana está em Norte e Sul: só a Plantão é destino válido; Exames é só do Rafael.
    expect(optionsOf(detailPane().getByLabelText('Adicionar à ilha'))).toEqual(['Plantão']);
    await user.click(detailPane().getByRole('button', { name: 'Adicionar' }));
    await waitFor(() => {
      expect(listPane().getByRole('button', { name: /Ana Souza/ })).toHaveTextContent('Ilhas Norte, Sul, Plantão');
    });
    r.close();
  });

  it('chave que ele não possui mostra "você não possui"; acima do papel do agente fica bloqueada', async () => {
    const user = userEvent.setup();
    const r = rig();
    await r.open(ICS_USERS.carla);
    await openConsole(user, 'Equipe');
    await pick(user, /Bruno Costa/);
    expect(capSwitch('ilhas.manage')).toBeDisabled();
    expect(within(capRow('ilhas.manage')).getByText('você não possui')).toBeVisible();
    expect(capSwitch('ilhas.manage')).toHaveAccessibleDescription(/você não possui/);
    expect(within(capRow('announcement.publish')).getByText('acima do papel')).toBeVisible();
    expect(capSwitch('chat.use')).toBeEnabled();

    await user.click(capSwitch('chat.use'));
    await waitFor(() => {
      expect(capSwitch('chat.use')).toHaveAttribute('aria-checked', 'false');
    });
    r.close();
  });

  it('a própria linha do supervisor é somente leitura', async () => {
    const user = userEvent.setup();
    const r = rig();
    await r.open(ICS_USERS.carla);
    await openConsole(user, 'Equipe');
    await pick(user, /Carla Mendes/);
    for (const item of screen.getAllByRole('switch')) {
      expect(item).toBeDisabled();
      expect(item).toHaveAccessibleDescription(/não pode alterar a si mesmo/);
    }
    r.close();
  });

  it('desativa e reativa agente das ilhas dele', async () => {
    const user = userEvent.setup();
    const r = rig();
    await r.open(ICS_USERS.carla);
    await openConsole(user, 'Equipe');
    await pick(user, /Diego Martins/);
    await user.click(detailPane().getByRole('button', { name: 'Desativar' }));
    expect(await listPane().findByText('Desativado')).toBeInTheDocument();
    await user.click(await detailPane().findByRole('button', { name: 'Reativar' }));
    await waitFor(() => {
      expect(listPane().queryByText('Desativado')).not.toBeInTheDocument();
    });
    r.close();
  });
});

describe('Agente comum', () => {
  it('não vê Administração, Equipe nem Novo grupo', async () => {
    const r = rig();
    await r.open(ICS_USERS.bruno);
    expect(screen.queryByRole('button', { name: 'Administração' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Equipe' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Novo grupo' })).not.toBeInTheDocument();
    r.close();
  });
});

describe('Novo grupo (só group.manage, ao vivo)', () => {
  it('aparece para quem tem group.manage; some e volta sem reload quando o admin revoga e concede', async () => {
    const user = userEvent.setup();
    const r = rig();
    const carla = await r.open(ICS_USERS.carla);
    const marcos = await r.open(ICS_USERS.marcos);
    expect(within(carla).getByRole('button', { name: 'Novo grupo' })).toBeEnabled();
    expect(within(carla).getByLabelText('Ilha do grupo')).toBeInTheDocument();
    expect(optionsOf(within(carla).getByLabelText('Ilha do grupo'))).toEqual(['Sem ilha', 'Norte', 'Sul', 'Plantão']);

    await user.click(within(marcos).getByRole('button', { name: 'Administração' }));
    await pick(user, /Carla Mendes/);
    await user.click(capSwitch('group.manage'));

    await waitFor(() => {
      expect(within(carla).queryByRole('button', { name: 'Novo grupo' })).not.toBeInTheDocument();
    });
    expect(within(carla).queryByLabelText('Ilha do grupo')).not.toBeInTheDocument();
    // O grantLog do admin mostra a entrada, com nomes.
    expect(
      await detailPane().findByText('Marcos Dono revogou Criar e editar grupos de Carla Mendes'),
    ).toBeInTheDocument();

    await user.click(capSwitch('group.manage'));
    await waitFor(() => {
      expect(within(carla).getByRole('button', { name: 'Novo grupo' })).toBeInTheDocument();
    });
    expect(detailPane().getByText('Marcos Dono concedeu Criar e editar grupos a Carla Mendes')).toBeInTheDocument();
    r.close();
  });

  it('o botão abre o diálogo de criação e devolve o foco ao fechar', async () => {
    const user = userEvent.setup();
    const r = rig();
    await r.open(ICS_USERS.carla);
    await user.selectOptions(screen.getByLabelText('Ilha do grupo'), 'Sul');
    await user.click(screen.getByRole('button', { name: 'Novo grupo' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo grupo' });
    expect(dialog).toHaveTextContent('Ilha escolhida: Sul.');
    expect(within(dialog).getByRole('button', { name: 'Próximo' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Novo grupo' })).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Novo grupo' })).toHaveFocus();
    });
    r.close();
  });
});

describe('Revogação com a tela aberta fecha a tela', () => {
  it('revogar agents.manage do supervisor fecha a Equipe, sem reload, e a entrada some', async () => {
    const user = userEvent.setup();
    const r = rig();
    await r.open(ICS_USERS.carla);
    await openConsole(user, 'Equipe');
    const admin = await r.session(ICS_USERS.marcos);
    await admin.setGrant({ userId: ICS_USERS.carla, capability: 'agents.manage', granted: false });
    await waitFor(() => {
      expect(screen.queryByRole('heading', { level: 1, name: 'Equipe' })).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText('Lista de conversas')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Equipe' })).not.toBeInTheDocument();
    r.close();
  });

  it('o evento grants que tira admin.console do admin fecha a Administração', async () => {
    const user = userEvent.setup();
    const scripted = new ScriptedTransport();
    scripted.asUser = ICS_USERS.marcos;
    render(<ChatPanel transport={scripted} identity={as(ICS_USERS.marcos)} />);
    await screen.findByText(/· ICS Saúde/);
    await openConsole(user, 'Administração');
    scripted.emit({ type: 'grants', tenantId: ICS_TENANT_ID, userId: ICS_USERS.marcos, grants: ['chat.use'] });
    await waitFor(() => {
      expect(screen.queryByRole('heading', { level: 1, name: 'Administração' })).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Administração' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Lista de conversas')).toBeInTheDocument();
  });
});

describe('Layout e foco no mobile', () => {
  it('abre o detalhe com o foco no título e, ao voltar, devolve o foco ao item', async () => {
    stubMobileMatchMedia();
    const user = userEvent.setup();
    const r = rig();
    await r.open(ICS_USERS.marcos);
    await user.click(screen.getByRole('button', { name: 'Administração' }));
    await screen.findByRole('heading', { level: 1, name: 'Administração' });
    const shell = element('.admin-shell');
    expect(shell).toHaveAttribute('data-mobile-pane', 'list');
    expect(detailPane().queryByRole('heading', { level: 2 })).not.toBeInTheDocument();

    const item = listPane().getByRole('button', { name: /Rafael Lima/ });
    await user.click(item);
    expect(shell).toHaveAttribute('data-mobile-pane', 'chat');
    const header = element('.admin-detail [data-detail-header]');
    await waitFor(() => {
      expect(header).toHaveFocus();
    });
    // No mobile o painel de detalhe é a tela inteira: o título dele é o h1 (e a lista, escondida, não conta).
    expect(within(header).getByRole('heading', { level: 1, name: 'Rafael Lima' })).toBeInTheDocument();

    await user.click(within(header).getByRole('button', { name: 'Voltar' }));
    expect(shell).toHaveAttribute('data-mobile-pane', 'list');
    await waitFor(() => {
      expect(listPane().getByRole('button', { name: /Rafael Lima/ })).toHaveFocus();
    });
    r.close();
  });
});

/** Transporte de latência controlada: a chamada fica pendente até o teste liberar. */
class SlowTransport extends MockTransport {
  calls: string[] = [];
  private release: (() => void) | undefined;

  private hold<T>(name: string, run: () => Promise<T>): Promise<T> {
    this.calls.push(name);
    return new Promise<void>((resolve) => {
      this.release = resolve;
    }).then(run);
  }

  go(): void {
    this.release?.();
  }

  override registerAgent(...args: Parameters<MockTransport['registerAgent']>): Promise<StaffUser> {
    return this.hold('registerAgent', () => super.registerAgent(...args));
  }

  override deactivateUser(...args: Parameters<MockTransport['deactivateUser']>): Promise<StaffUser> {
    return this.hold('deactivateUser', () => super.deactivateUser(...args));
  }
}

describe('Uma ação por vez (sem reentrada)', () => {
  it('cadastrar com clique duplo e Enter repetido manda UMA chamada e desabilita o envio enquanto ocupado', async () => {
    const user = userEvent.setup();
    const r = rig();
    const slow = new SlowTransport({ backend: r.backend, delays: instant });
    await r.open(ICS_USERS.marcos, slow);
    await openConsole(user, 'Administração');
    await user.click(listPane().getByRole('button', { name: 'Agentes' }));
    await user.click(listPane().getByRole('button', { name: 'Novo agente' }));
    await user.type(detailPane().getByLabelText('Nome'), 'Duplo');
    const submit = detailPane().getByRole('button', { name: 'Cadastrar agente' });
    await user.dblClick(submit);
    await user.type(detailPane().getByLabelText('Nome'), '{Enter}{Enter}');
    expect(slow.calls).toEqual(['registerAgent']);
    expect(submit).toBeDisabled();
    slow.go();
    expect(await listPane().findByRole('button', { name: /Duplo/ })).toBeInTheDocument();
    const agents = r.backend.query((server) =>
      Object.values(server.getState().get(ICS_TENANT_ID)?.directory.users ?? {}).filter((u) => u.name === 'Duplo'),
    );
    expect(agents).toHaveLength(1);
    r.close();
  });

  it('duplo clique em Desativar desativa uma vez e NÃO reativa', async () => {
    const user = userEvent.setup();
    const r = rig();
    const slow = new SlowTransport({ backend: r.backend, delays: instant });
    await r.open(ICS_USERS.marcos, slow);
    await openConsole(user, 'Administração');
    await pick(user, /Rafael Lima/);
    await user.dblClick(detailPane().getByRole('button', { name: 'Desativar' }));
    expect(slow.calls).toEqual(['deactivateUser']);
    slow.go();
    expect(await detailPane().findByRole('button', { name: 'Reativar' })).toBeInTheDocument();
    expect(slow.calls).toEqual(['deactivateUser']);
    expect(listPane().getByText('Desativado')).toBeInTheDocument();
    r.close();
  });
});

describe('Revogar e conceder de novo não reabre a tela sozinha', () => {
  it('Equipe: revoga fecha; conceder de novo continua no chat e o botão volta', async () => {
    const user = userEvent.setup();
    const r = rig();
    await r.open(ICS_USERS.carla);
    await openConsole(user, 'Equipe');
    const admin = await r.session(ICS_USERS.marcos);
    await admin.setGrant({ userId: ICS_USERS.carla, capability: 'agents.manage', granted: false });
    await waitFor(() => {
      expect(screen.queryByRole('heading', { level: 1, name: 'Equipe' })).not.toBeInTheDocument();
    });
    await admin.setGrant({ userId: ICS_USERS.carla, capability: 'agents.manage', granted: true });
    expect(await screen.findByRole('button', { name: 'Equipe' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Equipe' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Lista de conversas')).toBeVisible();
    r.close();
  });

  it('Administração: o evento grants que tira e devolve admin.console não reabre o console', async () => {
    const user = userEvent.setup();
    const scripted = new ScriptedTransport();
    scripted.asUser = ICS_USERS.marcos;
    render(<ChatPanel transport={scripted} identity={as(ICS_USERS.marcos)} />);
    await screen.findByText(/· ICS Saúde/);
    await openConsole(user, 'Administração');
    scripted.emit({ type: 'grants', tenantId: ICS_TENANT_ID, userId: ICS_USERS.marcos, grants: ['chat.use'] });
    await waitFor(() => {
      expect(screen.queryByRole('heading', { level: 1, name: 'Administração' })).not.toBeInTheDocument();
    });
    scripted.emit({ type: 'grants', tenantId: ICS_TENANT_ID, userId: ICS_USERS.marcos, grants: [...CAPABILITIES] });
    expect(await screen.findByRole('button', { name: 'Administração' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Administração' })).not.toBeInTheDocument();
  });
});

describe('O chat continua vivo por baixo do console', () => {
  it('mensagem com o console aberto é anunciada, e a busca e o não lido estão lá ao voltar', async () => {
    const user = userEvent.setup();
    const r = rig();
    await r.open(ICS_USERS.carla);
    // A Ana fica aberta (escolhida de propósito); a mensagem vem de outra conversa.
    await user.click(within(screen.getByLabelText('Lista de conversas')).getByRole('button', { name: /Ana Souza/ }));
    await user.type(screen.getByRole('searchbox', { name: 'Pesquisar conversa' }), 'Camila');
    await openConsole(user, 'Equipe');
    const announcer = element('[data-live-announcer]');
    expect(announcer).toBeInTheDocument();

    const camila = await r.session(ICS_USERS.camila);
    const direct = await camila.openDirect({ with: ICS_USERS.carla });
    await camila.send({ conversationId: direct.id, clientId: asClientId('c-1'), payload: { type: 'text', text: 'Oi, Carla' } });
    await waitFor(() => {
      expect(element('[data-live-announcer]')).toHaveTextContent('Nova mensagem');
    });

    await user.click(screen.getByRole('button', { name: 'Voltar ao chat' }));
    expect(screen.getByRole('searchbox', { name: 'Pesquisar conversa' })).toHaveValue('Camila');
    const item = within(screen.getByLabelText('Lista de conversas')).getByRole('button', { name: /Camila Ribeiro/ });
    expect(item).toHaveAccessibleName(/1 mensagem não lida/);
    r.close();
  });
});

describe('IlhaDetail acompanha o servidor', () => {
  it('renomeada em outra aba, o campo não editado mostra o nome novo; editado, mantém o texto de quem digita', async () => {
    const user = userEvent.setup();
    const r = rig();
    await r.open(ICS_USERS.marcos);
    await openConsole(user, 'Administração');
    await user.click(listPane().getByRole('button', { name: 'Ilhas' }));
    await pick(user, /^Norte/);
    const other = await r.session(ICS_USERS.marcos);
    await other.renameIlha({ ilhaId: ICS_ILHAS.norte, name: 'Norte Novo' });
    await waitFor(() => {
      expect(detailPane().getByLabelText('Nome da ilha')).toHaveValue('Norte Novo');
    });

    await user.clear(detailPane().getByLabelText('Nome da ilha'));
    await user.type(detailPane().getByLabelText('Nome da ilha'), 'Rascunho meu');
    await other.renameIlha({ ilhaId: ICS_ILHAS.norte, name: 'Norte Outra Vez' });
    await waitFor(() => {
      expect(listPane().getByRole('button', { name: /Norte Outra Vez/ })).toBeInTheDocument();
    });
    expect(detailPane().getByLabelText('Nome da ilha')).toHaveValue('Rascunho meu');
    r.close();
  });
});

describe('Regiões roláveis', () => {
  it('o detalhe só leitura (linha "Você") é uma região focalizável e nomeada', async () => {
    const user = userEvent.setup();
    const r = rig();
    await r.open(ICS_USERS.marcos);
    await openConsole(user, 'Administração');
    await pick(user, /Marcos Dono/);
    const region = detailPane().getByRole('region', { name: /Detalhes de Marcos Dono/ });
    expect(region).toHaveAttribute('tabindex', '0');
    region.focus();
    expect(region).toHaveFocus();
    r.close();
  });
});
