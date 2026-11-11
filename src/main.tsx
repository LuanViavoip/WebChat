import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/space-grotesk/latin-700.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, type AppMode } from './App';
import { MockTransport } from './transport/MockTransport';
import './styles/chat.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Elemento #root não encontrado');
}

const params = new URLSearchParams(window.location.search);
const patientName = params.get('nome')?.trim() || 'Maria Silva';
const mode: AppMode = params.get('modo') === 'widget' ? 'widget' : 'page';
const failConnect = params.get('falha') === 'conectar';

createRoot(root).render(
  <StrictMode>
    <App transport={new MockTransport({ failConnect })} patientName={patientName} mode={mode} />
  </StrictMode>,
);
