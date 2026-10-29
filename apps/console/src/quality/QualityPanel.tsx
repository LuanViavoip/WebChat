import { sectorListAckSchema, type QualityReport, type QueueSummary, type Role, type SectorSummary } from '@viavoip/protocol';
import { BarChart3, ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { loadQualityReport } from '../admin/company-desk.js';
import { formatSeconds } from '../desk/format.js';
import { emitAck } from '../realtime.js';
import { Button } from '../ui/Button.js';
import { Card, StatCard } from '../ui/Card.js';
import { DataTable, type Column } from '../ui/DataTable.js';
import { Field, Input, Select } from '../ui/Field.js';
import { EmptyState, ErrorState, LoadingState } from '../ui/states.js';
import { scopeOptions } from './scope.js';
import { MAX_QUALITY_WINDOW_MS, presetPeriod, validatePeriod } from './period.js';
import { coverageTotal, formatPercent, slaCompliance } from './summary.js';

type Props = {
  token: string;
  role: Role;
  selfId: string;
  socket: Socket | null;
  queues: QueueSummary[];
};

type Load = { state: 'idle' } | { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; report: QualityReport };

export function QualityPanel({ token, role, selfId, socket, queues }: Props) {
  const [sectors, setSectors] = useState<SectorSummary[]>([]);
  const [scopeValue, setScopeValue] = useState('');
  const [period, setPeriod] = useState(() => presetPeriod(Date.now(), 7));
  // Para supervisor, os setores definem o escopo padrão: espera a lista antes da primeira consulta.
  const [ready, setReady] = useState(role === 'admin');
  const [load, setLoad] = useState<Load>({ state: 'idle' });
  const options = useMemo(() => scopeOptions(role, selfId, sectors, queues), [role, selfId, sectors, queues]);
  const check = validatePeriod(period.from, period.to);
  const rangeFrom = check.ok ? check.from : '';
  const rangeTo = check.ok ? check.to : '';
  const selected = options.find((option) => option.value === scopeValue) ?? options[0];

  useEffect(() => {
    if (!socket) return;
    const reload = () => {
      void emitAck(socket, 'sector.list', {}).then((ack) => {
        const parsed = sectorListAckSchema.safeParse(ack);
        if (parsed.success && parsed.data.ok) setSectors(parsed.data.sectors);
      }).catch(() => undefined).finally(() => setReady(true));
    };
    socket.on('connect', reload);
    if (socket.connected) reload();
    return () => {
      socket.off('connect', reload);
    };
  }, [socket]);

  const generate = useCallback(async () => {
    if (!selected || !rangeFrom || !rangeTo) return;
    setLoad({ state: 'loading' });
    try {
      const report = await loadQualityReport({ token }, { scope: selected.scope, from: rangeFrom, to: rangeTo });
      setLoad({ state: 'ready', report });
    } catch (reason: unknown) {
      setLoad({ state: 'error', message: reason instanceof Error ? reason.message : 'Não foi possível gerar o relatório' });
    }
  }, [rangeFrom, rangeTo, selected, token]);

  // Primeira carga assim que o escopo padrão existe.
  const firstValue = options[0]?.value;
  useEffect(() => {
    if (ready && firstValue && load.state === 'idle') void generate();
  }, [ready, firstValue, generate, load.state]);

  if (!ready) return <LoadingState label="Carregando escopos…" />;

  if (options.length === 0) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Nenhum escopo disponível"
        description={
          role === 'supervisor'
            ? 'O relatório cobre os setores em que você é responsável e as filas sob sua supervisão. Nenhum foi encontrado para a sua conta.'
            : 'Não há setores ou filas para consultar.'
        }
      />
    );
  }

  return (
    <div className="page">
      <Card>
        <form
          className="toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            void generate();
          }}
        >
          <Field label="Escopo">
            <Select value={selected?.value ?? ''} onChange={(event) => setScopeValue(event.target.value)}>
              {options.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="De">
            <Input type="datetime-local" value={period.from} onChange={(event) => setPeriod({ ...period, from: event.target.value })} />
          </Field>
          <Field label="Até">
            <Input type="datetime-local" value={period.to} onChange={(event) => setPeriod({ ...period, to: event.target.value })} />
          </Field>
          <div className="chip-list">
            <Button variant="ghost" size="sm" onClick={() => setPeriod(presetPeriod(Date.now(), 1))}>24 h</Button>
            <Button variant="ghost" size="sm" onClick={() => setPeriod(presetPeriod(Date.now(), 7))}>7 dias</Button>
            <Button variant="ghost" size="sm" onClick={() => setPeriod(presetPeriod(Date.now(), 31))}>31 dias</Button>
          </div>
          <Button type="submit" icon={<BarChart3 size={16} />} disabled={!check.ok || load.state === 'loading'}>Gerar relatório</Button>
        </form>
        {!check.ok ? <p className="form-error" role="alert">{check.message}</p> : (
          <p className="page__meta">Período máximo de {Math.round(MAX_QUALITY_WINDOW_MS / 86_400_000)} dias.</p>
        )}
      </Card>
      {load.state === 'loading' ? <LoadingState label="Gerando relatório…" /> : null}
      {load.state === 'error' ? <ErrorState title="Relatório indisponível" message={load.message} onRetry={() => void generate()} /> : null}
      {load.state === 'ready' ? <ReportView report={load.report} /> : null}
    </div>
  );
}

