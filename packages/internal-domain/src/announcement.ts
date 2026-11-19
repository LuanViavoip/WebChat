import type { ReceiptState, ReceiptTally } from './announcementReceipt';
import type { Audience } from './audience';
import type { Conversation, ConversationId } from './conversation';
import type { AnnouncementId, ClientId, IsoInstant, RevisionNo } from './ids';
import type { IlhaId, StaffUser, UserId } from './identity';
import type { PresenceStatus } from './presence';
import { err, ok, type Result } from './result';
import type { TenantId } from './tenant';

export type AnnouncementMedia =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'audio';
      readonly url: string;
      readonly mimeType: string;
      readonly durationMs: number;
      readonly source: 'recorded' | 'file';
    }
  | {
      readonly kind: 'video';
      readonly url: string;
      readonly mimeType: string;
      readonly durationMs: number;
      readonly source: 'recorded' | 'file';
      readonly posterUrl?: string;
    }
  | { readonly kind: 'image'; readonly url: string; readonly mimeType: string }
  | {
      readonly kind: 'document';
      readonly url: string;
      readonly mimeType: string;
      readonly fileName: string;
      readonly sizeBytes: number;
    };

export type AnnouncementContent = {
  readonly title: string;
  readonly body: string;
  readonly media: AnnouncementMedia;
};

export type Delivery =
  | { readonly kind: 'board' }
  | { readonly kind: 'interrupt'; readonly requireFullPlayback: boolean };

export type AnnouncementRevision = {
  readonly no: RevisionNo;
  readonly content: AnnouncementContent;
  readonly editedAt: IsoInstant;
  readonly editedBy: UserId;
  readonly material: boolean;
};

export type Announcement = {
  readonly id: AnnouncementId;
  readonly tenantId: TenantId;
  readonly authorId: UserId;
  readonly audience: Audience;
  readonly audienceUserIds: readonly UserId[];
  readonly delivery: Delivery;
  readonly requiresAck: boolean;
  readonly pinned: boolean;
  readonly publishedAt: IsoInstant;
  readonly expiresAt: IsoInstant | null;
  readonly revisions: readonly [AnnouncementRevision, ...AnnouncementRevision[]];
};

export function currentRevision(a: Announcement): AnnouncementRevision {
  return a.revisions[a.revisions.length - 1] ?? a.revisions[0];
}

export function ackRevision(a: Announcement): RevisionNo {
  for (let index = a.revisions.length - 1; index >= 0; index -= 1) {
    const rev = a.revisions[index];
    if (rev?.material) {
      return rev.no;
    }
  }
  return a.revisions[0].no;
}

export function isExpired(a: { readonly expiresAt: IsoInstant | null }, now: IsoInstant): boolean {
  if (a.expiresAt === null) {
    return false;
  }
  return Date.parse(a.expiresAt) <= Date.parse(now);
}

export type PublishAnnouncementRequest = {
  readonly clientId: ClientId;
  readonly content: AnnouncementContent;
  readonly audience: Audience;
  readonly expiresAt: IsoInstant | null;
  readonly pinned: boolean;
} & (
  | { readonly delivery: { readonly kind: 'board' }; readonly requiresAck: boolean }
  | { readonly delivery: { readonly kind: 'interrupt'; readonly requireFullPlayback: boolean }; readonly requiresAck: true }
);

export type AnnouncementEdit =
  | { readonly kind: 'content'; readonly content: AnnouncementContent; readonly material: boolean }
  | { readonly kind: 'expiry'; readonly expiresAt: IsoInstant | null }
  | { readonly kind: 'audience'; readonly audience: Audience }
  | { readonly kind: 'pin'; readonly pinned: boolean };

export type EditAnnouncementRequest = {
  readonly id: AnnouncementId;
  readonly edit: AnnouncementEdit;
};

/** O que o leitor recebe: sem audienceUserIds, sem a escolha de público e sem o histórico de revisões. */
export type AnnouncementForReader = Omit<Announcement, 'audience' | 'audienceUserIds' | 'revisions'> & {
  readonly current: AnnouncementRevision;
  readonly ackRevision: RevisionNo;
  readonly edited: boolean;
  readonly ilhaIds: readonly IlhaId[];
};

export type AnnouncementForAuthor = Announcement & { readonly tally: ReceiptTally };

export type AnnouncementBootstrap = {
  readonly board: readonly { readonly announcement: AnnouncementForReader; readonly receipt: ReceiptState }[];
  readonly authored: readonly AnnouncementForAuthor[];
};

