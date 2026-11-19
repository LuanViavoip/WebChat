import type { AnnouncementId } from '@viavoip/internal-domain';

export type {
  AnnouncementBootstrap,
  AnnouncementEdit,
  AnnouncementForAuthor,
  AnnouncementForReader,
  AnnouncementForwardDenial,
  AnnouncementMedia,
  AnnouncementRevision,
  AnnouncementRevisionRef,
  Audience,
  Delivery,
  EditAnnouncementRequest,
  ForwardAnnouncementRequest,
  PlaybackReport,
  PublishAnnouncementRequest,
  ReceiptState,
  ReceiptTally,
  ReceiptsPanel,
} from '@viavoip/internal-domain';

export type AnnouncementIdRequest = { readonly id: AnnouncementId };
export type RemindAnnouncementResult = { readonly reminded: number };