function ReportView({ report }: { report: QualityReport }) {
  const coverage = report.firstResponseCoverage;
  const survey = report.survey;
  return (
    <>
      <section className="page__section" aria-label="Tempos">
        <h2>Tempos</h2>
        <div className="stat-grid">
          <DurationCard title="Espera na fila" summary={report.queueWait} />
          <DurationCard title="Primeira resposta" summary={report.firstResponse} />
          <DurationCard title="Tempo médio de atendimento (TMA)" summary={report.handleTime} />
        </div>
      </section>
      <section className="page__section" aria-label="Resultados">
        <h2>Resultados</h2>
        <div className="stat-grid">
          <StatCard label="Abandonos na fila" value={report.queueWaits.abandoned} tone="warning" description={`Concluídas: ${report.queueWaits.completed} · Em espera: ${report.queueWaits.open} · Ilegíveis: ${report.queueWaits.unreadable}`} />
          <StatCard label="Primeira resposta dada" value={`${coverage.answered} de ${coverageTotal(coverage)}`} tone="success" description={`Sem resposta (encerradas): ${coverage.unansweredClosed} · Transferidas sem resposta: ${coverage.transferredUnanswered} · Em aberto: ${coverage.stillOpen}`} />
          <StatCard label="Atendimentos classificados" value={report.completions.classified} tone="info" />
          <StatCard
            label="Pesquisa de satisfação"
            value={survey.responses === 0 ? 'Sem respostas' : `${(survey.averageScore ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} / 5`}
            tone="info"
            description={`${survey.responses} resposta(s)${survey.comments.kind === 'some' ? ` · ${survey.comments.count} comentário(s)` : ''}`}
          />
        </div>
      </section>
      <Card title="Cumprimento de SLA">
        <DataTable
          caption="Cumprimento de SLA"
          columns={slaColumns}
          rows={[
            { id: 'wait', label: 'Espera na fila', tally: report.sla.queueWait },
            { id: 'reply', label: 'Primeira resposta', tally: report.sla.firstResponse },
          ]}
          rowKey={(row) => row.id}
          empty={null}
        />
      </Card>
      <Card title="Presença dos agentes no período">
        <DataTable
          caption="Presença dos agentes"
          columns={presenceColumns}
          rows={[
            { id: 'available', label: 'Disponível', seconds: report.presenceSeconds.available },
            { id: 'busy', label: 'Ocupado', seconds: report.presenceSeconds.busy },
            { id: 'away', label: 'Ausente', seconds: report.presenceSeconds.away },
            { id: 'offline', label: 'Offline', seconds: report.presenceSeconds.offline },
          ]}
          rowKey={(row) => row.id}
          empty={null}
        />
      </Card>
    </>
  );
}

function DurationCard({ title, summary }: { title: string; summary: QualityReport['queueWait'] }) {
  return (
    <article className="ui-stat ui-stat--info" title={`${summary.samples} amostra(s)`}>
      <div>
        <p className="ui-stat__label">{title}</p>
        <strong className="ui-stat__value">{formatSeconds(summary.p50Seconds)}</strong>
        <p className="page__meta">
          mediana (p50) · p90 {formatSeconds(summary.p90Seconds)} · média {formatSeconds(summary.averageSeconds)}
        </p>
        <p className="page__meta">{summary.samples} amostra(s)</p>
      </div>
    </article>
  );
}

type SlaRow = { id: string; label: string; tally: QualityReport['sla']['queueWait'] };
const slaColumns: Column<SlaRow>[] = [
  { key: 'metric', header: 'Indicador', render: (row) => row.label },
  { key: 'within', header: 'Cumprido', align: 'end', render: (row) => row.tally.within },
  { key: 'breached', header: 'Violado', align: 'end', render: (row) => row.tally.breached },
  { key: 'na', header: 'Não aplicável', align: 'end', render: (row) => row.tally.notApplicable },
  { key: 'rate', header: '% cumprido', align: 'end', render: (row) => formatPercent(slaCompliance(row.tally)) },
];

type PresenceRow = { id: string; label: string; seconds: number };
const presenceColumns: Column<PresenceRow>[] = [
  { key: 'status', header: 'Situação', render: (row) => row.label },
  { key: 'time', header: 'Tempo total', align: 'end', render: (row) => formatSeconds(row.seconds) },
];
