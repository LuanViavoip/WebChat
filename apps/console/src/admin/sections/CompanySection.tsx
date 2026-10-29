import { useState, type FormEvent } from 'react';
import { Button } from '../../ui/Button.js';
import { Card } from '../../ui/Card.js';
import { Field, Input } from '../../ui/Field.js';
import { useAdminCommand, type AdminContext } from '../AdminContext.js';

export function CompanySection({ ctx }: { ctx: AdminContext }) {
  const { company } = ctx.desk;
  return (
    <div className="page">
      <Card title="Identidade da empresa">
        <RenameForm ctx={ctx} current={company.name} slug={company.slug} />
      </Card>
      <Card title="Fuso horário">
        <TimeZoneForm ctx={ctx} current={company.timeZone} />
      </Card>
      <Card title="Concorrência">
        <ConcurrencyForm ctx={ctx} current={company.concurrencyLimit} />
      </Card>
    </div>
  );
}

function RenameForm({ ctx, current, slug }: { ctx: AdminContext; current: string; slug: string }) {
  const [name, setName] = useState(current);
  const action = useAdminCommand(ctx);
  const changed = name.trim() !== current;
  function submit(event: FormEvent) {
    event.preventDefault();
    void action.submit({ kind: 'company.rename', name }, 'Empresa renomeada');
  }
  return (
    <form className="form-stack" onSubmit={submit}>
      <div className="form-grid">
        <Field label="Nome da empresa">
          <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
        </Field>
        <Field label="Identificador" hint="Definido na criação; não pode ser alterado.">
          <Input value={slug} readOnly />
        </Field>
      </div>
      {action.error ? <p className="form-error" role="alert">{action.error}</p> : null}
      <div className="form-actions">
        <Button type="submit" disabled={!changed || action.pending}>{action.pending ? 'Salvando…' : 'Salvar nome'}</Button>
      </div>
    </form>
  );
}

function supportedTimeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try {
    return intl.supportedValuesOf?.('timeZone') ?? [];
  } catch {
    return [];
  }
}

function TimeZoneForm({ ctx, current }: { ctx: AdminContext; current: string }) {
  const [timeZone, setTimeZone] = useState(current);
  const action = useAdminCommand(ctx);
  const changed = timeZone.trim() !== current;
  function submit(event: FormEvent) {
    event.preventDefault();
    void action.submit({ kind: 'company.time_zone', timeZone }, 'Fuso horário atualizado');
  }
  return (
    <form className="form-stack" onSubmit={submit}>
      <Field label="Fuso horário (IANA)" hint="Ex.: America/Sao_Paulo. Define a leitura dos horários de atendimento.">
        <Input value={timeZone} onChange={(event) => setTimeZone(event.target.value)} list="company-time-zones" />
      </Field>
      <datalist id="company-time-zones">
        {supportedTimeZones().map((zone) => <option key={zone} value={zone} />)}
      </datalist>
      {action.error ? <p className="form-error" role="alert">{action.error}</p> : null}
      <div className="form-actions">
        <Button type="submit" disabled={!changed || action.pending}>{action.pending ? 'Salvando…' : 'Salvar fuso'}</Button>
      </div>
    </form>
  );
}

function ConcurrencyForm({ ctx, current }: { ctx: AdminContext; current: number }) {
  const [max, setMax] = useState(String(current));
  const action = useAdminCommand(ctx);
  const value = Number(max);
  const changed = max !== '' && value !== current;
  function submit(event: FormEvent) {
    event.preventDefault();
    void action.submit({ kind: 'company.concurrency_limit', max: value }, 'Limite de concorrência atualizado');
  }
  return (
    <form className="form-stack" onSubmit={submit}>
      <Field label="Atendimentos simultâneos por agente" hint="De 1 a 100. Ao atingir o limite, o agente fica ocupado automaticamente.">
        <Input type="number" min={1} max={100} value={max} onChange={(event) => setMax(event.target.value)} />
      </Field>
      {action.error ? <p className="form-error" role="alert">{action.error}</p> : null}
      <div className="form-actions">
        <Button type="submit" disabled={!changed || action.pending}>{action.pending ? 'Salvando…' : 'Salvar limite'}</Button>
      </div>
    </form>
  );
}
