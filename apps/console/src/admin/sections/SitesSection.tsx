import type { SiteConfiguration } from '@viavoip/protocol';
import { Clock, Code2, Copy, Globe, PauseCircle, Palette, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '../../ui/Button.js';
import { Card } from '../../ui/Card.js';
import { Field, Input, Select, Textarea } from '../../ui/Field.js';
import { EmptyState } from '../../ui/states.js';
import { StatusBadge } from '../../ui/StatusBadge.js';
import { useToast } from '../../ui/Toast.js';
import { useAdminCommand, type AdminContext } from '../AdminContext.js';
import { describeCalendar, minutesToTime, sortWindows, timeToMinutes, weekdayLabels } from '../calendar.js';
import { parseOrigins } from '../origins.js';
import { FormModal, InstantAction, useFormId, useModalForm } from '../parts.js';
import { widgetScript } from '../widget-script.js';
import { Modal } from '../../ui/Dialog.js';

type Dialog =
  | { kind: 'create' }
  | { kind: 'appearance'; site: SiteConfiguration }
  | { kind: 'origins'; site: SiteConfiguration }
  | { kind: 'hours'; site: SiteConfiguration }
  | { kind: 'pause'; site: SiteConfiguration }
  | { kind: 'script'; site: SiteConfiguration };

export function SitesSection({ ctx }: { ctx: AdminContext }) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const close = () => setDialog(null);
  const site = dialog && dialog.kind !== 'create' ? dialog.site : null;
  return (
    <div className="page">
      <Card
        title="Sites e widgets"
        actions={<Button size="sm" icon={<Plus size={14} />} onClick={() => setDialog({ kind: 'create' })}>Novo site</Button>}
      >
        <p className="page__meta">Cada site tem um identificador público, as origens autorizadas a abrir o widget, a aparência e os horários de atendimento.</p>
        {ctx.desk.sites.length === 0 ? (
          <EmptyState icon={Globe} title="Nenhum site" description="Crie um site para gerar o script do widget." />
        ) : (
          <div className="card-grid">
            {ctx.desk.sites.map((item) => (
              <SiteCard key={item.siteId} ctx={ctx} site={item} onOpen={(kind) => setDialog({ kind, site: item })} />
            ))}
          </div>
        )}
      </Card>
      <CreateModal ctx={ctx} open={dialog?.kind === 'create'} onClose={close} />
      <AppearanceModal ctx={ctx} site={dialog?.kind === 'appearance' ? dialog.site : null} onClose={close} />
      <OriginsModal ctx={ctx} site={dialog?.kind === 'origins' ? dialog.site : null} onClose={close} />
      <HoursModal ctx={ctx} site={dialog?.kind === 'hours' ? dialog.site : null} onClose={close} />
      <PauseModal ctx={ctx} site={dialog?.kind === 'pause' ? dialog.site : null} onClose={close} />
      <Modal open={dialog?.kind === 'script'} onClose={close} title="Script de instalação" size="lg">
        {site ? (
          <div className="form-stack">
            <p>Cole este trecho antes de fechar a tag &lt;/body&gt; do site.</p>
            <pre className="code-block">{widgetScript(window.location.origin, site.publicId)}</pre>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function SiteCard({ ctx, site, onOpen }: { ctx: AdminContext; site: SiteConfiguration; onOpen: (kind: 'appearance' | 'origins' | 'hours' | 'pause' | 'script') => void }) {
  const toast = useToast();
  const paused = site.acceptance.kind === 'paused';
  async function copy() {
    const script = widgetScript(window.location.origin, site.publicId);
    try {
      await navigator.clipboard.writeText(script);
      toast.notify('ok', 'Script copiado');
    } catch {
      onOpen('script');
    }
  }
  return (
    <article className="item-card">
      <header className="item-card__head">
        <div>
          <h3>{site.name}</h3>
          <span className="mono cell-muted">{site.publicId}</span>
        </div>
        {site.acceptance.kind === 'paused' ? (
          <span title={site.acceptance.reason}><StatusBadge tone="warning" dot>Pausado</StatusBadge></span>
        ) : (
          <StatusBadge tone="success" dot>Aceitando</StatusBadge>
        )}
      </header>
      <dl>
        <div>
          <dt>Origens autorizadas</dt>
          <dd>
            {site.allowedOrigins.length === 0 ? (
              <span className="cell-muted">Nenhuma — o widget não abre até autorizar um site.</span>
            ) : (
              <span className="chip-list">{site.allowedOrigins.map((origin) => <StatusBadge key={origin}>{origin}</StatusBadge>)}</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Aparência</dt>
          <dd>
            <span className="chip-list">
              <span className="ui-badge ui-badge--neutral"><span style={{ width: 12, height: 12, borderRadius: '50%', background: site.appearance.primaryColor, display: 'inline-block' }} aria-hidden="true" />{site.appearance.primaryColor}</span>
              <StatusBadge>{site.appearance.identity.kind === 'name_required' ? 'Nome obrigatório' : 'Anônimo permitido'}</StatusBadge>
            </span>
          </dd>
        </div>
        <div>
          <dt>Horários</dt>
          <dd>{describeCalendar(site.calendar)}</dd>
        </div>
      </dl>
      <div className="row-actions" style={{ justifyContent: 'flex-start' }}>
        <Button size="sm" icon={<Copy size={14} />} onClick={() => void copy()}>Copiar script</Button>
        <Button size="sm" variant="secondary" icon={<Code2 size={14} />} onClick={() => onOpen('script')}>Ver script</Button>
        <Button size="sm" variant="secondary" icon={<Palette size={14} />} onClick={() => onOpen('appearance')}>Aparência</Button>
        <Button size="sm" variant="secondary" icon={<Globe size={14} />} onClick={() => onOpen('origins')}>Origens</Button>
        <Button size="sm" variant="secondary" icon={<Clock size={14} />} onClick={() => onOpen('hours')}>Horários</Button>
        {paused ? (
          <InstantAction ctx={ctx} label="Retomar" command={{ kind: 'site.acceptance_set', siteId: site.siteId, acceptance: { kind: 'accepting' } }} success={`${site.name} aceitando atendimentos`} />
        ) : (
          <Button size="sm" variant="ghost" icon={<PauseCircle size={14} />} onClick={() => onOpen('pause')}>Pausar</Button>
        )}
      </div>
    </article>
  );
}

function CreateModal({ ctx, open, onClose }: { ctx: AdminContext; open: boolean; onClose: () => void }) {
  const formId = useFormId();
  return (
    <FormModal open={open} title="Novo site" formId={formId} submitLabel="Criar site" onClose={onClose}>
      <CreateForm ctx={ctx} formId={formId} onDone={onClose} />
    </FormModal>
  );
}

function CreateForm({ ctx, formId, onDone }: { ctx: AdminContext; formId: string; onDone: () => void }) {
  const [name, setName] = useState('');
  const [publicId, setPublicId] = useState('');
  const action = useAdminCommand(ctx);
  useModalForm(action);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const ok = await action.submit({ kind: 'site.create', publicId, name }, `Site ${name.trim()} criado`);
    if (ok) onDone();
  }
  return (
    <form id={formId} className="form-stack" onSubmit={(event) => void submit(event)}>
      <Field label="Nome do site">
        <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoFocus />
      </Field>
      <Field label="Identificador público" hint="Minúsculas, números, hífen e sublinhado. Vai no script e não muda depois.">
        <Input value={publicId} onChange={(event) => setPublicId(event.target.value.toLowerCase())} maxLength={80} />
      </Field>
      <p className="page__meta">O site nasce pausado, sem origens. Autorize as origens e retome o atendimento em seguida.</p>
      {action.error ? <p className="form-error" role="alert">{action.error}</p> : null}
    </form>
  );
}

function AppearanceModal({ ctx, site, onClose }: { ctx: AdminContext; site: SiteConfiguration | null; onClose: () => void }) {
  const formId = useFormId();
  return (
    <FormModal open={site !== null} title="Aparência do widget" formId={formId} submitLabel="Salvar" wide onClose={onClose}>
      {site ? <AppearanceForm ctx={ctx} formId={formId} site={site} onDone={onClose} /> : null}
    </FormModal>
  );
}

function AppearanceForm({ ctx, formId, site, onDone }: { ctx: AdminContext; formId: string; site: SiteConfiguration; onDone: () => void }) {
  const { appearance } = site;
  const [name, setName] = useState(site.name);
  const [color, setColor] = useState(appearance.primaryColor);
  const [welcome, setWelcome] = useState(appearance.welcomeMessage);
  const [identity, setIdentity] = useState(appearance.identity.kind);
  const [logoUrl, setLogoUrl] = useState(appearance.logo.kind === 'https' ? appearance.logo.url : '');
  const action = useAdminCommand(ctx);
  useModalForm(action);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const ok = await action.submit(
      {
        kind: 'site.appearance_replace',
        siteId: site.siteId,
        name,
        appearance: {
          primaryColor: color,
          logo: logoUrl.trim() ? { kind: 'https', url: logoUrl.trim() } : { kind: 'none' },
          welcomeMessage: welcome,
          identity: { kind: identity },
        },
      },
      `Aparência de ${name.trim()} atualizada`,
    );
    if (ok) onDone();
  }
  return (
    <form id={formId} className="form-stack" onSubmit={(event) => void submit(event)}>
      <div className="form-grid">
        <Field label="Nome exibido no widget">
          <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
        </Field>
        <Field label="Cor principal" hint="Hexadecimal, ex.: #3740b0.">
          <span style={{ display: 'flex', gap: 8 }}>
            <input type="color" aria-label="Escolher cor" value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : '#3740b0'} onChange={(event) => setColor(event.target.value)} style={{ width: 44, height: 44, padding: 2, border: '1px solid var(--color-border)', borderRadius: 6, background: 'var(--color-surface)' }} />
            <Input aria-label="Cor principal em hexadecimal" value={color} onChange={(event) => setColor(event.target.value)} maxLength={7} />
          </span>
        </Field>
      </div>
      <Field label="Mensagem de boas-vindas">
        <Textarea rows={3} value={welcome} onChange={(event) => setWelcome(event.target.value)} maxLength={300} />
      </Field>
      <div className="form-grid">
        <Field label="Identificação do visitante">
          <Select value={identity} onChange={(event) => setIdentity(event.target.value === 'name_required' ? 'name_required' : 'anonymous_allowed')}>
            <option value="anonymous_allowed">Anônimo permitido</option>
            <option value="name_required">Nome obrigatório</option>
          </Select>
        </Field>
        <Field label="Logo (URL https, opcional)">
          <Input value={logoUrl} onChange={(event) => setLogoUrl(event.target.value)} placeholder="https://…" maxLength={500} />
        </Field>
      </div>
      {action.error ? <p className="form-error" role="alert">{action.error}</p> : null}
    </form>
  );
}

function OriginsModal({ ctx, site, onClose }: { ctx: AdminContext; site: SiteConfiguration | null; onClose: () => void }) {
  const formId = useFormId();
  return (
    <FormModal open={site !== null} title="Origens autorizadas" formId={formId} submitLabel="Salvar origens" onClose={onClose}>
      {site ? <OriginsForm ctx={ctx} formId={formId} site={site} onDone={onClose} /> : null}
    </FormModal>
  );
}

function OriginsForm({ ctx, formId, site, onDone }: { ctx: AdminContext; formId: string; site: SiteConfiguration; onDone: () => void }) {
  const [text, setText] = useState(site.allowedOrigins.join('\n'));
  const [localError, setLocalError] = useState('');
  const action = useAdminCommand(ctx);
  useModalForm(action);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseOrigins(text);
    if (!parsed.ok) {
      setLocalError(parsed.message);
      return;
    }
    setLocalError('');
    const ok = await action.submit({ kind: 'site.origins_replace', siteId: site.siteId, allowedOrigins: parsed.origins }, `Origens de ${site.name} atualizadas`);
    if (ok) onDone();
  }
  return (
    <form id={formId} className="form-stack" onSubmit={(event) => void submit(event)}>
      <Field label="Uma origem por linha" hint="Só o endereço do site, sem caminho. Ex.: https://www.empresa.com.br">
        <Textarea rows={6} value={text} onChange={(event) => setText(event.target.value)} autoFocus />
      </Field>
      {localError || action.error ? <p className="form-error" role="alert">{localError || action.error}</p> : null}
    </form>
  );
}

type WindowDraft = { weekday: number; start: string; end: string };

function HoursModal({ ctx, site, onClose }: { ctx: AdminContext; site: SiteConfiguration | null; onClose: () => void }) {
  const formId = useFormId();
  return (
    <FormModal open={site !== null} title="Horários de atendimento" formId={formId} submitLabel="Salvar horários" wide onClose={onClose}>
      {site ? <HoursForm ctx={ctx} formId={formId} site={site} onDone={onClose} /> : null}
    </FormModal>
  );
}

function HoursForm({ ctx, formId, site, onDone }: { ctx: AdminContext; formId: string; site: SiteConfiguration; onDone: () => void }) {
  const [weekly, setWeekly] = useState(site.calendar.kind === 'weekly');
  const [windows, setWindows] = useState<WindowDraft[]>(
    site.calendar.kind === 'weekly'
      ? sortWindows(site.calendar.windows).map((window) => ({ weekday: window.weekday, start: minutesToTime(window.startMinute), end: minutesToTime(window.endMinute === 1440 ? 0 : window.endMinute) }))
      : [{ weekday: 1, start: '08:00', end: '18:00' }],
  );
  const [localError, setLocalError] = useState('');
  const action = useAdminCommand(ctx);
  useModalForm(action);

  function update(index: number, patch: Partial<WindowDraft>) {
    setWindows((current) => current.map((window, position) => (position === index ? { ...window, ...patch } : window)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    let calendar: { kind: 'always_open' } | { kind: 'weekly'; windows: { weekday: number; startMinute: number; endMinute: number }[] } = { kind: 'always_open' };
    if (weekly) {
      const converted = windows.map((window) => ({
        weekday: window.weekday,
        startMinute: timeToMinutes(window.start, 'inicio'),
        endMinute: timeToMinutes(window.end, 'fim'),
      }));
      if (converted.some((window) => window.startMinute === null || window.endMinute === null)) {
        setLocalError('Preencha o início e o fim de todas as janelas.');
        return;
      }
      calendar = {
        kind: 'weekly',
        windows: converted.flatMap((window) =>
          window.startMinute === null || window.endMinute === null ? [] : [{ weekday: window.weekday, startMinute: window.startMinute, endMinute: window.endMinute }],
        ),
      };
    }
    setLocalError('');
    const ok = await action.submit({ kind: 'site.service_windows_replace', siteId: site.siteId, calendar }, `Horários de ${site.name} atualizados`);
    if (ok) onDone();
  }

  return (
    <form id={formId} className="form-stack" onSubmit={(event) => void submit(event)}>
      <Field label="Funcionamento">
        <Select value={weekly ? 'weekly' : 'always_open'} onChange={(event) => setWeekly(event.target.value === 'weekly')}>
          <option value="always_open">Sempre aberto</option>
          <option value="weekly">Janelas semanais</option>
        </Select>
      </Field>
      {weekly ? (
        <div className="form-stack">
          {windows.map((window, index) => (
            <div className="form-grid" key={index} style={{ gridTemplateColumns: 'minmax(120px, 1.2fr) 1fr 1fr auto', alignItems: 'end' }}>
              <Field label="Dia">
                <Select value={window.weekday} onChange={(event) => update(index, { weekday: Number(event.target.value) })}>
                  {Object.entries(weekdayLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </Select>
              </Field>
              <Field label="Início"><Input type="time" value={window.start} onChange={(event) => update(index, { start: event.target.value })} /></Field>
              <Field label="Fim"><Input type="time" value={window.end} onChange={(event) => update(index, { end: event.target.value })} /></Field>
              <Button variant="ghost" size="sm" onClick={() => setWindows((current) => current.filter((_, position) => position !== index))} disabled={windows.length === 1}>Remover</Button>
            </div>
          ))}
          <div>
            <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={() => setWindows((current) => [...current, { weekday: 1, start: '08:00', end: '18:00' }])} disabled={windows.length >= 21}>Adicionar janela</Button>
          </div>
          <p className="page__meta">Para terminar à meia-noite, use 00:00 no fim. Janelas do mesmo dia não podem se sobrepor.</p>
        </div>
      ) : null}
      {localError || action.error ? <p className="form-error" role="alert">{localError || action.error}</p> : null}
    </form>
  );
}

function PauseModal({ ctx, site, onClose }: { ctx: AdminContext; site: SiteConfiguration | null; onClose: () => void }) {
  const formId = useFormId();
  return (
    <FormModal open={site !== null} title="Pausar atendimento do site" formId={formId} submitLabel="Pausar" danger onClose={onClose}>
      {site ? <PauseForm ctx={ctx} formId={formId} site={site} onDone={onClose} /> : null}
    </FormModal>
  );
}

function PauseForm({ ctx, formId, site, onDone }: { ctx: AdminContext; formId: string; site: SiteConfiguration; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const action = useAdminCommand(ctx);
  useModalForm(action);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const ok = await action.submit({ kind: 'site.acceptance_set', siteId: site.siteId, acceptance: { kind: 'paused', reason } }, `${site.name} pausado`);
    if (ok) onDone();
  }
  return (
    <form id={formId} className="form-stack" onSubmit={(event) => void submit(event)}>
      <p>Enquanto estiver pausado, o widget de {site.name} não aceita novos atendimentos.</p>
      <Field label="Motivo da pausa">
        <Textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={200} autoFocus />
      </Field>
      {action.error ? <p className="form-error" role="alert">{action.error}</p> : null}
    </form>
  );
}
