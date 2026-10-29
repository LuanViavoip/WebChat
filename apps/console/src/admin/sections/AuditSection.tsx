import { knownAuditActions, type AuditEntry, type KnownAuditAction } from '@viavoip/protocol';
import { ScrollText } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { formatDateTime } from '../../desk/format.js';
import { validatePeriod } from '../../quality/period.js';
import { Button } from '../../ui/Button.js';
import { Card } from '../../ui/Card.js';
import { DataTable, type Column } from '../../ui/DataTable.js';
import { Field, Input, Select } from '../../ui/Field.js';
import { EmptyState, ErrorState, LoadingState } from '../../ui/states.js';
import { auditActionLabel, auditActionLabels } from '../audit-labels.js';
import { loadAuditPage } from '../company-desk.js';

type Filters = { from: string; to: string; action: '' | KnownAuditAction };
type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready' };

const columns: Column<AuditEntry>[] = [
  { key: 'at', header: 'Quando', render: (entry) => <time dateTime={entry.at}>{formatDateTime(entry.at)}</time> },
  { key: 'actor', header: 'Quem', render: (entry) => entry.actorName },
  { key: 'action', header: 'Ação', render: (entry) => auditActionLabel(entry.action) },
  {
    key: 'resource',
    header: 'Recurso',
    render: (entry) => (
      <span className="cell-muted">
        {entry.resource.type}
        {entry.resource.presence === 'id' ? <span className="mono"> · {entry.resource.id.slice(0, 8)}</span> : null}
      </span>
    ),
  },
];

export function AuditSection({ token }: { token: string }) {
  const [filters, setFilters] = useState<Filters>({ from: '', to: '', action: '' });
  const [applied, setApplied] = useState<Filters>(filters);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<State>({ status: 'loading' });
  const [loadingMore, setLoadingMore] = useState(false);
  const period = filters.from || filters.to ? validatePeriod(filters.from, filters.to) : null;

  const fetchPage = useCallback(
    async (query: Filters, after: string | null) => {
      const range = query.from || query.to ? validatePeriod(query.from, query.to) : null;
      if (range && !range.ok) throw new Error(range.message);
      return loadAuditPage(
        { token },
        {
          ...(range?.ok ? { from: range.from, to: range.to } : {}),
          ...(query.action ? { action: query.action } : {}),
          ...(after ? { cursor: after } : {}),
        },
      );
    },
    [token],
  );

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    void fetchPage(applied, null)
      .then((page) => {
        if (!active) return;
        setEntries(page.entries);
        setCursor(page.nextCursor);
        setState({ status: 'ready' });
      })
      .catch((reason: unknown) => {
        if (active) setState({ status: 'error', message: reason instanceof Error ? reason.message : 'Falha ao carregar a auditoria' });
      });
    return () => {
      active = false;
    };
  }, [applied, fetchPage]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(applied, cursor);
      setEntries((current) => [...current, ...page.entries]);
      setCursor(page.nextCursor);
    } catch (reason: unknown) {
      setState({ status: 'error', message: reason instanceof Error ? reason.message : 'Falha ao carregar mais eventos' });
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <Card title="Auditoria">
      <form
        className="toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          if (period && !period.ok) return;
          setApplied(filters);
        }}
      >
        <Field label="De">
          <Input type="datetime-local" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} />
        </Field>
        <Field label="Até">
          <Input type="datetime-local" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} />
        </Field>
        <Field label="Ação">
          <Select value={filters.action} onChange={(event) => setFilters({ ...filters, action: knownAuditActions.find((item) => item === event.target.value) ?? '' })}>
            <option value="">Todas</option>
            {knownAuditActions.map((action) => (
              <option key={action} value={action}>{auditActionLabels[action]}</option>
            ))}
          </Select>
        </Field>
        <Button type="submit" disabled={period !== null && !period.ok}>Filtrar</Button>
      </form>
      {period && !period.ok ? <p className="form-error" role="alert">{period.message}</p> : (
        <p className="page__meta">Sem período, mostra as últimas 24 horas. Período máximo de 31 dias.</p>
      )}
      {state.status === 'loading' ? <LoadingState label="Carregando eventos…" /> : null}
      {state.status === 'error' ? <ErrorState title="Auditoria indisponível" message={state.message} onRetry={() => setApplied({ ...applied })} /> : null}
      {state.status === 'ready' ? (
        <>
          <DataTable
            caption="Eventos de auditoria"
            columns={columns}
            rows={entries}
            rowKey={(entry) => entry.id}
            empty={<EmptyState icon={ScrollText} title="Nenhum evento no período" description="Ajuste o período ou a ação para ver outros eventos." />}
          />
          {cursor ? (
            <div className="form-actions">
              <Button variant="secondary" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? 'Carregando…' : 'Carregar mais'}</Button>
            </div>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}
