import { useState } from 'react';
import type { ChatTransport, ConnectRequest } from './transport/ChatTransport';
import { AdminPlaceholder } from './ui/AdminPlaceholder';
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

type View = 'chat' | 'admin';

export function App({ transport }: { transport: ChatTransport }) {
  const [identity, setIdentity] = useState<ConnectRequest | undefined>(() =>
    initialIdentity(transport.loginGroups(), window.location.search),
  );
  const [view, setView] = useState<View>('chat');
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
    setView('chat');
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
    setView('chat');
    setIdentity(undefined);
  }

  if (!identity) {
    return (
      <main className="page-shell">
        <LoginScreen groups={groups} onPick={enter} notice={notice} />
      </main>
    );
  }

  return (
    <main className="page-shell">
      {view === 'admin' ? (
        <AdminPlaceholder
          onBack={() => {
            setView('chat');
          }}
        />
      ) : (
        <ChatPanel
          key={identity.userId}
          transport={transport}
          identity={identity}
          onSwitchUser={() => {
            switchUser();
          }}
          onSessionEnded={switchUser}
          onOpenAdmin={() => {
            setView('admin');
          }}
        />
      )}
    </main>
  );
}
