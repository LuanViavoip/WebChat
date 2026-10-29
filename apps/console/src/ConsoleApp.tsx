import { authMeSchema, type AuthMe } from '@viavoip/protocol';
import { useEffect, useState } from 'react';
import { Login } from './auth/Login.js';
import { Shell } from './shell/Shell.js';
import { LoadingState } from './ui/states.js';
import { ToastProvider } from './ui/Toast.js';

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

  if (!profile) return <main className="login"><LoadingState label="Carregando sessão…" /></main>;

  return (
    <ToastProvider>
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
    </ToastProvider>
  );
}