export type PromptTrigger = 'connect' | 'became-available' | 'arrived' | 'reminder';

export type AnnouncementPrompt =
  | { readonly kind: 'none' }
  | { readonly kind: 'interrupt'; readonly queue: readonly [AnnouncementId, ...AnnouncementId[]] }
  | { readonly kind: 'open-board'; readonly first: AnnouncementId; readonly count: number }
  | { readonly kind: 'corner-alert'; readonly newest: AnnouncementId; readonly count: number };

export function announcementPrompt(input: {
  readonly entries: readonly { readonly announcement: AnnouncementForReader; readonly receipt: ReceiptState }[];
  readonly presence: PresenceStatus;
  readonly trigger: PromptTrigger;
  readonly firstLoginOfDay: boolean;
  readonly redirectedThisSession: boolean;
  readonly now: IsoInstant;
}): AnnouncementPrompt {
  const active = input.entries.filter((entry) => !isExpired(entry.announcement, input.now));

  if (input.presence.kind === 'available') {
    const interruptPending = active
      .filter(
        (entry) =>
          entry.announcement.delivery.kind === 'interrupt' &&
          entry.receipt.phase !== 'acknowledged',
      )
      .sort((a, b) => {
        const diff = Date.parse(a.announcement.publishedAt) - Date.parse(b.announcement.publishedAt);
        if (diff !== 0 && !Number.isNaN(diff)) {
          return diff;
        }
        return a.announcement.id < b.announcement.id ? -1 : a.announcement.id > b.announcement.id ? 1 : 0;
      });
    const [firstInterrupt, ...restInterrupts] = interruptPending;
    if (firstInterrupt) {
      return {
        kind: 'interrupt',
        queue: [firstInterrupt.announcement.id, ...restInterrupts.map((item) => item.announcement.id)],
      };
    }
  }

  const boardEntries = active.filter((entry) => entry.announcement.delivery.kind === 'board');
  const boardPending = boardEntries.filter(
    (entry) =>
      entry.receipt.phase === 'unseen' ||
      (entry.announcement.requiresAck && entry.receipt.phase !== 'acknowledged'),
  );
  if (input.firstLoginOfDay && !input.redirectedThisSession && boardPending[0]) {
    return {
      kind: 'open-board',
      first: boardPending[0].announcement.id,
      count: boardPending.length,
    };
  }

  const unseen = boardEntries
    .filter((entry) => entry.receipt.phase === 'unseen')
    .sort((a, b) => {
      const diff = Date.parse(b.announcement.publishedAt) - Date.parse(a.announcement.publishedAt);
      if (diff !== 0 && !Number.isNaN(diff)) {
        return diff;
      }
      return a.announcement.id < b.announcement.id ? 1 : a.announcement.id > b.announcement.id ? -1 : 0;
    });
  if (unseen[0]) {
    return {
      kind: 'corner-alert',
      newest: unseen[0].announcement.id,
      count: unseen.length,
    };
  }

  return { kind: 'none' };
}

export type ForwardAnnouncementRequest = {
  readonly announcementId: AnnouncementId;
  readonly targets: readonly [ConversationId, ...ConversationId[]];
  readonly clientId: ClientId;
};

export type AnnouncementForwardDenial =
  | 'not-member'
  | 'audience-not-covering'
  | 'cross-tenant'
  | 'expired'
  | 'not-readable';

/** Válido ⇔ mesmo tenant ∧ o ator é membro ∧ TODO membro atual do destino ∈ audienceUserIds (ou é o autor). */
export function canForwardAnnouncementTo(
  actor: StaffUser,
  a: Announcement,
  target: Conversation,
  now: IsoInstant,
): Result<true, AnnouncementForwardDenial> {
  if (actor.tenantId !== a.tenantId || target.tenantId !== a.tenantId) {
    return err('cross-tenant');
  }
  const audience = new Set<UserId>(a.audienceUserIds);
  if (a.authorId !== actor.id && !audience.has(actor.id)) {
    return err('not-readable');
  }
  if (isExpired(a, now)) {
    return err('expired');
  }
  const members = target.kind === 'direct' ? target.participants : target.members;
  if (!members.includes(actor.id)) {
    return err('not-member');
  }
  const covered = members.every((memberId) => memberId === a.authorId || audience.has(memberId));
  if (!covered) {
    return err('audience-not-covering');
  }
  return ok(true);
}
