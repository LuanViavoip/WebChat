import type { StaffUser } from '@viavoip/internal-domain';
import { roleLabel } from './conversations';
import { loginGroups, type LoginGroup } from './sessionIdentity';

function LoginUserButton({ user, onPick }: { user: StaffUser; onPick: () => void }) {
  return (
    <button type="button" className="login-user" onClick={onPick}>
      <span className="login-user-name">{user.name}</span>
      <span className="login-user-role">{roleLabel(user.role)}</span>
    </button>
  );
}

/**
 * Tela cheia "Entrar como": os usuários ativos do servidor agrupados por empresa. Clicar entra como aquele usuário.
 * `notice` é um aviso de por que se voltou aqui (ex.: conta desativada).
 */
export function LoginScreen({
  groups: allGroups,
  onPick,
  notice,
}: {
  groups: readonly LoginGroup[];
  onPick: (userId: string) => void;
  notice?: string | undefined;
}) {
  const groups = loginGroups(allGroups);
  return (
    <section className="login-screen" aria-labelledby="login-title">
      <div className="login-card">
        <div className="login-brand">
          <p className="brand-wordmark">ViaVoip</p>
        </div>
        <h1 id="login-title" className="login-title">
          Entrar como
        </h1>
        {notice ? (
          <p className="login-notice" role="alert">
            {notice}
          </p>
        ) : null}
        <p className="login-hint">Escolha um usuário da empresa para abrir o chat interno.</p>
        <div className="login-groups">
          {groups.map(({ tenant, users }) => (
            <section key={tenant.id} className="login-group" aria-labelledby={`login-group-${tenant.id}`}>
              <h2 id={`login-group-${tenant.id}`} className="login-group-title">
                {tenant.name}
              </h2>
              <ul className="login-users">
                {users.map((user) => (
                  <li key={user.id}>
                    <LoginUserButton
                      user={user}
                      onPick={() => {
                        onPick(user.id);
                      }}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}
