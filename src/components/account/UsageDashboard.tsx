import React, { useEffect, useMemo, useState } from 'react';
import { Activity, Brain, Clock, Flame, Gauge as GaugeIcon, Image as ImageIcon, MessageSquare, Puzzle, Sparkles, Type } from 'lucide-react';
import type { ChatSession } from '../../types/lotus';
import { compact, computeUsage, topModels, Usage } from '../../analytics/usage';
import { useMemoryStore } from '../../memory/store';
import { usePlugins } from '../../plugins/store';
import { idbGet } from '../../lib/idb';
import { cx } from '../common/ui';

/**
 * Usage analytics on the profile page. Colours come from the app icon's petals (validated as a
 * categorical set for light and dark, see index.css `--chart-*`); every chart also labels its
 * marks directly and has a table for screen readers, so colour is never the only cue.
 */

const CHART = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];

const Tile: React.FC<{ icon: React.ReactNode; label: string; value: string; hint?: string; tint: string }> = ({ icon, label, value, hint, tint }) => (
  <div className="relative min-w-0 px-3 py-2.5 rounded-[10px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)] overflow-hidden">
    <span aria-hidden="true" className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r-[2px]" style={{ background: tint }} />
    <p className="flex items-center gap-1.5 text-[12px] text-[var(--color-text-muted)]"><span style={{ color: tint }}>{icon}</span>{label}</p>
    <p className="mt-0.5 text-[20px] font-semibold tabular-nums tracking-[-0.01em] text-[var(--color-text-main)]">{value}</p>
    {hint && <p className="text-[12px] text-[var(--color-text-muted)] truncate">{hint}</p>}
  </div>
);

const Card: React.FC<{ title: string; subtitle?: string; legend?: { label: string; color: string }[]; children: React.ReactNode; className?: string }> = ({ title, subtitle, legend, children, className }) => (
  <section className={cx('min-w-0 p-3.5 rounded-[12px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)]', className)} aria-label={title}>
    <div className="flex items-start gap-3 mb-2.5">
      <div className="min-w-0">
        <h4 className="text-[13px] font-semibold text-[var(--color-text-main)]">{title}</h4>
        {subtitle && <p className="text-[12px] text-[var(--color-text-muted)]">{subtitle}</p>}
      </div>
      {legend && (
        <ul className="ml-auto flex items-center gap-3 shrink-0" aria-label="Legend">
          {legend.map((l) => <li key={l.label} className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-text-muted)]"><span aria-hidden="true" className="w-2.5 h-2.5 rounded-[3px]" style={{ background: l.color }} />{l.label}</li>)}
        </ul>
      )}
    </div>
    {children}
  </section>
);

/** Hover tooltip anchored inside a chart box. */
const Tip: React.FC<{ x: number | string; y: number; children: React.ReactNode }> = ({ x, y, children }) => (
  <div role="tooltip" className="material-frosted pointer-events-none absolute z-10 px-2.5 py-1.5 rounded-[8px] text-[12px] whitespace-nowrap -translate-x-1/2 -translate-y-full"
    style={{ left: x, top: y - 6 }}>{children}</div>
);

// ── Activity: messages per day, stacked (you / Lotus) ──────────────────────

const ActivityChart: React.FC<{ u: Usage }> = ({ u }) => {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560, H = 150, padL = 28, padB = 20, padT = 8;
  const max = Math.max(1, ...u.days.map((d) => d.sent + d.replies));
  const nice = max <= 5 ? 5 : max <= 10 ? 10 : Math.ceil(max / 10) * 10;
  const bw = (W - padL) / u.days.length;
  const barW = Math.max(6, Math.min(22, bw - 8));
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / nice);
  const hd = hover !== null ? u.days[hover] : null;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`Messages per day over the last ${u.days.length} days`} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={padL} x2={W} y1={y(nice * f)} y2={y(nice * f)} stroke="var(--sep)" strokeWidth={f === 0 ? 1 : 0.5} strokeDasharray={f === 0 ? undefined : '2 3'} />
            <text x={padL - 6} y={y(nice * f) + 3.5} textAnchor="end" fontSize="10" fill="var(--color-text-muted)">{Math.round(nice * f)}</text>
          </g>
        ))}
        {u.days.map((d, i) => {
          const cx0 = padL + bw * i + bw / 2;
          const x = cx0 - barW / 2;
          const ySent = y(d.sent), yAll = y(d.sent + d.replies);
          const gap = d.sent && d.replies ? 2 : 0;
          return (
            <g key={d.key} onMouseEnter={() => setHover(i)}>
              <rect x={padL + bw * i} y={padT} width={bw} height={H - padT - padB} fill="transparent" />
              {hover === i && <rect x={padL + bw * i + 1} y={padT} width={bw - 2} height={H - padT - padB} rx={4} fill="var(--hover)" />}
              {d.sent > 0 && <path d={roundedTop(x, ySent, barW, y(0) - ySent, d.replies ? 0 : 4)} fill={CHART[0]} />}
              {d.replies > 0 && <path d={roundedTop(x, yAll, barW, ySent - yAll - gap, 4)} fill={CHART[1]} />}
              {(i % 2 === (u.days.length - 1) % 2) && <text x={cx0} y={H - 5} textAnchor="middle" fontSize="10" fill="var(--color-text-muted)">{d.label}</text>}
            </g>
          );
        })}
      </svg>
      {hd && hover !== null && (
        <Tip x={`${((padL + bw * hover + bw / 2) / W) * 100}%`} y={0}>
          <p className="font-semibold">{new Date(hd.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</p>
          <p className="text-[var(--color-text-muted)]"><Swatch c={CHART[0]} />You sent <b className="text-[var(--color-text-main)] tabular-nums">{hd.sent}</b></p>
          <p className="text-[var(--color-text-muted)]"><Swatch c={CHART[1]} />Lotus replied <b className="text-[var(--color-text-main)] tabular-nums">{hd.replies}</b></p>
        </Tip>
      )}
      <table className="sr-only"><caption>Messages per day</caption><thead><tr><th>Day</th><th>You sent</th><th>Replies</th></tr></thead>
        <tbody>{u.days.map((d) => <tr key={d.key}><td>{d.label}</td><td>{d.sent}</td><td>{d.replies}</td></tr>)}</tbody></table>
    </div>
  );
};

