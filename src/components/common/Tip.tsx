// A small ⓘ next to jargon (Top-P, CFG, VRAM…) that explains it in plain words on hover, focus or
// click (session 16: "tips everywhere for weird things, in a tips icon, not in text").
// `glossaryTip(label)` finds the explanation for a control's label, so sliders, labels and inspector
// rows get their tip without each page writing it again.

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

const GLOSSARY: [RegExp, string][] = [
  [/^temperature$/i, 'How adventurous the model is. Low (0–0.3): focused and repeatable, good for facts and code. High (0.8+): more varied and creative, but more likely to drift.'],
  [/^top-?p$/i, 'The model only picks from the most likely next words whose chances add up to this share. 0.9 means it ignores the least likely 10%. Lower is safer and blander.'],
  [/^top-?k$/i, 'The model only picks from this many of its most likely next words. 40 is a common default; lower is more predictable.'],
  [/^frequency penalty$/i, 'Discourages repeating the same words. The more a word was already used, the less likely it is again. 0 is off.'],
  [/^presence penalty$/i, 'Nudges the model toward new topics: any word already used becomes a bit less likely. 0 is off.'],
  [/^(repeat|repetition) penalty$/i, 'Discourages the model from repeating itself. Around 1.1 is typical; 1 is off.'],
  [/^seed$/i, 'The starting point for randomness. The same seed with the same settings gives the same result, so you can reproduce or tweak one you liked. Blank means random each time.'],
  [/^context( window| length)?$/i, 'How much text the model can keep in mind at once (your messages, its replies, files), in tokens. About 4 characters per token. Bigger uses more video memory.'],
  [/^max (tokens|length|output)/i, 'The longest reply allowed, in tokens (about 4 characters each). 0 means no limit.'],
  [/^stop sequences?$/i, 'Text that makes the model stop writing as soon as it produces it.'],
  [/^system prompt$/i, 'Instructions the model reads before every conversation: who it is and how to answer.'],
  [/guidance scale|^cfg\b/i, 'How strictly the image follows your prompt. Too low: it wanders. Too high: harsh, overcooked colours. 5–8 for most models; FLUX and Turbo models want 1–4.'],
  [/^steps$/i, 'How many times the image is refined from noise. More steps: more detail, slower. 20–30 for most models; Turbo and Lightning models need 4–8.'],
  [/^sampler$/i, 'The method used to turn noise into an image. "euler" is a safe default; "dpmpp_2m" is often sharper.'],
  [/^scheduler$/i, 'How the noise is reduced across the steps. "normal" works for most models; "karras" can add detail at low step counts.'],
  [/reference strength|^denoise/i, 'How much of the reference image may change. Low keeps it close to the original; high mostly keeps the composition.'],
  [/^strength$/i, 'How strongly the LoRA style is applied. 1 is full strength; above 1 can distort the image.'],
  [/^lora/i, 'A small add-on file that teaches an image model a style, character or concept without replacing the model.'],
  [/^checkpoint/i, 'The main image model file. It decides the overall look and what the model knows how to draw.'],
  [/negative prompt/i, 'Things you don\'t want in the image (blurry, text, extra fingers…).'],
  [/^aspect|canvas/i, 'The image\'s shape: width to height. 1:1 is square, 16:9 is widescreen.'],
  [/^(vram|video memory)/i, 'Memory on the graphics card. A model runs fast only when it fits here; what doesn\'t fit spills into slower system memory.'],
  [/^quantization|^quant\b/i, 'How much a model is compressed. Q4 is about a quarter the size of the original with a small quality loss; Q8 is close to the original but twice as big as Q4.'],
  [/^parameters?$|parameter size/i, 'The model\'s size in billions of weights (8B = 8 billion). Bigger models know more and reason better but need more memory and run slower.'],
  [/^embedding/i, 'A list of numbers that captures what a piece of text means, so Lotus can find related text even when the words differ.'],
  [/^tokens? per second|tok\/s/i, 'How fast the model writes. Around 4 characters per token; 20+ tokens per second reads comfortably.'],
  [/^thinking|reasoning/i, 'Some models can think step by step before answering. Slower, but better for maths, logic and planning.'],
  [/^speed$|^rate$/i, 'How fast the voice speaks.'],
  [/^exaggeration$/i, 'How expressive and emotional the voice sounds. Higher is more dramatic.'],
  [/^whisper/i, 'Speech-to-text model that turns your voice into text. Bigger versions are more accurate and slower.'],
  [/^approval/i, 'When Lotus stops to ask before an AI step runs: every step, only steps that change your files or leave this computer, or never.'],
  [/^deny rules?/i, 'Patterns for actions the AI must never do, even if you allow everything else (for example deleting files).'],
  [/^subagents?|background agents?/i, 'Helper AIs a main agent starts for separate parts of a job. They run side by side when video memory allows.'],
  [/^artifacts?$/i, 'A finished thing the AI made for you, a document, page, table or code file, saved in your Lotus Studio folder.'],
];

export function glossaryTip(label: string | undefined): string | undefined {
  if (!label) return undefined;
  const l = label.trim();
  return GLOSSARY.find(([re]) => re.test(l))?.[1];
}

/** The ⓘ icon. Shows its text in a small bubble on hover, keyboard focus or click; Esc hides it. */
export const Tip: React.FC<{ text?: string; label?: string; className?: string }> = ({ text, label, className }) => {
  const body = text ?? glossaryTip(label);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; up: boolean } | null>(null);
  const id = useId();
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    setPos({ x: Math.min(Math.max(r.left + r.width / 2, 150), window.innerWidth - 150), y: r.top > 160 ? r.top - 6 : r.bottom + 6, up: r.top > 160 });
  }, [open]);
  useEffect(() => {
    if (!pinned) return;
    const away = (e: MouseEvent) => { if (!btn.current?.contains(e.target as Node)) { setPinned(false); setOpen(false); } };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPinned(false); setOpen(false); } };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc); };
  }, [pinned]);
  if (!body) return null;
  return (
    <>
      <button ref={btn} type="button" aria-label={`About ${label ?? 'this'}`} aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)} onMouseLeave={() => { if (!pinned) setOpen(false); }}
        onFocus={() => setOpen(true)} onBlur={() => { if (!pinned) setOpen(false); }}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setPinned((p) => !p); setOpen(true); }}
        className={`inline-flex items-center justify-center w-4 h-4 shrink-0 rounded-full text-[var(--color-text-muted)] hover:text-[var(--color-accent-vibrant)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent-vibrant)] align-middle ${className ?? ''}`}>
        <Info className="w-3.5 h-3.5" aria-hidden />
      </button>
      {open && pos && createPortal(
        <div id={id} role="tooltip" className="fixed z-[200] w-[280px] px-3 py-2 rounded-[8px] material-overlay text-[12px] leading-snug text-[var(--color-text-main)] shadow-[0_0_0_0.5px_var(--sep),var(--shadow-2,0_8px_24px_rgba(0,0,0,.18))] pointer-events-none"
          style={{ left: pos.x, top: pos.y, transform: `translate(-50%, ${pos.up ? '-100%' : '0'})` }}>{body}</div>,
        document.body,
      )}
    </>
  );
};
