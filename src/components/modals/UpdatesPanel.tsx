import React from 'react';
import { Download, RefreshCw, CheckCircle2 } from 'lucide-react';
import { Banner, Btn, Card } from '../common/ui';
import { Toggle } from '../common/Toggle';
import type { Updates } from '../../hooks/useUpdates';

const mb = (n: number) => (n / 1048576).toFixed(1);

export const UpdatesPanel: React.FC<{ u: Updates }> = ({ u }) => {
  const { state } = u;
  const busy = state.kind === 'checking' || state.kind === 'installing';

  if (!u.supported) {
    return <Banner tone="info">Updates are available in the Lotus desktop app. This is the browser preview.</Banner>;
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--color-text-main)]">Lotus {u.version ?? ''}</p>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            {state.kind === 'current' && `You're on the latest version. Checked ${new Date(state.checkedAt).toLocaleTimeString()}.`}
            {state.kind === 'checking' && 'Checking for updates…'}
            {state.kind === 'available' && `Version ${state.info.version} is available.`}
            {state.kind === 'installing' && 'Downloading the update…'}
            {(state.kind === 'idle' || state.kind === 'error') && 'Not checked yet this session.'}
          </p>
        </div>
        <Btn
          variant={state.kind === 'available' ? 'secondary' : 'primary'}
          loading={state.kind === 'checking'}
          disabled={busy}
          onClick={u.check}
          icon={<RefreshCw className="w-3.5 h-3.5" />}
        >
          Check for updates
        </Btn>
      </Card>

      {state.kind === 'error' && (
        <Banner tone="error" action={<Btn size="sm" variant="ghost" onClick={u.check}>Try again</Btn>}>
          {state.message}
        </Banner>
      )}

      {state.kind === 'available' && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[var(--color-text-main)]">
                Update to {state.info.version}
              </p>
              <p className="text-xs text-[var(--color-text-muted)]">
                You have {state.info.current}.{state.info.date ? ` Released ${state.info.date.slice(0, 10)}.` : ''}
              </p>
            </div>
            {!u.portable && (
              <Btn variant="primary" onClick={u.install} icon={<Download className="w-3.5 h-3.5" />}>
                Download and restart
              </Btn>
            )}
          </div>
          {state.info.notes && (
            <pre className="text-xs leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto rounded-xl p-3 bg-[var(--color-bg-sidebar)] text-[var(--color-text-main)] font-sans">
              {state.info.notes}
            </pre>
          )}
          {u.portable ? (
            <Banner tone="warn">
              This is a portable copy, and the installer would add a second copy instead of replacing it. Download the new
              portable zip from the release page and replace this folder; your data in <code>data\</code> is kept.
            </Banner>
          ) : (
            <p className="text-xs text-[var(--color-text-muted)]">
              Lotus closes, installs the update and reopens. Anything running (a research run, a download) stops, so finish
              it first. The installer checks the update's signature before installing.
            </p>
          )}
        </Card>
      )}

      {state.kind === 'installing' && (
        <Card className="p-4 space-y-2" aria-live="polite">
          <div className="h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
            <div
              className="h-full bg-[var(--color-accent-vibrant)] transition-all"
              style={{ width: state.total ? `${Math.min(100, (state.downloaded / state.total) * 100)}%` : '35%' }}
            />
          </div>
          <p className="text-xs text-[var(--color-text-muted)] tabular-nums">
            {mb(state.downloaded)}{state.total ? ` of ${mb(state.total)}` : ''} MB. Lotus will restart when this finishes.
          </p>
        </Card>
      )}

      {state.kind === 'current' && (
        <p className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Nothing to install.
        </p>
      )}

      <Card className="p-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[var(--color-text-main)]">Check when Lotus starts</p>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5 max-w-sm leading-relaxed">
            Off by default. Checking contacts GitHub, which sees your IP address and the request, nothing else.
            Lotus never installs anything without you pressing the button.
          </p>
        </div>
        <Toggle checked={u.autoCheck} onChange={u.setAutoCheck} ariaLabel="Check for updates when Lotus starts" />
      </Card>
    </div>
  );
};
