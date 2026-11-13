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
    initialIdentity(window.location.search),
  );
  const [view, setView] = useState<View>('chat');

  function enter(userId: string) {
    const next = identityForUser(userId);
    if (!next) {
      return;
    }
    storeIdentity(next);
    setView('chat');
    setIdentity(next);
  }

  function switchUser() {
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
        <LoginScreen onPick={enter} />
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
          onSwitchUser={switchUser}
          onOpenAdmin={() => {
            setView('admin');
          }}
        />
      )}
    </main>
  );
}
