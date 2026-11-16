import type { GrantLogEntry } from '@viavoip/internal-domain';
import type { Directory, UserId } from '@viavoip/internal-domain';
import { own } from '@viavoip/internal-domain';
import { capabilityLabel } from './capabilityLabels';

function formatWhen(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  try {
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
  }
}

/** O grantLog legível por quem olha: quem, para quem, o quê, concedeu ou revogou e quando (nomes, nunca ids). */
export function GrantLogList({
  entries,
  directory,
  timeZone,
  onlyTarget,
  label,
}: {
  entries: readonly GrantLogEntry[] | null;
  directory: Directory;
  timeZone: string;
  onlyTarget?: UserId;
  label: string;
}) {
  if (entries === null) {
    return <p className="admin-muted">Carregando o registro…</p>;
  }
  const shown = (onlyTarget ? entries.filter((entry) => entry.targetId === onlyTarget) : entries).slice().reverse();
  if (shown.length === 0) {
    return <p className="admin-muted">Nenhuma permissão concedida ou revogada ainda.</p>;
  }
  const nameOf = (id: UserId): string => own(directory.users, id)?.name ?? 'Usuário removido';
  return (
    <ol className="log-list" aria-label={label}>
      {shown.map((entry, index) => (
        <li key={`${entry.at}-${entry.actorId}-${entry.targetId}-${entry.capability}-${String(index)}`} className="log-item">
          <span className="log-sentence">
            {`${nameOf(entry.actorId)} ${entry.granted ? 'concedeu' : 'revogou'} ${capabilityLabel(entry.capability)} ${entry.granted ? 'a' : 'de'} ${nameOf(entry.targetId)}`}
          </span>
          <time className="log-time" dateTime={entry.at}>
            {formatWhen(entry.at, timeZone)}
          </time>
        </li>
      ))}
    </ol>
  );
}
