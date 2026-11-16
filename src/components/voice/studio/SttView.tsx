// Speech to Text (0.8.2): long recordings → transcript with times → copy, export (.txt, .srt) or
// open in Chat with a request (summary, key points, meeting notes…). The work runs in voice/stt.ts.

import React, { useState } from 'react';
import { Clock, Copy, Download, FileAudio, Languages, MessageSquare, Mic, Square, Star, Trash2, Upload, Volume2, X } from 'lucide-react';
import { Btn, IconBtn, Progress, cx } from '../../common/ui';
import { MenuItem, Popover } from '../../common/Pane';
import { downloadBlob } from '../../../lib/audio';
import { estimateTokens } from '../../../chat/helpers';
import { effectiveNumCtx } from '../../../hardware/monitor';
import { TRANSCRIPT_ACTIONS, TRANSLATE_LANGS, clock, toSrt, transcriptText } from '../../../voice/studio';
import { translateText } from '../../../voice/translate';
import { SttJob, clearSttJob, stopTranscribing } from '../../../voice/stt';
import type { Transcript } from '../../../voice/useStudio';

const fileBase = (n: string) => n.replace(/\.[^.]+$/, '').replace(/[^\w\- ]+/g, '').trim() || 'transcript';

/** The running (or just finished) transcription: progress, the text so far, Stop. */
export const SttProgress: React.FC<{ job: SttJob }> = ({ job }) => {
  const live = job.state === 'reading' || job.state === 'working';
  const elapsed = (Date.now() - job.started) / 1000;
  const left = job.part > 0 && job.parts > job.part ? (elapsed / job.part) * (job.parts - job.part) : null;
  return (
    <div role="status" className="mb-5 rounded-[12px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)] p-3.5">
      <div className="flex items-center gap-2 text-[13px]">
        <FileAudio className="w-4 h-4 text-[var(--color-accent-vibrant)] shrink-0" />
        <span className="font-medium truncate flex-1">{job.name}</span>
        <span className="tabular-nums text-[12px] text-[var(--color-text-muted)]">
          {job.state === 'reading' ? 'Reading the audio…' : job.state === 'working' ? `Part ${job.part + 1} of ${job.parts}${job.seconds ? ` · ${clock(job.seconds)} long` : ''}${left ? ` · about ${clock(left)} left` : ''}`
            : job.state === 'done' ? 'Done' : job.state === 'stopped' ? 'Stopped' : 'Couldn’t finish'}
        </span>
        {live ? <Btn size="sm" icon={<Square className="w-3 h-3" fill="currentColor" />} onClick={stopTranscribing}>Stop</Btn>
          : <IconBtn label="Dismiss" onClick={clearSttJob}><X className="w-3.5 h-3.5" /></IconBtn>}
      </div>
      {live && <Progress className="mt-2.5" label="Transcribing" value={job.parts ? job.part / job.parts : null} />}
      {job.error && <p className="mt-2 text-[13px] text-[var(--c-red)]">{job.error}</p>}
      {live && !!job.waiting?.length && <p className="mt-2 text-[12px] text-[var(--color-text-muted)] truncate" title={job.waiting.join(', ')}>Next: {job.waiting.length === 1 ? job.waiting[0] : `${job.waiting.length} recordings (${job.waiting.join(', ')})`}. Stop also cancels these.</p>}
      {job.state === 'stopped' && job.segments.some((s) => s.text) && <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">What was written down so far is kept below.</p>}
      {live && job.segments.length > 0 && (
        <p className="mt-2.5 text-[13px] leading-relaxed text-[var(--color-text-muted)] max-h-24 overflow-hidden [mask-image:linear-gradient(to_top,transparent,black_40%)]">{transcriptText(job.segments.slice(-4))}</p>
      )}
    </div>
  );
};

/** Nothing transcribed yet: a big drop target. */
export const SttEmpty: React.FC<{ drag: boolean; onPick: () => void; onRecord: () => void; disabled: boolean }> = ({ drag, onPick, onRecord, disabled }) => (
  <div className={cx('flex-1 flex flex-col items-center justify-center text-center rounded-[16px] border-2 border-dashed px-6 py-12 transition-colors', drag ? 'border-[var(--color-accent-fill)] bg-[var(--color-accent-pastel)]' : 'border-[var(--sep)]')}>
    <FileAudio className="w-9 h-9 text-[var(--color-text-muted)] stroke-[1.2] mb-3" />
    <h3 className="text-[15px] font-semibold">Turn a recording into text</h3>
    <p className="text-[13px] text-[var(--color-text-muted)] mt-1 max-w-sm leading-relaxed">Drop or paste lectures, meetings, interviews or voice memos here, as many as you like (audio or video, hours long is fine). Whisper writes it down on this computer, then you can summarize it in Chat.</p>
    <div className="mt-4 flex gap-2">
      <Btn variant="primary" icon={<Upload className="w-3.5 h-3.5" />} onClick={onPick} disabled={disabled}>Choose a File</Btn>
      <Btn icon={<Mic className="w-3.5 h-3.5" />} onClick={onRecord} disabled={disabled}>Record</Btn>
    </div>
  </div>
);

/** One finished transcript. */
export const TranscriptCard: React.FC<{
  t: Transcript; selected: boolean; onDelete: () => void; onFav: () => void; onSpeak: (text: string) => void;
  onOpenInChat?: (a: { name: string; text: string; prompt: string }) => void;
  /** Saves a finished translation on the transcript (0.9.6). */
  onTranslated?: (lang: string, text: string) => void;
}> = ({ t, selected, onDelete, onFav, onSpeak, onOpenInChat, onTranslated }) => {
  const [open, setOpen] = useState(false);
  const [times, setTimes] = useState(false);
  // Which text is shown: the original (what was said) or one of its translations.
  const [view, setView] = useState<string>('original');
  const [tr, setTr] = useState<{ lang: string; done: number; total: number; ctrl: AbortController } | null>(null);
  const [trErr, setTrErr] = useState<string | null>(null);
  const segs = t.segments ?? [];
  const translations = t.translations ?? [];
  const shownTr = translations.find((x) => x.lang === view);
  const body = shownTr ? shownTr.text : times && segs.length ? transcriptText(segs, true) : t.text;
  const translate = async (lang: string) => {
    if (translations.some((x) => x.lang === lang)) { setView(lang); return; }
    const ctrl = new AbortController();
    setTrErr(null); setTr({ lang, done: 0, total: 0, ctrl });
    try {
      const text = await translateText(t.text, lang, { signal: ctrl.signal, onProgress: (done, total) => setTr((x) => (x && x.ctrl === ctrl ? { ...x, done, total } : x)) });
      onTranslated?.(lang, text);
      setView(lang);
    } catch (e) { if (!ctrl.signal.aborted) setTrErr((e as Error).message); }
    finally { setTr((x) => (x?.ctrl === ctrl ? null : x)); }
  };
  const long = body.length > 900;
  const name = t.source ? fileBase(t.source) : 'Transcript';
  const tokens = estimateTokens(t.text), ctx = effectiveNumCtx();
  const tooBig = tokens > ctx * 0.7;
  const words = t.text.trim().split(/\s+/).filter(Boolean).length;
  return (
    <div id={`v-${t.id}`} className={cx('rounded-[12px] p-3 -mx-3', selected && 'bg-[var(--hover)]')}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[13px] font-medium truncate">{t.source ?? 'Recording'}</span>
        <span className="text-[12px] text-[var(--color-text-muted)] tabular-nums whitespace-nowrap">{t.seconds ? `${clock(t.seconds)} · ` : ''}{words.toLocaleString()} words</span>
      </div>
      {translations.length > 0 && (
        <div role="tablist" aria-label="Transcript language" className="mb-2 flex flex-wrap gap-1">
          {[{ id: 'original', label: t.language ? `Original (${t.language})` : 'Original' }, ...translations.map((x) => ({ id: x.lang, label: x.lang }))].map((o) => (
            <button key={o.id} type="button" role="tab" aria-selected={view === o.id} onClick={() => setView(o.id)}
              className={cx('h-6 px-2 rounded-[6px] text-[12px]', view === o.id ? 'bg-[var(--color-accent-fill)] text-white font-medium' : 'bg-[var(--hover)] hover:bg-[var(--pressed)]')}>{o.label}</button>
          ))}
        </div>
      )}
      <p className={cx('text-[14px] leading-relaxed whitespace-pre-wrap', long && !open && 'max-h-[9.5rem] overflow-hidden [mask-image:linear-gradient(to_top,transparent,black_35%)]')}>{body}</p>
      {long && <button type="button" className="mt-1 text-[13px] text-[var(--color-accent-vibrant)] font-medium" onClick={() => setOpen((o) => !o)}>{open ? 'Show Less' : 'Show All'}</button>}
      {tr && (
        <div role="status" className="mt-2 flex items-center gap-2 text-[12px] text-[var(--color-text-muted)]">
          <span className="flex-1 truncate">Translating into {tr.lang}{tr.total > 1 ? ` · part ${Math.min(tr.done + 1, tr.total)} of ${tr.total}` : '…'}</span>
          <Btn size="sm" icon={<Square className="w-3 h-3" fill="currentColor" />} onClick={() => tr.ctrl.abort()}>Stop</Btn>
        </div>
      )}
      {trErr && <p className="mt-2 text-[12px] text-[var(--c-red)]">{trErr}</p>}
      <div className="mt-2 flex items-center gap-1 text-[12px] text-[var(--color-text-muted)]">
        {onOpenInChat && (
          <Popover align="left" className="w-[280px]" trigger={(o, tg) => <Btn size="sm" variant="primary" icon={<MessageSquare className="w-3 h-3" />} onClick={tg} aria-expanded={o}>Open in Chat</Btn>}>
            {(close) => (<>
              {TRANSCRIPT_ACTIONS.map((a) => <MenuItem key={a.id} onClick={() => { close(); onOpenInChat({ name: shownTr ? `${name} (${shownTr.lang} translation)` : `${name} (transcript)`, text: shownTr ? shownTr.text : transcriptText(segs.length ? segs : [{ start: 0, end: 0, text: t.text }], segs.length > 0), prompt: a.prompt }); }}>{a.label}</MenuItem>)}
              {tooBig && <p className="px-2.5 pt-1.5 pb-1 text-[12px] text-[var(--color-text-muted)] leading-snug">This transcript (about {tokens.toLocaleString()} tokens) is longer than the chat model’s context window ({ctx.toLocaleString()}), so Chat sees only part of it. Raise the context in Chat’s right panel (Model) or use a model with a bigger window.</p>}
            </>)}
          </Popover>
        )}
        {onTranslated && (
          <Popover align="left" className="w-[220px] max-h-[320px] overflow-y-auto" trigger={(o, tg) => <Btn size="sm" icon={<Languages className="w-3 h-3" />} onClick={tg} aria-expanded={o} disabled={!!tr}>Translate</Btn>}>
            {(close) => (<>
              <p className="px-2.5 pt-1 pb-1.5 text-[12px] text-[var(--color-text-muted)] leading-snug">The chat model translates it. The original stays as it was said.</p>
              {TRANSLATE_LANGS.map((l) => <MenuItem key={l} active={view === l} onClick={() => { close(); void translate(l); }}>{l}{translations.some((x) => x.lang === l) ? ' ✓' : ''}</MenuItem>)}
            </>)}
          </Popover>
        )}
        <span className="flex-1" />
        <span className="hidden sm:inline">{t.model} · {new Date(t.ts).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
        {segs.length > 0 && !shownTr && <IconBtn label={times ? 'Hide times' : 'Show times'} active={times} className="!w-6 !h-6" onClick={() => setTimes((x) => !x)}><Clock className="w-3.5 h-3.5" /></IconBtn>}
        <IconBtn label={t.fav ? 'Remove from favourites' : 'Add to favourites'} active={t.fav} className="!w-6 !h-6" onClick={onFav}><Star className="w-3.5 h-3.5" fill={t.fav ? 'currentColor' : 'none'} /></IconBtn>
        <IconBtn label="Copy" className="!w-6 !h-6" onClick={() => void navigator.clipboard.writeText(body)}><Copy className="w-3.5 h-3.5" /></IconBtn>
        <Popover align="right" trigger={(_o, tg) => <IconBtn label="Download" className="!w-6 !h-6" onClick={tg}><Download className="w-3.5 h-3.5" /></IconBtn>}>
          {(close) => (<>
            <MenuItem onClick={() => { close(); downloadBlob(new Blob([t.text], { type: 'text/plain' }), `${name}.txt`); }}>Text (.txt)</MenuItem>
            {translations.map((x) => <MenuItem key={x.lang} onClick={() => { close(); downloadBlob(new Blob([x.text], { type: 'text/plain' }), `${name} (${x.lang}).txt`); }}>{x.lang} Translation (.txt)</MenuItem>)}
            {segs.length > 0 && <MenuItem onClick={() => { close(); downloadBlob(new Blob([transcriptText(segs, true)], { type: 'text/plain' }), `${name} (with times).txt`); }}>Text with Times (.txt)</MenuItem>}
            {segs.length > 0 && <MenuItem onClick={() => { close(); downloadBlob(new Blob([toSrt(segs)], { type: 'application/x-subrip' }), `${name}.srt`); }}>Subtitles (.srt)</MenuItem>}
          </>)}
        </Popover>
        <IconBtn label="Read it aloud" className="!w-6 !h-6" onClick={() => onSpeak(shownTr ? shownTr.text : t.text)}><Volume2 className="w-3.5 h-3.5" /></IconBtn>
        <IconBtn label="Delete transcript" className="!w-6 !h-6 hover:!text-[var(--c-red)]" onClick={onDelete}><Trash2 className="w-3.5 h-3.5" /></IconBtn>
      </div>
    </div>
  );
};
