import { createRoot } from 'react-dom/client';
import './fonts';
import './index.css';
import React from 'react';
import { initStore } from './lib/store';
import { installTipDismiss } from './lib/tipDismiss';

if (typeof document !== 'undefined') installTipDismiss();

/** If the window itself breaks, say so plainly and offer the diagnostics, instead of a blank page (0.17.0). */
class CrashScreen extends React.Component<{ children: React.ReactNode }, { failed: boolean; copied: boolean }> {
  state = { failed: false, copied: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { void import('./lib/diagnostics').then((d) => d.recordError('window', error, true)).catch(() => undefined); }
  render() {
    if (!this.state.failed) return this.props.children;
    const copy = () => void import('./lib/diagnostics').then((d) => d.copyDiagnostics()).then((ok) => this.setState({ copied: ok }));
    return (
      <div className="h-screen w-screen flex items-center justify-center p-6 text-[14px] text-[var(--color-text-main)]">
        <div className="max-w-[420px] space-y-3 text-center">
          <p className="text-[16px] font-semibold">Something went wrong in this window</p>
          <p className="text-[13px] text-[var(--color-text-muted)]">Your chats and files are safe. Reload to carry on. If it keeps happening, copy the diagnostics and paste them when you ask for help.</p>
          <div className="flex justify-center gap-2">
            <button type="button" className="h-8 px-3 rounded-[8px] bg-[var(--hover)]" onClick={copy}>{this.state.copied ? 'Copied' : 'Copy Diagnostics'}</button>
            <button type="button" className="h-8 px-3 rounded-[8px] bg-[var(--color-accent-fill)] text-white" onClick={() => location.reload()}>Reload</button>
          </div>
        </div>
      </div>
    );
  }
}

// Load Lotus's saved data from the core (lotus.db) before any module reads it, then start the app.
// App is imported only after that, because some modules read their saved state when they load.
const root = createRoot(document.getElementById('root')!);
const slow = setTimeout(() => root.render(<div className="h-screen w-screen flex items-center justify-center text-[14px] text-[var(--color-text-muted)]">Starting Lotus…</div>), 700);

void initStore().finally(async () => {
  clearTimeout(slow);
  const { default: App } = await import('./App.tsx');
  void import('./lib/diagnostics').then((d) => d.installCrashCatcher()).catch(() => undefined);
  root.render(<CrashScreen><App /></CrashScreen>);
});
