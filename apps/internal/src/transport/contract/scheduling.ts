import type { ScheduledId } from '@viavoip/internal-domain';

export type { ScheduleRequest, ScheduleState, ScheduledItem } from '@viavoip/internal-domain';

export type CancelScheduledRequest = { readonly id: ScheduledId };