const Swatch: React.FC<{ c: string }> = ({ c }) => <span aria-hidden="true" className="inline-block w-2 h-2 mr-1.5 rounded-[2px] align-middle" style={{ background: c }} />;

/** A bar with only the top corners rounded (data end), anchored flat on the baseline. */
function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return '';
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

// ── Models: replies per model, with average speed ──────────────────────────

const ModelsChart: React.FC<{ u: Usage }> = ({ u }) => {
  const rows = topModels(u.models, 5);
  const max = Math.max(1, ...rows.map((r) => r.replies));
  if (!rows.length) return <p className="text-[13px] text-[var(--color-text-muted)] py-6 text-center">No replies yet.</p>;
  return (
    <ul className="flex flex-col gap-2.5" aria-label="Replies per model">
      {rows.map((r, i) => (
        <li key={r.model} className="min-w-0" title={`${r.model}: ${r.replies} replies, ${r.words.toLocaleString()} words${r.avgTps ? `, ${r.avgTps} tokens/s on average` : ''}`}>
          <div className="flex items-baseline gap-2 text-[12px]">
            <span className="truncate font-medium text-[var(--color-text-main)]">{r.model}</span>
            <span className="ml-auto shrink-0 tabular-nums text-[var(--color-text-muted)]">{r.replies} {r.replies === 1 ? 'reply' : 'replies'}{r.avgTps ? ` · ${r.avgTps} tok/s` : ''}</span>
          </div>
          <div className="mt-1 h-2 rounded-[2px] bg-[var(--hover)] overflow-hidden">
            <div className="h-full rounded-r-[4px] transition-[width] duration-500" style={{ width: `${Math.max(2, (r.replies / max) * 100)}%`, background: CHART[i % CHART.length] }} />
          </div>
        </li>
      ))}
    </ul>
  );
};

// ── When you chat: 24 hourly cells, one hue light → dark ───────────────────

const HoursChart: React.FC<{ u: Usage }> = ({ u }) => {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...u.hours);
  const step = (v: number) => (v === 0 ? 0 : Math.ceil((v / max) * 4)); // 0..4
  const fill = ['var(--hover)', 'color-mix(in srgb, var(--chart-1) 28%, transparent)', 'color-mix(in srgb, var(--chart-1) 50%, transparent)', 'color-mix(in srgb, var(--chart-1) 75%, transparent)', 'var(--chart-1)'];
  const peak = u.hours.indexOf(Math.max(...u.hours));
  const h12 = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' });
  return (
    <div className="relative">
      <div className="grid grid-cols-[repeat(24,minmax(0,1fr))] gap-[2px]" role="img" aria-label={u.sent ? `You chat most around ${h12(peak)}` : 'No messages yet'} onMouseLeave={() => setHover(null)}>
        {u.hours.map((v, h) => (
          <div key={h} onMouseEnter={() => setHover(h)} className={cx('h-8 rounded-[4px] transition-transform', hover === h && 'scale-y-110')} style={{ background: fill[step(v)] }} />
        ))}
      </div>
      <div className="mt-1 grid grid-cols-4 text-[12px] text-[var(--color-text-muted)]">{[0, 6, 12, 18].map((h) => <span key={h}>{h12(h)}</span>)}</div>
      {hover !== null && <Tip x={`${((hover + 0.5) / 24) * 100}%`} y={0}><b className="tabular-nums">{u.hours[hover]}</b> message{u.hours[hover] === 1 ? '' : 's'} at {h12(hover)}</Tip>}
      {u.sent > 0 && <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">Busiest hour: <span className="text-[var(--color-text-main)] font-medium">{h12(peak)}</span></p>}
      <table className="sr-only"><caption>Messages by hour</caption><tbody>{u.hours.map((v, h) => <tr key={h}><td>{h12(h)}</td><td>{v}</td></tr>)}</tbody></table>
    </div>
  );
};

