import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/space-grotesk/latin-700.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { MockTransport } from './transport/MockTransport';
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

const transport = new MockTransport({
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
