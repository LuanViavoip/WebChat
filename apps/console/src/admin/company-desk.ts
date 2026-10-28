import type {
  AuditPage,
  AuditQuery,
  CompanyCommandEnvelope,
  CompanyCommandResult,
  CompanyDesk,
  QualityQuery,
  QualityReport,
} from '@viavoip/protocol';

export type CompanySession = {
  token: string;
};

export async function loadCompanyDesk(session: CompanySession): Promise<CompanyDesk> {
  void session;
  throw new Error('not implemented');
}

export async function applyCompanyCommand(
  session: CompanySession,
  envelope: CompanyCommandEnvelope,
): Promise<CompanyCommandResult> {
  void session;
  void envelope;
  throw new Error('not implemented');
}

export async function loadQualityReport(session: CompanySession, query: QualityQuery): Promise<QualityReport> {
  void session;
  void query;
  throw new Error('not implemented');
}

export async function loadAuditPage(session: CompanySession, query: AuditQuery): Promise<AuditPage> {
  void session;
  void query;
  throw new Error('not implemented');
}
