import type { ZodType } from 'zod';
import type { Socket } from 'socket.io';
import { DomainError } from '../domain/errors.js';
import type { AppLogger } from './logger.js';

export function bindSocket(
  socket: Socket,
  schemas: Record<string, ZodType>,
  handlers: Record<string, (payload: unknown) => Promise<object>>,
  logger: AppLogger,
): void {
  socket.onAny(async (event: string, ...args: unknown[]) => {
    const last = args.at(-1);
    const hasAck = typeof last === 'function';
    const ack = hasAck ? (last as (response: unknown) => void) : null;
    const raw = hasAck ? args.slice(0, -1)[0] : args[0];
    const payload = raw === undefined ? {} : raw;
    const respond = (response: unknown) => {
      ack?.(response);
    };
    const schema = schemas[event];
    const handler = handlers[event];
    if (!schema || !handler) {
      respond({ ok: false, error: { code: 'forbidden', message: 'Evento não autorizado' } });
      return;
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      respond({ ok: false, error: { code: 'invalid_payload', message: 'Payload inválido' } });
      return;
    }
    try {
      const result = await handler(parsed.data);
      respond({ ok: true, ...result });
    } catch (error) {
      if (!(error instanceof DomainError)) logger.error({ err: error, event }, 'falha ao processar evento');
      const domain = error instanceof DomainError ? error : new DomainError('internal', 'Falha interna');
      respond({ ok: false, error: { code: domain.code, message: domain.message } });
    }
  });
}
