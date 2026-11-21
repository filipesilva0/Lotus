// The card shown after a crash when crash reports are on (0.17.0): the exact report, editable, and
// Send (opens a GitHub issue the person submits), Copy, or Not Now. Nothing is sent from here.
import React, { useEffect, useState } from 'react';
import { Btn, TextArea } from './ui';
import { collectDiagnostics, dismissCrash, sendReport, useCrashReports } from '../../lib/diagnostics';
import type { LotusSettings } from '../../types/lotus';

export const CrashReportCard: React.FC<{ settings: LotusSettings }> = ({ settings }) => {
  const { pending } = useCrashReports();
  const [text, setText] = useState('');
  useEffect(() => { if (pending) void collectDiagnostics(settings).then(setText); else setText(''); }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!pending) return null;
  return (
    <div role="alertdialog" aria-label="Send a crash report?" className="fixed z-[65] bottom-4 right-4 w-[420px] max-w-[calc(100%-32px)] material-frosted rounded-[12px] p-4 space-y-2.5 text-[13px]">
      <p className="font-semibold">Lotus ran into a problem</p>
      <p className="text-[12px] text-[var(--color-text-muted)] leading-snug">This is the report Lotus would send. Edit anything you like. Send opens it as a GitHub issue in your browser, and nothing leaves your computer until you submit it there. Reports on GitHub are public.</p>
      <TextArea rows={8} value={text} onChange={(e) => setText(e.target.value)} aria-label="Crash report" className="!text-[12px] font-mono" />
      <div className="flex justify-end gap-2">
        <Btn size="sm" variant="ghost" onClick={dismissCrash}>Not Now</Btn>
        <Btn size="sm" onClick={() => { void navigator.clipboard.writeText(text).catch(() => undefined); }}>Copy</Btn>
        <Btn size="sm" variant="primary" disabled={!text} onClick={() => { void sendReport(text); dismissCrash(); }}>Send…</Btn>
      </div>
    </div>
  );
};
