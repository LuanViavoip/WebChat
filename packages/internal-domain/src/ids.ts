import type { Brand } from './tenant';

export type MessageId = Brand<string, 'MessageId'>;
export type ClientId = Brand<string, 'ClientId'>;
export type AnnouncementId = Brand<string, 'AnnouncementId'>;
export type RevisionNo = Brand<number, 'RevisionNo'>;
export type PollOptionId = Brand<string, 'PollOptionId'>;
export type ScheduledId = Brand<string, 'ScheduledId'>;
export type QuickReplyId = Brand<string, 'QuickReplyId'>;
export type Emoji = Brand<string, 'Emoji'>;
export type IsoInstant = Brand<string, 'IsoInstant'>;

export const asMessageId = (value: string): MessageId => value as MessageId;
export const asClientId = (value: string): ClientId => value as ClientId;
export const asAnnouncementId = (value: string): AnnouncementId => value as AnnouncementId;
export const asRevisionNo = (value: number): RevisionNo => value as RevisionNo;
export const asPollOptionId = (value: string): PollOptionId => value as PollOptionId;
export const asScheduledId = (value: string): ScheduledId => value as ScheduledId;
export const asQuickReplyId = (value: string): QuickReplyId => value as QuickReplyId;
export const asIsoInstant = (value: string): IsoInstant => value as IsoInstant;

/** Aceita exatamente um grafema que contenha um pictograma estendido. */
export function parseEmoji(raw: string): Emoji | null {
  if (!/\p{Extended_Pictographic}/u.test(raw)) return null;
  const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(raw)];
  return segments.length === 1 ? raw as Emoji : null;
}
