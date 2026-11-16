import { act, render, screen, waitFor } from '@testing-library/react';
import { stubDesktopMatchMedia } from '../test/matchMedia';
import { MockBackend } from '../transport/mock/MockBackend';
import { MockTransport } from '../transport/mock/MockTransport';
import { ICS_TENANT_ID, ICS_USERS } from '../transport/mock/seed';
import { ChatPanel } from './ChatPanel';

it('desabilita composer e anexo quando chat.use é revogado e reabilita após concessão', async () => {
  stubDesktopMatchMedia();
  const backend = new MockBackend();
  const transport = new MockTransport({ backend });
  const { unmount } = render(<ChatPanel transport={transport} />);
  const composer = await screen.findByRole('textbox', { name: 'Mensagem' });
  await waitFor(() => expect(composer).toBeEnabled());
  const change = (granted: boolean) => backend.run((server) => server.setGrant(
    { tenantId: ICS_TENANT_ID, userId: ICS_USERS.marcos },
    { userId: ICS_USERS.carla, capability: 'chat.use', granted },
  ));
  act(() => { expect(change(false).ok).toBe(true); });
  expect(composer).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Anexar arquivo' })).toBeDisabled();
  act(() => { expect(change(true).ok).toBe(true); });
  expect(composer).toBeEnabled();
  unmount(); backend.close();
});
