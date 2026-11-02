import React, { useEffect, useState } from 'react';
import { analyzeSample, SampleHealth as Health, trimAudio } from '../../lib/audio';
import { Btn, TextInput, cx } from '../common/ui';

/** Quality check and trimmer for one reference clip. */
export const SampleHealthPanel: React.FC<{ blob: Blob; onTrim: (wav: Blob, durationSec: number) => void }> = ({ blob, onTrim }) => {
  const [h, setH] = useState<Health | null>(null);
  const [err, setErr] = useState(false);
  const [a, setA] = useState('0');
  const [b, setB] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let off = false; setH(null); setErr(false);
    analyzeSample(blob).then((r) => { if (!off) { setH(r); setB(r.durationSec.toFixed(1)); setA('0'); } }).catch(() => { if (!off) setErr(true); });
    return () => { off = true; };
  }, [blob]);
  if (err) return <p className="text-[12px] text-[var(--color-text-muted)]">Couldn't analyse this clip.</p>;
  if (!h) return <p className="text-[12px] text-[var(--color-text-muted)]">Checking quality…</p>;
  const tone = h.verdict === 'good' ? 'text-[var(--c-green)]' : h.verdict === 'ok' ? 'text-[var(--c-orange)]' : 'text-[var(--c-red)]';
  const s = parseFloat(a), e = parseFloat(b);
  const valid = s >= 0 && e > s && e <= h.durationSec + 0.05 && (s > 0.01 || e < h.durationSec - 0.05);
  return (
    <div className="space-y-1.5 text-[12px]">
      <p className="tabular-nums text-[var(--color-text-muted)]">{h.durationSec.toFixed(1)} s · {(h.sampleRate / 1000).toFixed(1)} kHz · SNR {h.snrDb !== null ? `≈${h.snrDb} dB` : '—'} · peak {h.peakDb} dB</p>
      <p className={cx('font-medium', tone)}>{h.advice}</p>
      <div className="flex items-center gap-1.5">
        <span>Trim</span><TextInput className="!h-6 !w-16" aria-label="Trim start, seconds" value={a} onChange={(x) => setA(x.target.value)} />
        <span>to</span><TextInput className="!h-6 !w-16" aria-label="Trim end, seconds" value={b} onChange={(x) => setB(x.target.value)} />
        <Btn size="sm" disabled={!valid} loading={busy} onClick={async () => { setBusy(true); try { const r = await trimAudio(blob, s, e); onTrim(r.wav, r.durationSec); } finally { setBusy(false); } }}>Apply</Btn>
      </div>
    </div>
  );
};
