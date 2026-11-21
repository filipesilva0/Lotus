// Settings › Privacy (0.17.0): crash reports (off by default) with a preview, Copy Diagnostics, and
// the terms of use, privacy policy and open-source notices. The terms and policy are the files in
// docs/legal, so the app and the repository always say the same thing.
import React, { useState } from 'react';
import { Check, ClipboardCopy, Eye } from 'lucide-react';
import { Toggle } from '../common/Toggle';
import { Btn } from '../common/ui';
import { THIRD_PARTY_LICENSES_TEXT } from '../../data/licenses';
import { collectDiagnostics, copyDiagnostics, setCrashReports, useCrashReports, clearErrors, recentErrors } from '../../lib/diagnostics';
import type { LotusSettings } from '../../types/lotus';
import TERMS from '../../../docs/legal/TERMS.md?raw';
import PRIVACY from '../../../docs/legal/PRIVACY.md?raw';

const Doc: React.FC<{ title: string; text: string }> = ({ title, text }) => (
  <details className="group">
    <summary className="text-[13px] py-2 cursor-default select-none">{title}</summary>
    <pre className="p-4 bg-[var(--hover)] rounded-[10px] text-[12px] text-[var(--color-text-main)] whitespace-pre-wrap max-h-[360px] overflow-y-auto leading-relaxed select-text">{text}</pre>
  </details>
);

export const PrivacyPanel: React.FC<{ settings: LotusSettings }> = ({ settings }) => {
  const crash = useCrashReports();
  const [preview, setPreview] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean | null>(null);
  const copy = async () => { setCopied(await copyDiagnostics(settings)); setTimeout(() => setCopied(null), 2000); };
  const show = async () => setPreview(preview ? null : await collectDiagnostics(settings));
  const errs = recentErrors().length;

  return (
    <div className="space-y-4 pt-2">
      <section aria-label="Crash reports" className="space-y-2">
        <div className="flex items-center justify-between gap-4 py-1">
          <div className="min-w-0">
            <span className="text-[13px] block">Offer to send crash reports</span>
            <span className="block text-[12px] text-[var(--color-text-muted)] leading-snug mt-0.5">
              Off by default. When Lotus breaks, it shows you the report first. Send opens a GitHub issue in your browser that you read and submit yourself. Nothing is sent without you.
            </span>
          </div>
          <Toggle checked={crash.on} onChange={setCrashReports} ariaLabel="Offer to send crash reports" />
        </div>
        <p className="text-[12px] text-[var(--color-text-muted)] leading-snug">
          A report holds the Lotus version, your system, graphics card and memory, which engines and models are installed, and recent error messages. Never your chats, prompts, files or file names. Your user name is cut out of folder paths.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Btn size="sm" icon={<Eye className="w-3.5 h-3.5" />} onClick={() => void show()}>{preview ? 'Hide Preview' : 'Preview What’s Sent'}</Btn>
          <Btn size="sm" icon={copied ? <Check className="w-3.5 h-3.5" /> : <ClipboardCopy className="w-3.5 h-3.5" />} onClick={() => void copy()}>{copied === true ? 'Copied' : copied === false ? 'Couldn’t Copy' : 'Copy Diagnostics'}</Btn>
          {errs > 0 && <Btn size="sm" variant="ghost" onClick={() => { clearErrors(); setPreview(null); }}>Clear {errs} Saved Error{errs === 1 ? '' : 's'}</Btn>}
        </div>
        {preview && <pre aria-label="Diagnostics preview" className="p-3 bg-[var(--hover)] rounded-[10px] text-[12px] font-mono whitespace-pre-wrap max-h-[260px] overflow-y-auto select-text">{preview}</pre>}
      </section>

      <section aria-label="Terms and policies" className="border-t border-[var(--sep)] pt-2">
        <Doc title="Terms of Use" text={TERMS} />
        <Doc title="Privacy Policy" text={PRIVACY} />
        <Doc title="Open-Source Notices" text={THIRD_PARTY_LICENSES_TEXT} />
      </section>
    </div>
  );
};
