import {
  auditPageSchema,
  companyCommandResultSchema,
  companyDeskSchema,
  qualityReportSchema,
  type AuditPage,
  type AuditQuery,
  type CompanyCommandEnvelope,
  type CompanyCommandResult,
  type CompanyDesk,
  type QualityQuery,
  type QualityReport,
} from '@viavoip/protocol';

type Parser<T> = {
  safeParse(data: unknown): { success: true; data: T } | { success: false };
};

export type CompanySession = {
  token: string;
};

export async function loadCompanyDesk(session: CompanySession): Promise<CompanyDesk> {
  return readJson('/company/desk', companyDeskSchema, session.token);
}

export async function applyCompanyCommand(
  session: CompanySession,
  envelope: CompanyCommandEnvelope,
): Promise<CompanyCommandResult> {
  return sendJson('/company/commands', companyCommandResultSchema, session.token, envelope);
}

export async function loadQualityReport(session: CompanySession, query: QualityQuery): Promise<QualityReport> {
  return readJson(`/quality/report?${qualitySearch(query)}`, qualityReportSchema, session.token);
}

export async function loadAuditPage(session: CompanySession, query: AuditQuery): Promise<AuditPage> {
  const params = new URLSearchParams();
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.action) params.set('action', query.action);
  if (query.cursor) params.set('cursor', query.cursor);
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return readJson(`/audit/events${suffix}`, auditPageSchema, session.token);
}

export function qualitySearch(query: QualityQuery): string {
  const params = new URLSearchParams({ scopeKind: query.scope.kind, from: query.from, to: query.to });
  if (query.scope.kind === 'sector') params.set('sectorId', query.scope.sectorId);
  if (query.scope.kind === 'queue') params.set('queueId', query.scope.queueId);
  return params.toString();
}

async function readJson<T>(path: string, schema: Parser<T>, token: string): Promise<T> {
  const response = await fetch(path, { headers: { authorization: `Bearer ${token}` } });
  return parseResponse(response, schema);
}

async function sendJson<T>(path: string, schema: Parser<T>, token: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseResponse(response, schema);
}

async function parseResponse<T>(response: Response, schema: Parser<T>): Promise<T> {
  const payload: unknown = await response.json();
  const parsed = schema.safeParse(payload);
  if (!response.ok || !parsed.success) {
    throw new Error(messageFrom(payload) ?? 'Falha na gestão da empresa');
  }
  return parsed.data;
}

function messageFrom(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || !('error' in payload)) return null;
  const error = payload.error;
  if (!error || typeof error !== 'object' || !('message' in error) || typeof error.message !== 'string') return null;
  return error.message;
}
