import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/space-grotesk/latin-700.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
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
const backend = new MockBackend({ store, tabSync: createTabSync() });

const transport = new MockTransport({
  backend,
  // TODO Bloco 4: desligar. A UI ainda é de conversa única (sem outro humano), então o destinatário é simulado.
  simulateReceipts: true,
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
    transport.releaseConnect();
  };
}

createRoot(root).render(
  <StrictMode>
    <App transport={transport} />
  </StrictMode>,
);
