import { createRoot } from 'react-dom/client';
import { ConsoleApp } from './ConsoleApp';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Elemento raiz ausente');
createRoot(root).render(<ConsoleApp />);
