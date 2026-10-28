import type { AuditPage, AuditQuery, CompanyCommand, CompanyDesk, QualityQuery, QualityReport } from '@viavoip/protocol';

export type CompanySession = {
  token: string;
};

export async function loadCompanyDesk(session: CompanySession): Promise<CompanyDesk> {
  void session;
  throw new Error('not implemented');
}

export async function applyCompanyCommand(
  session: CompanySession,
  command: CompanyCommand,
): Promise<CompanyDesk> {
  void session;
  void command;
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
