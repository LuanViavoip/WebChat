import { asAnnouncementId, asIsoInstant, asMessageId, asRevisionNo, parseEmoji } from '@viavoip/internal-domain';
import { describe, expect, it } from 'vitest';
import type { ChatEvent } from '../transport/ChatTransport';
import { ForbiddenError } from '../transport/errors';
import { ICS_TENANT_ID, ICS_USERS, LIVE_CONVERSATION_ID } from '../transport/mock/seed';
import { ScriptedTransport } from './scriptedTransport';

describe('ScriptedTransport programável', () => {
  it('permite programar resolução, emissão de evento, retenção e rejeição', async () => {
    const transport = new ScriptedTransport();
    const events: ChatEvent[] = [];
    transport.subscribe((event) => {
      events.push(event);
    });
    const like = parseEmoji('👍');
    if (!like) throw new Error('emoji');
    const messageId = asMessageId('m-1');

    transport.emitOn('react', (req) => ({
      type: 'reaction',
      conversationId: req.conversationId,
      messageId: req.messageId,
      userId: ICS_USERS.carla,
      emoji: req.emoji,
    }));
    await transport.react({ conversationId: LIVE_CONVERSATION_ID, messageId, emoji: like });
    expect(events).toContainEqual({
      type: 'reaction',
      tenantId: ICS_TENANT_ID,
      conversationId: LIVE_CONVERSATION_ID,
      messageId,
      userId: ICS_USERS.carla,
      emoji: like,
    });

    transport.holdMethod('markAnnouncementViewed');
    const pending = transport.markAnnouncementViewed({
      id: asAnnouncementId('ann-1'),
      revision: asRevisionNo(1),
    });
    expect(transport.heldCallsOf('markAnnouncementViewed')).toHaveLength(1);
    transport.resolveHeldMethod('markAnnouncementViewed', {
      phase: 'viewed',
      viewedAt: asIsoInstant('2026-11-19T12:00:00.000Z'),
      maxPositionMs: 0,
    });
    expect(await pending).toEqual({
      phase: 'viewed',
      viewedAt: asIsoInstant('2026-11-19T12:00:00.000Z'),
      maxPositionMs: 0,
    });

    transport.rejectMethod('acknowledgeAnnouncement', new ForbiddenError('playback-required'));
    await expect(
      transport.acknowledgeAnnouncement({ id: asAnnouncementId('ann-1'), revision: asRevisionNo(1) }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    transport.holdMethod('setPresence');
    const heldPresence = transport.setPresence({ status: 'away' });
    transport.rejectHeldMethod('setPresence', new ForbiddenError('actor-inactive'));
    await expect(heldPresence).rejects.toBeInstanceOf(ForbiddenError);
  });
});
