import {
  auditPageSchema,
  auditQuerySchema,
  companyCommandEnvelopeSchema,
  companyCommandResultSchema,
  companyDeskSchema,
  qualityReportQuerySchema,
  qualityReportSchema,
} from '@viavoip/protocol';
import type { FastifyInstance } from 'fastify';
import type { Server } from 'socket.io';
import type { ZodType } from 'zod';
import { readBearer } from '../auth/handshake.js';
import type { SessionService } from '../auth/sessions.js';
import { DomainError } from '../domain/errors.js';
import type { AuditQueryService } from '../modules/audit-query.js';
import type { CompanyAdministrationService } from '../modules/company-administration.js';
import type { OperationalQualityService } from '../modules/operational-quality.js';
import { revokeRealtimeSessions } from '../realtime/revoke.js';

export type CompanyHttpDeps = {
  sessions: SessionService;
  administration: CompanyAdministrationService;
  quality: OperationalQualityService;
  audit: AuditQueryService;
  io: Server;
};

export const companyHttpCatalog = {
  desk: { method: 'GET' as const, path: '/company/desk', response: companyDeskSchema },
  command: {
    method: 'POST' as const,
    path: '/company/commands',
    body: companyCommandEnvelopeSchema,
    response: companyCommandResultSchema,
  },
  quality: {
    method: 'GET' as const,
    path: '/quality/report',
    query: qualityReportQuerySchema,
    response: qualityReportSchema,
  },
  audit: {
    method: 'GET' as const,
    path: '/audit/events',
    query: auditQuerySchema,
    response: auditPageSchema,
  },
};

export function registerCompanyHttp(app: FastifyInstance, deps: CompanyHttpDeps): void {
  app.get(companyHttpCatalog.desk.path, async (request) => {
    const principal = await requireAgent(deps.sessions, request.headers.authorization);
    return companyDeskSchema.parse(await deps.administration.load(principal));
  });

  app.post(companyHttpCatalog.command.path, async (request) => {
    const principal = await requireAgent(deps.sessions, request.headers.authorization);
    const body = parsePayload(companyCommandEnvelopeSchema, request.body);
    const applied = await deps.administration.apply(principal, body);
    revokeRealtimeSessions(deps.io, applied.revokedSessionIds);
    return companyCommandResultSchema.parse(applied.result);
  });

  app.get(companyHttpCatalog.quality.path, async (request) => {
    const principal = await requireAgent(deps.sessions, request.headers.authorization);
    const query = parsePayload(qualityReportQuerySchema, request.query);
    return qualityReportSchema.parse(await deps.quality.report(principal, query));
  });

  app.get(companyHttpCatalog.audit.path, async (request) => {
    const principal = await requireAgent(deps.sessions, request.headers.authorization);
    const query = parsePayload(auditQuerySchema, request.query);
    return auditPageSchema.parse(await deps.audit.page(principal, query));
  });
}

async function requireAgent(sessions: SessionService, header: string | undefined) {
  const principal = await sessions.authenticateAgent(readBearer(header));
  if (!principal) throw new DomainError('unauthorized', 'Sessão ausente');
  return principal;
}

function parsePayload<T>(schema: ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new DomainError('invalid_payload', 'Payload inválido');
  return parsed.data;
}
