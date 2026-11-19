import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/space-grotesk/latin-700.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { readDebugFlags, wrapTransportForDebug } from './debug';
import { createClockFromSearch } from './devParams';
import { createShellSlots } from './shell/registry';
import { MockBackend } from './transport/mock/MockBackend';
import { LocalStorageMockStore } from './transport/mock/MockStore';
import { MockTransport } from './transport/mock/MockTransport';
import { createTabSync } from './transport/mock/TabSync';
import './styles/chat.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Elemento #root não encontrado');
}

const params = new URLSearchParams(window.location.search);
const falha = params.get('falha');
const conexao = params.get('conexao');
const failConnect = falha === 'conectar';
const failUpload = falha === 'upload' ? 'once' : 'never';
const slowUpload = params.get('upload') === 'lento';
const slowConnect = conexao === 'lenta';
const holdConnect = conexao === 'segurar';

const store = new LocalStorageMockStore();
if (params.get('reset') === '1') {
  store.clear();
}
const now = createClockFromSearch(window.location.search);
const backend = new MockBackend({ store, tabSync: createTabSync(), now });

const rawTransport = new MockTransport({
  backend,
  now,
  // Há humanos nas duas pontas: quem entrega e lê é o outro usuário (outra aba, via TabSync).
  simulateReceipts: false,
  failConnect,
  failUpload,
  holdConnect,
  delays: {
    ...(slowConnect ? { connectMs: 450 } : {}),
    ...(slowUpload ? { uploadChunkMs: 800 } : {}),
  },
  ...(slowUpload ? { uploadChunks: 5 } : {}),
});

if (holdConnect) {
  const hooks = window as Window & { __releaseConnect?: () => void };
  hooks.__releaseConnect = () => {
    rawTransport.releaseConnect();
  };
}

const debugFlags = readDebugFlags(window.location.search, window.sessionStorage, window.localStorage);
const transport = wrapTransportForDebug(rawTransport, debugFlags);
const slots = createShellSlots();

createRoot(root).render(
  <StrictMode>
    <App transport={transport} slots={slots} />
  </StrictMode>,
);