// ── Features ───────────────────────────────────────────────────────────────

const FeaturesChart: React.FC<{ u: Usage }> = ({ u }) => {
  const max = Math.max(1, ...u.features.map((f) => f.count));
  return (
    <ul className="flex flex-col gap-2" aria-label="How often features were used">
      {u.features.map((f) => (
        <li key={f.id} className="grid grid-cols-[110px_1fr_36px] items-center gap-2 text-[12px]">
          <span className="text-[var(--color-text-muted)] truncate">{f.label}</span>
          <span className="h-2 rounded-[2px] bg-[var(--hover)] overflow-hidden"><span className="block h-full rounded-r-[4px]" style={{ width: f.count ? `${Math.max(3, (f.count / max) * 100)}%` : 0, background: 'var(--chart-4)' }} /></span>
          <span className="text-right tabular-nums text-[var(--color-text-main)]">{f.count}</span>
        </li>
      ))}
    </ul>
  );
};

export const UsageDashboard: React.FC<{ sessions: ChatSession[] }> = ({ sessions }) => {
  const u = useMemo(() => computeUsage(sessions), [sessions]);
  const mem = useMemoryStore();
  const installed = usePlugins();
  const [images, setImages] = useState<number | null>(null);
  useEffect(() => {
    void idbGet<{ versions?: unknown[] }[]>('gallery.v1').then((g) => setImages(Array.isArray(g) ? g.reduce((a, s) => a + (s.versions?.length ?? 0), 0) : 0));
  }, []);
  const since = u.firstUse ? new Date(u.firstUse).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <h3 className="text-[15px] font-semibold">Your usage</h3>
        <p className="text-[12px] text-[var(--color-text-muted)]">{since ? `Since ${since} · counted on this computer from saved chats (incognito chats are never counted)` : 'Nothing yet. Start a chat and this fills in.'}</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <Tile icon={<MessageSquare className="w-3.5 h-3.5" />} label="Chats" value={compact(u.chats)} tint="var(--petal-blue)" />
        <Tile icon={<Activity className="w-3.5 h-3.5" />} label="Messages sent" value={compact(u.sent)} hint={`${compact(u.replies)} replies`} tint="var(--petal-orange)" />
        <Tile icon={<Type className="w-3.5 h-3.5" />} label="Words generated" value={compact(u.words)} tint="var(--petal-green)" />
        <Tile icon={<GaugeIcon className="w-3.5 h-3.5" />} label="Average speed" value={u.avgTps ? `${u.avgTps}` : '—'} hint={u.avgTps ? 'tokens per second' : 'measured on new replies'} tint="var(--petal-violet)" />
        <Tile icon={<Clock className="w-3.5 h-3.5" />} label="Active days" value={`${u.activeDays30}`} hint="in the last 30" tint="var(--petal-red)" />
        <Tile icon={<Flame className="w-3.5 h-3.5" />} label="Streak" value={`${u.streak} day${u.streak === 1 ? '' : 's'}`} tint="var(--petal-yellow)" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-3">
        <Card title="Activity" subtitle={`Last ${u.days.length} days`} legend={[{ label: 'You', color: CHART[0] }, { label: 'Lotus', color: CHART[1] }]}><ActivityChart u={u} /></Card>
        <Card title="Models" subtitle="Replies and average speed"><ModelsChart u={u} /></Card>
        <Card title="When you chat" subtitle="Your messages by hour of day"><HoursChart u={u} /></Card>
        <Card title="Features" subtitle="Replies that used each one"><FeaturesChart u={u} /></Card>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 px-1 text-[12px] text-[var(--color-text-muted)]">
        <span className="inline-flex items-center gap-1.5"><Brain className="w-3.5 h-3.5 text-[var(--petal-violet)]" />{mem.memories.length} memories</span>
        <span className="inline-flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-[var(--petal-orange)]" />{mem.skills.length} skills</span>
        <span className="inline-flex items-center gap-1.5"><Puzzle className="w-3.5 h-3.5 text-[var(--petal-green)]" />{installed.length} plugin{installed.length === 1 ? '' : 's'} ({installed.filter((p) => p.enabled).length} on)</span>
        <span className="inline-flex items-center gap-1.5"><ImageIcon className="w-3.5 h-3.5 text-[var(--petal-blue)]" />{images === null ? '…' : images} images in the gallery</span>
      </div>
    </div>
  );
};
