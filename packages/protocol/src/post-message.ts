import { z } from 'zod';

export const WIDGET_SOURCE = 'viavoip-webchat';
export const PARENT_SOURCE = 'viavoip-webchat-parent';

export const widgetToParentSchema = z.discriminatedUnion('type', [
  z
    .object({
      source: z.literal(WIDGET_SOURCE),
      type: z.literal('ready'),
    })
    .strict(),
  z
    .object({
      source: z.literal(WIDGET_SOURCE),
      type: z.literal('open'),
    })
    .strict(),
  z
    .object({
      source: z.literal(WIDGET_SOURCE),
      type: z.literal('close'),
    })
    .strict(),
  z
    .object({
      source: z.literal(WIDGET_SOURCE),
      type: z.literal('resize'),
      width: z.number().int().min(64).max(480),
      height: z.number().int().min(64).max(720),
    })
    .strict(),
]);

export const parentToWidgetSchema = z.discriminatedUnion('type', [
  z
    .object({
      source: z.literal(PARENT_SOURCE),
      type: z.literal('open'),
    })
    .strict(),
  z
    .object({
      source: z.literal(PARENT_SOURCE),
      type: z.literal('close'),
    })
    .strict(),
]);

export type WidgetToParent = z.infer<typeof widgetToParentSchema>;
export type ParentToWidget = z.infer<typeof parentToWidgetSchema>;

export function isAllowedOrigin(origin: string, allowedOrigins: readonly string[]): boolean {
  return allowedOrigins.includes(origin);
}

export function parentOriginFromReferrer(
  referrer: string,
  allowedOrigins: readonly string[],
): string | null {
  if (!referrer) return null;
  try {
    const origin = new URL(referrer).origin;
    return isAllowedOrigin(origin, allowedOrigins) ? origin : null;
  } catch {
    return null;
  }
}
