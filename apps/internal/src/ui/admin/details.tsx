import { ArrowLeft } from 'lucide-react';
import { useId, useRef, useState, type SyntheticEvent, type ReactNode } from 'react';
import type { Capability } from '@viavoip/internal-domain';
import {
  canManageIlhasIn,
  canAddAgentToIlhaIn,
  canRemoveAgentFromIlhaIn,
  canSetActiveIn,
  describeDenial,
} from '@viavoip/internal-domain';
import type { Ilha, StaffUser } from '@viavoip/internal-domain';
import { own } from '@viavoip/internal-domain';
import { conversationInitials, roleLabel } from '../conversations';
import { capabilityLabel } from './capabilityLabels';
import { SelectField, TextField } from './forms';
import { byName, ilhaLabel, nameProblem } from './helpers';
import { GrantLogList } from './GrantLogList';
import { PermissionsPanel } from './PermissionsPanel';
import type { ConsoleContext } from './types';

function HeaderTitle({ level, id, children }: { level: 1 | 2; id: string; children: string }) {
  return level === 1 ? (
    <h1 id={id} className="header-title">
      {children}
    </h1>
  ) : (
    <h2 id={id} className="header-title">
      {children}
    </h2>
  );
}

/** Foco por teclado numa região rolável (WCAG 2.1.1; axe `scrollable-region-focusable`): vale mesmo sem controle habilitado dentro. */
export const SCROLL_FOCUSABLE = { tabIndex: 0 } as const;

/** Região rolável do detalhe: focalizável (teclado rola mesmo sem controle habilitado) e com nome. */
export function DetailScroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="admin-detail-scroll" role="region" aria-label={label} {...SCROLL_FOCUSABLE}>
      {children}
    </div>
  );
}

