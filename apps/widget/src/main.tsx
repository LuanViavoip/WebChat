import { createRoot } from 'react-dom/client';
import { WidgetApp } from './WidgetApp';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Elemento raiz ausente');
createRoot(root).render(<WidgetApp />);
