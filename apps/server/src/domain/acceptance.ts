import type { EffectiveAcceptance, ServiceCalendar, ConfiguredAcceptance } from '@viavoip/protocol';

export function resolveAcceptance(
  acceptance: ConfiguredAcceptance,
  calendar: ServiceCalendar,
  timeZone: string,
  nowIso: string,
): EffectiveAcceptance {
  void acceptance;
  void calendar;
  void timeZone;
  void nowIso;
  throw new Error('not implemented');
}
