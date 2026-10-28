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
import type { SessionService } from '../auth/sessions.js';
import type { AuditQueryService } from '../modules/audit-query.js';
import type { CompanyAdministrationService } from '../modules/company-administration.js';
import type { OperationalQualityService } from '../modules/operational-quality.js';

export type CompanyHttpDeps = {
  sessions: SessionService;
  administration: CompanyAdministrationService;
  quality: OperationalQualityService;
  audit: AuditQueryService;
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

export function registerCompanyHttp(_app: FastifyInstance, _deps: CompanyHttpDeps): void {
  void companyHttpCatalog;
  throw new Error('not implemented');
}
