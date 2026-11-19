import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Bell } from 'lucide-react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  asAnnouncementId,
  asMessageId,
  type AnnouncementRefMessage,
} from '@viavoip/internal-domain';
import { stubDesktopMatchMedia, stubMobileMatchMedia } from '../test/matchMedia';
import { ScriptedTransport } from '../test/scriptedTransport';
import { DEFAULT_SESSION, ICS_TENANT_ID, ICS_USERS, LIVE_CONVERSATION_ID } from '../transport/mock/seed';
import { ChatPanel } from '../ui/ChatPanel';
import { createShellSlots } from './registry';
import { asShellViewId, type ShellContext, type ShellSlots } from './slots';

function makeAnnouncementRef(): AnnouncementRefMessage {
  return {
    id: asMessageId('msg-ann-1'),
    tenantId: ICS_TENANT_ID,
    conversationId: LIVE_CONVERSATION_ID,
    authorId: ICS_USERS.carla,
    author: { id: ICS_USERS.carla, name: 'Carla Mendes' },
    timestamp: '2026-11-19T12:00:00.000Z',
    status: 'sent',
    type: 'announcement',
    announcementId: asAnnouncementId('ann-1'),
  };
}

function buildSlots(onMenuSelect: (ctx: ShellContext) => void): ShellSlots {
  return {
    views: [
      {
        id: asShellViewId('avisos'),
        label: 'Avisos',
        icon: Bell,
        visible: () => true,
        badge: () => 2,
        render: ({ me, onClose }) => (
          <section aria-label="Tela de avisos">
            <h2>Avisos para {me.name}</h2>
            <button type="button" onClick={onClose}>
              Voltar ao chat
            </button>
          </section>
        ),
      },
    ],
    overlays: [
      (ctx) => (
        <aside role="status" data-testid="slot-overlay">
          Overlay ativo: {ctx.tenant.name}
        </aside>
      ),
    ],
    menuItems: [
      {
        label: 'Modo debug neste navegador',
        visible: () => true,
        onSelect: onMenuSelect,
      },
    ],
    messageRenderers: {
      announcement: (message, ctx) => (
        <p data-testid="slot-announcement">
          Aviso {message.announcementId} ({ctx.me.id})
        </p>
      ),
    },
  };
}

describe('ShellSlots em ChatPanel e Sidebar', () => {
  afterEach(() => {
    stubDesktopMatchMedia();
  });

  for (const mode of ['desktop', '390'] as const) {
    it(`renderiza views, overlays, menuItems e messageRenderers.announcement no layout ${mode}`, async () => {
      if (mode === '390') {
        stubMobileMatchMedia();
      } else {
        stubDesktopMatchMedia();
      }

      const user = userEvent.setup();
      const transport = new ScriptedTransport();
      const onMenuSelect = vi.fn<(ctx: ShellContext) => void>();
      const slots = buildSlots(onMenuSelect);

      render(<ChatPanel transport={transport} identity={DEFAULT_SESSION} slots={slots} />);

      const overlay = await screen.findByTestId('slot-overlay');
      expect(overlay).toHaveTextContent('Overlay ativo:');

      act(() => {
        transport.emit({
          type: 'message',
          message: makeAnnouncementRef(),
        });
      });

      const customAnnouncement = await screen.findByTestId('slot-announcement');
      expect(customAnnouncement).toHaveTextContent(`Aviso ann-1 (${ICS_USERS.carla})`);

      const menuButton = screen.getByRole('button', { name: 'Modo debug neste navegador' });
      await user.click(menuButton);
      expect(onMenuSelect).toHaveBeenCalledTimes(1);
      expect(onMenuSelect.mock.calls[0]?.[0]).toMatchObject({ me: { id: ICS_USERS.carla } });

      const viewButton = screen.getByRole('button', { name: /Avisos/i });
      expect(viewButton).toHaveTextContent('2');
      await user.click(viewButton);

      const shell = document.querySelector('section.wa-shell');
      expect(shell).toHaveAttribute('hidden');
      expect(screen.getByRole('region', { name: 'Tela de avisos' })).toBeVisible();

      await user.click(screen.getByRole('button', { name: 'Voltar ao chat' }));
      expect(shell).not.toHaveAttribute('hidden');
      expect(screen.queryByRole('region', { name: 'Tela de avisos' })).not.toBeInTheDocument();
      await waitFor(() => {
        expect(document.activeElement).toBe(viewButton);
      });
    });
  }

  it('usa fallback "Aviso encaminhado" quando createShellSlots() está vazio', async () => {
    stubDesktopMatchMedia();
    const transport = new ScriptedTransport();

    render(<ChatPanel transport={transport} identity={DEFAULT_SESSION} slots={createShellSlots()} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Nova conversa' })).toBeEnabled();
    });

    act(() => {
      transport.emit({
        type: 'message',
        message: makeAnnouncementRef(),
      });
    });

    const fallbacks = await screen.findAllByText('Aviso encaminhado');
    expect(fallbacks.some((node) => node.classList.contains('bubble-text'))).toBe(true);
  });
});
