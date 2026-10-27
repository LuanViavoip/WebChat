import { authMeSchema, loginResponseSchema, type AuthMe } from '@viavoip/protocol';
import { useEffect, useState, type FormEvent } from 'react';
import { Shell } from './shell/Shell.js';

const tokenKey = 'viavoip.agentToken';

export function ConsoleApp() {
  const [token, setToken] = useState(() => sessionStorage.getItem(tokenKey) ?? '');
  const [profile, setProfile] = useState<AuthMe | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token || profile) return;
    let active = true;
    void fetch('/auth/me', {
      credentials: 'omit',
      headers: { authorization: `Bearer ${token}` },
    }).then(async (response) => {
      if (!active) return;
      if (!response.ok) {
        sessionStorage.removeItem(tokenKey);
        setToken('');
        return;
      }
      const parsed = authMeSchema.safeParse(await response.json());
      if (parsed.success) setProfile(parsed.data);
    });
    return () => {
      active = false;
    };
  }, [profile, token]);

  if (!token) {
    return (
      <Login
        error={error}
        onSuccess={(nextToken, nextProfile) => {
          sessionStorage.setItem(tokenKey, nextToken);
          setToken(nextToken);
          setProfile(nextProfile);
          setError('');
        }}
        onError={setError}
      />
    );
  }

  if (!profile) return <main className="login"><p>Carregando sessão…</p></main>;

  return (
    <Shell
      token={token}
      profile={profile}
      onLogout={() => {
        void fetch('/auth/logout', {
          method: 'POST',
          credentials: 'omit',
          headers: { authorization: `Bearer ${token}` },
        });
        sessionStorage.removeItem(tokenKey);
        setToken('');
        setProfile(null);
      }}
    />
  );
}

function Login({
  error,
  onSuccess,
  onError,
}: {
  error: string;
  onSuccess: (token: string, profile: AuthMe) => void;
  onError: (message: string) => void;
}) {
  const [email, setEmail] = useState('ana@tenant-a.local');
  const [password, setPassword] = useState('demo-pass-123');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const response = await fetch('/auth/login', {
      method: 'POST',
      credentials: 'omit',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const payload = (await response.json()) as unknown;
    const parsed = loginResponseSchema.safeParse(payload);
    if (!response.ok || !parsed.success) {
      onError('Credenciais inválidas');
      return;
    }
    const me = await fetch('/auth/me', {
      credentials: 'omit',
      headers: { authorization: `Bearer ${parsed.data.token}` },
    });
    const profile = authMeSchema.safeParse(await me.json());
    if (!profile.success) {
      onError('Não foi possível carregar o perfil');
      return;
    }
    onSuccess(parsed.data.token, profile.data);
  }

  return (
    <main className="login">
      <form onSubmit={(event) => void submit(event)}>
        <p className="eyebrow">ViaVoip</p>
        <h1>Central de atendimento</h1>
        <label>
          E-mail
          <input data-testid="login-email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label>
          Senha
          <input
            data-testid="login-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <button data-testid="login-submit" type="submit">Entrar</button>
        <p className="muted">
          Contas locais do tenant A: ana, bruno, diana, eduardo, sofia, helena e otavio. Tenant B: carla, tiago e renata. Senha demo-pass-123.
        </p>
      </form>
    </main>
  );
}
