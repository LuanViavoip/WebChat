import '@fontsource/montserrat/latin-600.css';
import '@fontsource/montserrat/latin-700.css';
import '@fontsource/open-sans/latin-400.css';
import '@fontsource/open-sans/latin-600.css';
import { createRoot } from 'react-dom/client';
import { ConsoleApp } from './ConsoleApp';
import './ui/tokens.css';
import './ui/base.css';
import './ui/ui.css';
import './desk/desk.css';
import './ui/panels.css';
import './auth/login.css';

const root = document.getElementById('root');
if (!root) throw new Error('Elemento raiz ausente');
createRoot(root).render(<ConsoleApp />);
