import {
  authMeSchema,
  createVisitorSessionBodySchema,
  loginBodySchema,
  loginResponseSchema,
  logoutResponseSchema,
  publicWidgetSchema,
  visitorContextSchema,
  visitorSessionCreatedSchema,
} from '@viavoip/protocol';
import type { FastifyInstance } from 'fastify';
import type { ZodType } from 'zod';
import { readBearer } from '../auth/handshake.js';
import type { SessionService } from '../auth/sessions.js';
import { DomainError, httpStatus } from '../domain/errors.js';
import type { SlidingWindowLimiter } from './rate-limit.js';

export function registerHttp(
  app: FastifyInstance,
  deps: {
    sessions: SessionService;
    smAdapter: string;
    limiter: SlidingWindowLimiter;
    sessionCreateLimit: number;
  },
): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) {
      void reply.status(httpStatus(error.code)).send({
        error: { code: error.code, message: error.message },
      });
      return;
    }
    request.log.error(error);
    void reply.status(500).send({ error: { code: 'internal', message: 'Falha interna' } });
  });

  app.get('/health', async () => ({ ok: true, smAdapter: deps.smAdapter }));

  app.get('/public/widgets/:publicId', async (request) => {
    const publicId = (request.params as { publicId?: string }).publicId ?? '';
    if (!/^[a-z0-9_-]+$/.test(publicId)) throw new DomainError('invalid_payload', 'Payload inválido');
    return publicWidgetSchema.parse(await deps.sessions.publicWidget(publicId));
  });

  app.post('/visitor/sessions', async (request) => {
    if (!deps.limiter.allow(`session:${request.ip}`, deps.sessionCreateLimit)) {
      throw new DomainError('rate_limited', 'Muitas sessões criadas. Tente novamente.');
    }
    const body = parseBody(createVisitorSessionBodySchema, request.body);
    const created = await deps.sessions.createVisitorSession(body.sitePublicId, body.parentOrigin);
    return visitorSessionCreatedSchema.parse(created);
  });

  app.get('/visitor/me', async (request) => {
    const principal = await deps.sessions.authenticateVisitor(readBearer(request.headers.authorization));
    if (!principal) throw new DomainError('unauthorized', 'Sessão ausente');
    return visitorContextSchema.parse(await deps.sessions.visitorContext(principal));
  });

  app.post('/auth/login', async (request) => {
    const body = parseBody(loginBodySchema, request.body);
    const session = await deps.sessions.login(body.email, body.password);
    return loginResponseSchema.parse(session);
  });

  app.get('/auth/me', async (request) => {
    const principal = await requireAgent(deps.sessions, request.headers.authorization);
    return authMeSchema.parse(await deps.sessions.agentProfile(principal));
  });

  app.post('/auth/logout', async (request) => {
    const principal = await requireAgent(deps.sessions, request.headers.authorization);
    await deps.sessions.logout(principal);
    return logoutResponseSchema.parse({ ok: true });
  });
}

async function requireAgent(sessions: SessionService, header: string | undefined) {
  const principal = await sessions.authenticateAgent(readBearer(header));
  if (!principal) throw new DomainError('unauthorized', 'Sessão ausente');
  return principal;
}

function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new DomainError('invalid_payload', 'Payload inválido');
  return parsed.data;
}
