import type { CompanyCommandResult, CompanyDesk } from '@viavoip/protocol';
import { useCallback, useEffect, useState } from 'react';
import { Tabs, type TabItem } from '../ui/Tabs.js';
import { ErrorState, LoadingState } from '../ui/states.js';
import { useToast } from '../ui/Toast.js';
import type { AdminContext } from './AdminContext.js';
import { loadCompanyDesk } from './company-desk.js';
import { AuditSection } from './sections/AuditSection.js';
import { CompanySection } from './sections/CompanySection.js';
import { DispositionsSection } from './sections/DispositionsSection.js';
import { QueuesSection } from './sections/QueuesSection.js';
import { SitesSection } from './sections/SitesSection.js';
import { SlaSection } from './sections/SlaSection.js';
import { SurveySection } from './sections/SurveySection.js';
import { UsersSection } from './sections/UsersSection.js';

const tabs: TabItem[] = [
  { id: 'company', label: 'Empresa' },
  { id: 'users', label: 'Usuários e Permissões' },
  { id: 'queues', label: 'Filas' },
  { id: 'dispositions', label: 'Classificações' },
  { id: 'sites', label: 'Sites e Widgets' },
  { id: 'sla', label: 'SLA' },
  { id: 'survey', label: 'Pesquisa' },
  { id: 'audit', label: 'Auditoria' },
];

export function AdminPanel({ token }: { token: string }) {
  const [desk, setDesk] = useState<CompanyDesk | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('company');
  const [summary, setSummary] = useState('');
  const toast = useToast();

  const load = useCallback(() => {
    setError('');
    loadCompanyDesk({ token })
      .then(setDesk)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Falha na gestão da empresa'));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const applyResult = useCallback((result: CompanyCommandResult) => setDesk(result.desk), []);
  const announce = useCallback(
    (message: string, result: CompanyCommandResult) => {
      setSummary(`${message}. Pedido ${result.receipt.requestId}. ${result.receipt.replayed ? 'Repetido' : 'Efeito único'}.`);
      toast.notify('ok', message);
    },
    [toast],
  );

  if (error && !desk) return <ErrorState title="Administração indisponível" message={error} onRetry={load} />;
  if (!desk) return <LoadingState label="Carregando a empresa…" />;

  const ctx: AdminContext = { token, desk, applyResult, announce };
  const current = tabs.find((item) => item.id === tab);

  return (
    <div className="admin">
      <div className="admin__nav">
        <Tabs tabs={tabs} value={tab} onChange={setTab} label="Seções da administração" idPrefix="admin" side />
      </div>
      <div className="admin__body" role="tabpanel" id={`admin-panel-${tab}`} aria-labelledby={`admin-${tab}`}>
        <h2 className="sr-only">{current?.label}</h2>
        {summary ? <p className="status-line" data-testid="command-result">{summary}</p> : null}
        {tab === 'company' ? <CompanySection ctx={ctx} /> : null}
        {tab === 'users' ? <UsersSection ctx={ctx} /> : null}
        {tab === 'queues' ? <QueuesSection ctx={ctx} /> : null}
        {tab === 'dispositions' ? <DispositionsSection ctx={ctx} /> : null}
        {tab === 'sites' ? <SitesSection ctx={ctx} /> : null}
        {tab === 'sla' ? <SlaSection ctx={ctx} /> : null}
        {tab === 'survey' ? <SurveySection ctx={ctx} /> : null}
        {tab === 'audit' ? <AuditSection token={token} /> : null}
      </div>
    </div>
  );
}