export function DetailHeader({
  title,
  subtitle,
  titleId,
  onBack,
  level,
}: {
  title: string;
  subtitle?: string;
  titleId: string;
  onBack: () => void;
  /** No mobile o painel de detalhe é a tela inteira, então o título dele é o h1. */
  level: 1 | 2;
}) {
  return (
    <header className="chat-header" tabIndex={-1} data-detail-header>
      <button type="button" className="icon-button header-back admin-detail-back" aria-label="Voltar" onClick={onBack}>
        <ArrowLeft size={20} strokeWidth={1.7} aria-hidden="true" />
      </button>
      <div className="avatar avatar-contact" aria-hidden="true">
        {conversationInitials(title)}
      </div>
      <div className="header-identity">
        <HeaderTitle level={level} id={titleId}>
          {title}
        </HeaderTitle>
        {subtitle ? <p className="header-status">{subtitle}</p> : null}
      </div>
    </header>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="admin-block" aria-labelledby={id}>
      <h3 id={id} className="admin-h3">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function NewDetailHeader({ title, onBack, level }: { title: string; onBack: () => void; level: 1 | 2 }) {
  return <DetailHeader title={title} titleId="admin-detail-title" onBack={onBack} level={level} />;
}

export function UserDetail({
  ctx,
  target,
  onBack,
  level,
}: {
  ctx: ConsoleContext;
  target: StaffUser;
  onBack: () => void;
  level: 1 | 2;
}) {
  const { me, directory } = ctx;
  const isSelf = target.id === me.id;
  const ilhaName = target.role === 'agent' ? ilhaLabel(directory, target.ilhaIds) : undefined;
  const supervised =
    target.role === 'supervisor' ? byName(Object.values(directory.ilhas).filter((ilha) => ilha.supervisorIds.includes(target.id))) : [];
  const [pending, setPending] = useState<ReadonlySet<Capability>>(new Set());

  const activeVerdict = canSetActiveIn(directory, me.id, target.id);
  const activeReasonId = useId();

  const addOptions =
    target.role === 'agent'
      ? byName(
          Object.values(directory.ilhas).filter(
            (ilha) => !target.ilhaIds.includes(ilha.id) && canAddAgentToIlhaIn(directory, me.id, target.id, ilha.id).ok,
          ),
        )
      : [];

  async function toggle(capability: Capability, next: boolean) {
    setPending((current) => new Set([...current, capability]));
    await ctx.perform(
      () => ctx.actions.setGrant(target.id, capability, next),
      () => `${capabilityLabel(capability)} ${next ? 'ligada' : 'desligada'} para ${target.name}.`,
    );
    setPending((current) => new Set([...current].filter((item) => item !== capability)));
  }

  const subtitle = [roleLabel(target.role), ilhaName, target.active ? 'Ativo' : 'Desativado']
    .filter((part) => part !== undefined)
    .join(' · ');

  return (
    <>
      <DetailHeader title={isSelf ? `${target.name} (você)` : target.name} subtitle={subtitle} titleId="admin-detail-title" onBack={onBack} level={level} />
      <DetailScroll label={`Detalhes de ${target.name}`}>
        {isSelf ? (
          <p className="admin-note">Você vê suas próprias permissões, mas não pode alterá-las.</p>
        ) : (
          <Block title="Conta">
            <p className="admin-muted">
              {target.active ? 'A conta está ativa.' : 'A conta está desativada: não entra no chat e o histórico fica guardado.'}
            </p>
            <button
              type="button"
              className="admin-secondary"
              disabled={!activeVerdict.ok || ctx.busy}
              {...(!activeVerdict.ok ? { 'aria-describedby': activeReasonId } : {})}
              onClick={() => {
                void ctx.perform(
                  () => (target.active ? ctx.actions.deactivateUser(target.id) : ctx.actions.reactivateUser(target.id)),
                  (user) => `${user.name} ${user.active ? 'reativado' : 'desativado'}.`,
                );
              }}
            >
              {target.active ? 'Desativar' : 'Reativar'}
            </button>
            {!activeVerdict.ok ? (
              <p id={activeReasonId} className="perm-reason">
                {describeDenial(activeVerdict.error)}
              </p>
            ) : null}
          </Block>
        )}
        {target.role === 'supervisor' ? (
          <Block title="Ilhas">
            {supervised.length > 0 ? (
              <ul className="admin-chips" aria-label={`Ilhas de ${target.name}`}>
                {supervised.map((ilha) => (
                  <li key={ilha.id}>{ilha.name}</li>
                ))}
              </ul>
            ) : (
              <p className="admin-muted">Não supervisiona nenhuma ilha.</p>
            )}
          </Block>
        ) : null}
        {target.role === 'agent' && !isSelf ? <AgentIlhasBlock ctx={ctx} agent={target} options={addOptions} /> : null}
        <Block title="Permissões">
          <PermissionsPanel
            directory={directory}
            actor={me}
            target={target}
            pending={pending}
            busy={ctx.busy}
            onToggle={(capability, next) => {
              void toggle(capability, next);
            }}
          />
        </Block>
        <Block title="Registro desta pessoa">
          <GrantLogList
            entries={ctx.grantLog}
            directory={directory}
            timeZone={ctx.timeZone}
            onlyTarget={target.id}
            label={`Registro de permissões de ${target.name}`}
          />
        </Block>
      </DetailScroll>
    </>
  );
}

function AgentIlhasBlock({ ctx, agent, options }: { ctx: ConsoleContext; agent: StaffUser; options: readonly Ilha[] }) {
  const [picked, setPicked] = useState('');
  const { directory, me } = ctx;
  const ilhaId = options.some((ilha) => ilha.id === picked) ? picked : (options[0]?.id ?? '');
  const linked = agent.role === 'agent' ? byName(agent.ilhaIds.flatMap((id) => own(directory.ilhas, id) ?? [])) : [];
  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    const destination = options.find((ilha) => ilha.id === ilhaId);
    if (!destination) {
      return;
    }
    await ctx.perform(
      () => ctx.actions.addAgentToIlha(agent.id, destination.id),
      () => `${agent.name} agora também está na ilha ${destination.name}.`,
    );
  }
  return (
    <Block title="Ilhas do agente">
      <ul className="admin-chips" aria-label={`Ilhas de ${agent.name}`}>
        {linked.map((ilha) => {
          const verdict = canRemoveAgentFromIlhaIn(directory, me.id, agent.id, ilha.id);
          return (
            <li key={ilha.id}>
              {ilha.name}{' '}
              <button
                type="button"
                className="admin-secondary"
                disabled={!verdict.ok || ctx.busy}
                title={!verdict.ok ? describeDenial(verdict.error) : undefined}
                onClick={() => {
                  void ctx.perform(
                    () => ctx.actions.removeAgentFromIlha(agent.id, ilha.id),
                    () => `${agent.name} saiu da ilha ${ilha.name}.`,
                  );
                }}
              >
                Remover da ilha {ilha.name}
              </button>
            </li>
          );
        })}
      </ul>
      {options.length === 0 ? (
        <p className="admin-muted">Não há outra ilha disponível para adicionar a este agente.</p>
      ) : (
        <form
          className="admin-inline-form"
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <SelectField
            label="Adicionar à ilha"
            value={ilhaId}
            onChange={setPicked}
            options={options.map((ilha) => ({ value: ilha.id, label: ilha.name }))}
          />
          <button type="submit" className="admin-secondary" disabled={ctx.busy}>
            Adicionar
          </button>
        </form>
      )}
    </Block>
  );
}

export function IlhaDetail({ ctx, ilha, onBack, level }: { ctx: ConsoleContext; ilha: Ilha; onBack: () => void; level: 1 | 2 }) {
  const { directory, me } = ctx;
  const allowed = canManageIlhasIn(directory, me.id);
  // Candidatos: supervisores ativos que ainda não supervisionam esta ilha (N:N: atribuir ACRESCENTA).
  const supervisors = byName(
    Object.values(directory.users).filter((user) => user.role === 'supervisor' && user.active && !ilha.supervisorIds.includes(user.id)),
  );
  const agents = byName(Object.values(directory.users).filter((user) => user.role === 'agent' && user.ilhaIds.includes(ilha.id)));
  const current = byName(ilha.supervisorIds.flatMap((id) => own(directory.users, id) ?? []));
  // `null` = o campo ainda não foi editado: mostra o que o servidor tem (acompanha renomeação de outra aba).
  // Editado, mantém o texto de quem digita.
  const [draft, setDraft] = useState<string | null>(null);
  const [pickedSupervisor, setPickedSupervisor] = useState<string | null>(null);
  const name = draft ?? ilha.name;
  const setName = (value: string) => {
    setDraft(value);
  };
  const picked = pickedSupervisor ?? '';
  const setPicked = (value: string) => {
    setPickedSupervisor(value);
  };
  const nameRef = useRef<HTMLInputElement>(null);
  const supervisorId = supervisors.some((user) => user.id === picked) ? picked : (supervisors[0]?.id ?? '');
  const reasonId = useId();

  async function rename(event: SyntheticEvent) {
    event.preventDefault();
    const problem = nameProblem(name);
    if (problem) {
      ctx.fail(problem);
      nameRef.current?.focus();
      return;
    }
    const result = await ctx.perform(
      () => ctx.actions.renameIlha(ilha.id, name),
      (renamed) => `Ilha renomeada para ${renamed.name}.`,
    );
    if (result.ok) {
      setDraft(null);
    }
  }

  async function assign(event: SyntheticEvent) {
    event.preventDefault();
    const chosen = supervisors.find((user) => user.id === supervisorId);
    if (!chosen) {
      return;
    }
    const result = await ctx.perform(
      () => ctx.actions.assignIlhaSupervisor(ilha.id, chosen.id),
      () => `${chosen.name} agora supervisiona a ilha ${ilha.name}.`,
    );
    if (result.ok) {
      setPickedSupervisor(null);
    }
  }

  return (
    <>
      <DetailHeader
        title={ilha.name}
        subtitle={`${current.length > 1 ? 'Supervisores' : 'Supervisor'}: ${current.map((user) => user.name).join(', ') || 'sem supervisor'}`}
        titleId="admin-detail-title"
        onBack={onBack}
        level={level}
      />
      <DetailScroll label={`Detalhes da ilha ${ilha.name}`}>
        {!allowed.ok ? (
          <p id={reasonId} className="perm-reason">
            {describeDenial(allowed.error)}
          </p>
        ) : null}
        <Block title="Renomear">
          <form
            className="admin-inline-form"
            onSubmit={(event) => {
              void rename(event);
            }}
            noValidate
          >
            <TextField label="Nome da ilha" value={name} onChange={setName} inputRef={nameRef} />
            <button type="submit" className="admin-secondary" disabled={!allowed.ok || ctx.busy}>
              Renomear
            </button>
          </form>
        </Block>
        <Block title="Supervisor">
          {current.length > 0 ? (
            <ul className="admin-chips" aria-label={`Supervisores da ilha ${ilha.name}`}>
              {current.map((user) => (
                <li key={user.id}>
                  {user.name}{' '}
                  <button
                    type="button"
                    className="admin-secondary"
                    disabled={!allowed.ok || ctx.busy || current.length === 1}
                    title={current.length === 1 ? describeDenial('last-supervisor') : undefined}
                    onClick={() => {
                      void ctx.perform(
                        () => ctx.actions.unassignIlhaSupervisor(ilha.id, user.id),
                        () => `${user.name} deixou de supervisionar a ilha ${ilha.name}.`,
                      );
                    }}
                  >
                    Remover {user.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {supervisors.length === 0 ? (
            <p className="admin-muted">Nenhum outro supervisor ativo disponível.</p>
          ) : (
            <form
              className="admin-inline-form"
              onSubmit={(event) => {
                void assign(event);
              }}
            >
              <SelectField
                label="Supervisor da ilha"
                value={supervisorId}
                onChange={setPicked}
                options={supervisors.map((user) => ({ value: user.id, label: user.name }))}
              />
              <button type="submit" className="admin-secondary" disabled={!allowed.ok || ctx.busy}>
                Atribuir supervisor
              </button>
            </form>
          )}
        </Block>
        <Block title="Agentes da ilha">
          {agents.length === 0 ? (
            <p className="admin-muted">Nenhum agente nesta ilha.</p>
          ) : (
            <ul className="admin-chips" aria-label={`Agentes da ilha ${ilha.name}`}>
              {agents.map((agent) => (
                <li key={agent.id}>{agent.active ? agent.name : `${agent.name} (desativado)`}</li>
              ))}
            </ul>
          )}
        </Block>
      </DetailScroll>
    </>
  );
}
