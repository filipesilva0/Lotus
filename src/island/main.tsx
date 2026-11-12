import { createRoot } from 'react-dom/client';
import '../fonts';
import '../index.css';
import { initStore } from '../lib/store';

// Same order as the main window: saved data first, then the modules that read it.
void initStore().finally(async () => {
  const { Island } = await import('./Island');
  createRoot(document.getElementById('root')!).render(<Island />);
});
