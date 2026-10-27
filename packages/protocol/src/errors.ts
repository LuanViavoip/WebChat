import { z } from 'zod';

export const errorCodes = [
  'unauthorized',
  'forbidden',
  'not_found',
  'invalid_payload',
  'invalid_state',
  'already_claimed',
  'capacity',
  'conflict',
  'rate_limited',
  'internal',
] as const;

export const errorCodeSchema = z.enum(errorCodes);

export const errorBodySchema = z
  .object({
    code: errorCodeSchema,
    message: z.string().min(1).max(300),
  })
  .strict();

export const failureAckSchema = z
  .object({
    ok: z.literal(false),
    error: errorBodySchema,
  })
  .strict();

export type ErrorCode = z.infer<typeof errorCodeSchema>;
export type ErrorBody = z.infer<typeof errorBodySchema>;
export type FailureAck = z.infer<typeof failureAckSchema>;
