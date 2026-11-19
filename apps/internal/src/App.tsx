import { useEffect, useMemo, useState } from 'react';
import { createShellSlots } from './shell/registry';
import type { ShellSlots } from './shell/slots';
import type { ChatTransport, ConnectRequest } from './transport/ChatTransport';
import { mergeHistoryState } from './ui/chatHistory';
import { ChatPanel } from './ui/ChatPanel';
import { LoginScreen } from './ui/LoginScreen';
import {
  clearStoredIdentity,
  identityForUser,
  initialIdentity,
  storeIdentity,
  stripAsParam,
} from './ui/sessionIdentity';

export function App({ transport, slots }: { transport: ChatTransport; slots?: ShellSlots }) {
  const resolvedSlots = useMemo(() => slots ?? createShellSlots(), [slots]);
  const [identity, setIdentity] = useState<ConnectRequest | undefined>(() =>
    initialIdentity(transport.loginGroups(), window.location.search),
  );
  /** Por que voltamos ao login (ex.: conta desativada). Some ao entrar de novo. */
  const [notice, setNotice] = useState<string | undefined>(undefined);
  // Os usuários vêm do estado do servidor, lidos de novo toda vez que o login reaparece (há cadastro novo).
  const [groups, setGroups] = useState(() => transport.loginGroups());

  function enter(userId: string) {
    const next = identityForUser(groups, userId);
    if (!next) {
      return;
    }
    storeIdentity(next);
    setNotice(undefined);
    setIdentity(next);
  }

  function switchUser(message?: string) {
    setNotice(message);
    setGroups(transport.loginGroups());
    clearStoredIdentity();
    stripAsParam();
    // A seleção e o painel do usuário anterior não valem para o próximo.
    window.history.replaceState(
      mergeHistoryState(window.history.state, { smPane: 'list', conversationId: '' }),
      '',
    );
    setIdentity(undefined);
  }

  // Na tela "Entrar como" a lista vem do servidor: cadastro ou desativação feitos em outra aba aparecem ao voltar
  // para esta (foco, visibilidade) e quando o armazenamento compartilhado muda (evento `storage`).
  const onLogin = identity === undefined;
  useEffect(() => {
    if (!onLogin) {
      return;
    }
    function refresh() {
      setGroups(transport.loginGroups());
    }
    function onVisibility() {
      if (document.visibilityState === 'visible') {
        refresh();
      }
    }
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', refresh);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [onLogin, transport]);

  if (!identity) {
    return (
      <main className="page-shell">
        <LoginScreen groups={groups} onPick={enter} notice={notice} />
      </main>
    );
  }

  return (
    <main className="page-shell">
      <ChatPanel
        key={identity.userId}
        transport={transport}
        identity={identity}
        slots={resolvedSlots}
        onSwitchUser={() => {
          switchUser();
        }}
        onSessionEnded={switchUser}
      />
    </main>
  );
}
