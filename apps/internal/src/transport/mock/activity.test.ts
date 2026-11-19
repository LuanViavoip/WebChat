import { expect, it } from 'vitest';
import { MockServer } from './MockServer';
import { createSeedState, ICS_TENANT_ID, ICS_USERS, LIVE_CONVERSATION_ID } from './seed';

it('encaminha atividade de gravação apenas ao outro participante e informa quando volta a idle', () => {
  const server = new MockServer(createSeedState('2026-11-13T12:00:00.000Z'));
  const carla = { tenantId: ICS_TENANT_ID, userId: ICS_USERS.carla };
  const recording = server.setActivity(carla, { conversationId: LIVE_CONVERSATION_ID, activity: 'recording-audio' });
  expect(recording.result.ok).toBe(true);
  expect(recording.deliveries).toEqual([{ to: ICS_USERS.bruno, event: { type: 'activity', tenantId: ICS_TENANT_ID, conversationId: LIVE_CONVERSATION_ID, userId: ICS_USERS.carla, activity: 'recording-audio' } }]);
  const idle = server.setActivity(carla, { conversationId: LIVE_CONVERSATION_ID, activity: 'idle' });
  expect(idle.deliveries[0]?.event).toMatchObject({ type: 'activity', activity: 'idle' });
  const invalid = server.setActivity(carla, { conversationId: LIVE_CONVERSATION_ID, activity: 'forjada' as never });
  expect(invalid.result.ok).toBe(false);
  expect(invalid.deliveries).toEqual([]);
});
