import { useId } from 'react';
import { CAPABILITIES, canGrantIn, canRevokeIn, effectiveGrants, type Capability } from '../../domain/capabilities';
import { describeDenial } from '../../domain/directoryOps';
import type { Directory, StaffUser } from '../../domain/identity';
import { CAPABILITY_TEXT } from './capabilityLabels';

/**
 * Uma chave liga/desliga por capacidade do CATÁLOGO. Quem pode mexer vem de `canGrantIn`/`canRevokeIn`
 * sobre o diretório atual (as mesmas funções que o servidor usa); a chave bloqueada fica desabilitada e
 * mostra o motivo em texto, ligado por `aria-describedby`.
 */
export function PermissionsPanel({
  directory,
  actor,
  target,
  pending,
  busy,
  onToggle,
}: {
  directory: Directory;
  actor: StaffUser;
  target: StaffUser;
  pending: ReadonlySet<Capability>;
  busy: boolean;
  onToggle: (capability: Capability, next: boolean) => void;
}) {
  const base = useId();
  const held = effectiveGrants(target);
  return (
    <ul className="perm-list" aria-label={`Permissões de ${target.name}`}>
      {CAPABILITIES.map((capability) => {
        const on = held.has(capability);
        const verdict = on
          ? canRevokeIn(directory, actor.id, target.id, capability)
          : canGrantIn(directory, actor.id, target.id, capability);
        const reason = verdict.ok ? undefined : describeDenial(verdict.error);
        const text = CAPABILITY_TEXT[capability];
        const labelId = `${base}-${capability}-label`;
        const hintId = `${base}-${capability}-hint`;
        const reasonId = `${base}-${capability}-reason`;
        return (
          <li key={capability} className="perm-row" data-capability-row={capability}>
            <div className="perm-copy">
              <span id={labelId} className="perm-label">
                {text.label}
              </span>
              <span id={hintId} className="perm-hint">
                {text.hint}
              </span>
              {reason ? (
                <span id={reasonId} className="perm-reason">
                  {reason}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              role="switch"
              className="perm-switch"
              aria-checked={on}
              aria-labelledby={labelId}
              aria-describedby={reason ? `${hintId} ${reasonId}` : hintId}
              data-capability={capability}
              data-testid={`perm-${capability}`}
              disabled={reason !== undefined || pending.has(capability) || busy}
              onClick={() => {
                onToggle(capability, !on);
              }}
            >
              <span className="perm-knob" aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
