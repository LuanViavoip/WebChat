import type { ZodType } from 'zod';
import type { Socket } from 'socket.io';
import { DomainError } from '../domain/errors.js';
import type { AppLogger } from './logger.js';
import { rooms } from './rooms.js';

export function joinSessionRoom(
  socket: Socket,
  principal: { sessionId: string; expiresAt: string },
  validate: () => Promise<boolean>,
): Promise<boolean> {
  socket.join(rooms.session(principal.sessionId));
  const sessionValidation = validate().catch(() => false);
  socket.data.sessionValidation = sessionValidation;
  void sessionValidation.then((active) => {
    if (!active) socket.disconnect(true);
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const disconnectAtExpiry = () => {
    const remaining = Date.parse(principal.expiresAt) - Date.now();
    if (remaining <= 0) {
      socket.disconnect(true);
      return;
    }
    timer = setTimeout(disconnectAtExpiry, Math.min(remaining, 2_147_000_000));
    timer.unref?.();
  };
  disconnectAtExpiry();
  socket.once('disconnect', () => {
    if (timer) clearTimeout(timer);
  });
  return sessionValidation;
}

export async function afterSessionValidation<T>(
  socket: Socket,
  sessionReady: Promise<boolean>,
  enterDataRooms: () => Promise<T> | T,
): Promise<T | undefined> {
  if (!(await sessionReady) || !socket.connected) return undefined;
  return enterDataRooms();
}

export function bindSocket(
  socket: Socket,
  schemas: Record<string, ZodType>,
  handlers: Record<string, (payload: unknown) => Promise<object>>,
  logger: AppLogger,
  revalidate?: () => Promise<boolean>,
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
      if (revalidate && !(await revalidate())) {
        socket.disconnect(true);
        respond({ ok: false, error: { code: 'unauthorized', message: 'Sessão revogada' } });
        return;
      }
      const sessionValidation = socket.data.sessionValidation as Promise<boolean> | undefined;
      if (sessionValidation && !(await sessionValidation)) {
        socket.disconnect(true);
        respond({ ok: false, error: { code: 'unauthorized', message: 'Sessão revogada' } });
        return;
      }
      const principal = socket.data.principal as { expiresAt?: string } | undefined;
      if (principal?.expiresAt && Date.parse(principal.expiresAt) <= Date.now()) {
        socket.disconnect(true);
        respond({ ok: false, error: { code: 'unauthorized', message: 'Sessão expirada' } });
        return;
      }
      const result = await handler(parsed.data);
      respond({ ok: true, ...result });
    } catch (error) {
      if (!(error instanceof DomainError)) logger.error({ err: error, event }, 'falha ao processar evento');
      const domain = error instanceof DomainError ? error : new DomainError('internal', 'Falha interna');
      respond({ ok: false, error: { code: domain.code, message: domain.message } });
    }
  });
}
