import { createRoot } from 'react-dom/client';
import './fonts';
import './index.css';
import { initStore } from './lib/store';

// Load Lotus's saved data from the core (lotus.db) before any module reads it, then start the app.
// App is imported only after that, because some modules read their saved state when they load.
const root = createRoot(document.getElementById('root')!);
const slow = setTimeout(() => root.render(<div className="h-screen w-screen flex items-center justify-center text-[14px] text-[var(--color-text-muted)]">Starting Lotus…</div>), 700);

void initStore().finally(async () => {
  clearTimeout(slow);
  const { default: App } = await import('./App.tsx');
  root.render(<App />);
});
