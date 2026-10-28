import type { Role } from '@viavoip/protocol';
import { useEffect, useState } from 'react';
import { loadAuditPage, loadCompanyDesk, loadQualityReport } from './company-desk.js';

export function CompanyPanel({ token, role, mode }: { token: string; role: Role; mode: 'company' | 'quality' }) {
  const [summary, setSummary] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const session = { token };
    const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const to = new Date().toISOString();
    if (mode === 'quality' && role !== 'admin') {
      setSummary('O relatório segue os setores sob supervisão.');
      return () => {
        active = false;
      };
    }
    const load = mode === 'company'
      ? Promise.all([loadCompanyDesk(session), loadAuditPage(session, { from, to })]).then(([desk, audit]) => {
          if (!active) return;
          setSummary(`${desk.company.name} · ${desk.agents.length} pessoas · ${audit.entries.length} eventos`);
        })
      : loadQualityReport(session, { scope: { kind: 'tenant' }, from, to }).then((report) => {
          if (!active) return;
          setSummary(`Espera concluída: ${report.queueWaits.completed}`);
        });
    void load.catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Falha na gestão da empresa');
    });
    return () => {
      active = false;
    };
  }, [mode, role, token]);

  return (
    <section>
      <h2>{mode === 'company' ? 'Administração' : 'Qualidade'}</h2>
      {error ? <p>{error}</p> : <p>{summary || 'Carregando…'}</p>}
    </section>
  );
}
