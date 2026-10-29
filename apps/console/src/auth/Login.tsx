import { authMeSchema, loginResponseSchema, type AuthMe } from '@viavoip/protocol';
import { useState, type FormEvent } from 'react';
import { Button } from '../ui/Button.js';
import { Field, Input } from '../ui/Field.js';
import logoUrl from '../ui/assets/logo-viavoip.png';

export function Login({
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
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
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
    } catch {
      onError('Não foi possível conectar ao servidor');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="login">
      <div className="login__stack">
        <img className="login__logo" src={logoUrl} alt="ViaVoip" />
        <form className="login__card" onSubmit={(event) => void submit(event)}>
          <div>
            <h1>Central de atendimento</h1>
            <p>Entre com sua conta para atender e acompanhar a operação.</p>
          </div>
          <Field label="E-mail">
            <Input
              data-testid="login-email"
              value={email}
              autoComplete="username"
              inputMode="email"
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field label="Senha">
            <Input
              data-testid="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          {error ? <p className="login__error" role="alert">{error}</p> : null}
          <Button data-testid="login-submit" type="submit" size="lg" disabled={pending}>
            {pending ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>
        <p className="login__hint">
          Contas locais do tenant A: ana, bruno, diana, eduardo, sofia, helena e otavio. Tenant B: carla, tiago e renata. Senha demo-pass-123.
        </p>
      </div>
    </main>
  );
}
