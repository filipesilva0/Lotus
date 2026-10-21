import React, { useCallback, useEffect, useState } from 'react';
import { Search, Star, Download, Trash2, RotateCw, Play } from 'lucide-react';
import { voicebox, Generation, engineLabel, fmtDuration } from '../../services/voicebox';
import { downloadBlob } from '../../lib/audio';
import { Btn, Card, TextInput, Select, Empty, Banner, Spinner, IconBtn, cx } from '../common/ui';
import { AudioPlayer } from './AudioPlayer';
import { VoiceData } from './useVoiceData';

const PAGE = 25;

export const LibraryTab: React.FC<{ data: VoiceData; onSpeakAgain: (text: string, profileId: string) => void; onAddToStory: (id: string) => void }> = ({
  data, onSpeakAgain, onAddToStory,
}) => {
  const [q, setQ] = useState('');
  const [profileId, setProfileId] = useState('');
  const [favOnly, setFavOnly] = useState(false);
  const [items, setItems] = useState<Generation[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<{ id: string; url: string } | null>(null);

  const load = useCallback(async (reset: boolean, offset = 0) => {
    setLoading(true); setErr(null);
    try {
      const r = await voicebox.history({ search: q.trim() || undefined, profile_id: profileId || undefined, limit: PAGE, offset });
      setItems((cur) => (reset ? r.items : [...cur, ...r.items]));
      setTotal(r.total);
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, [q, profileId]);

  // Debounced reload when filters change.
  useEffect(() => { const t = setTimeout(() => void load(true), 250); return () => clearTimeout(t); }, [load]);

  const shown = favOnly ? items.filter((g) => g.is_favorited) : items;

  const play = async (g: Generation) => setOpen(open?.id === g.id ? null : { id: g.id, url: await voicebox.audioUrl(g.id) });
  const fav = async (g: Generation) => {
    await voicebox.toggleFavorite(g.id).catch(() => undefined);
    setItems((c) => c.map((x) => (x.id === g.id ? { ...x, is_favorited: !x.is_favorited } : x)));
  };
  const del = async (g: Generation) => {
    await voicebox.deleteGeneration(g.id).catch((e) => setErr(e.message));
    setItems((c) => c.filter((x) => x.id !== g.id));
    setTotal((t) => Math.max(0, t - 1));
  };

  return (
    <div className="p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
          <TextInput aria-label="Search generations" placeholder="Search what was said" value={q} onChange={(e) => setQ(e.target.value)} className="!pl-9" />
        </div>
        <Select aria-label="Filter by voice" value={profileId} onChange={(e) => setProfileId(e.target.value)} className="!w-44">
          <option value="">All voices</option>
          {data.profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Btn variant={favOnly ? 'secondary' : 'ghost'} icon={<Star className="w-3.5 h-3.5" fill={favOnly ? 'currentColor' : 'none'} />} onClick={() => setFavOnly(!favOnly)}>Favorites</Btn>
      </div>

      {err && <Banner tone="error">{err}</Banner>}

      {loading && items.length === 0 ? (
        <div className="flex justify-center py-16"><Spinner className="w-5 h-5 text-[var(--color-accent-vibrant)]" /></div>
      ) : shown.length === 0 ? (
        <Empty icon={<Play className="w-5 h-5" />} title={q || profileId || favOnly ? 'Nothing matches' : 'Your library is empty'}
          body={q || profileId || favOnly ? 'Try clearing a filter.' : 'Everything you generate is saved here, so you can replay, export or reuse it later.'} />
      ) : (
        <ul className="space-y-2">
          {shown.map((g) => (
            <li key={g.id}>
              <Card className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <button aria-label={open?.id === g.id ? 'Close player' : 'Play'} disabled={g.status !== 'completed'} onClick={() => play(g)}
                    className="mt-0.5 w-8 h-8 shrink-0 rounded-full bg-[var(--color-accent-pastel)] text-[var(--color-accent-vibrant)] flex items-center justify-center hover:brightness-95 disabled:opacity-40">
                    <Play className="w-3.5 h-3.5 ml-0.5" fill="currentColor" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[#111827] dark:text-slate-100 line-clamp-2 leading-relaxed">{g.text}</p>
                    <p className="text-[11px] text-[#9CA3AF] mt-1 tabular-nums">
                      {g.profile_name ?? 'Voice'} · {engineLabel(g.engine)} · {fmtDuration(g.duration)} · {new Date(g.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                      {g.status === 'failed' && <span className="text-rose-600 dark:text-rose-400"> · failed{g.error ? `: ${g.error}` : ''}</span>}
                    </p>
                  </div>
                  <div className="flex items-center shrink-0">
                    {g.status === 'failed' && <IconBtn label="Retry" onClick={async () => { await voicebox.retry(g.id); void load(true); }}><RotateCw className="w-3.5 h-3.5" /></IconBtn>}
                    <IconBtn label={g.is_favorited ? 'Remove favorite' : 'Favorite'} active={g.is_favorited} onClick={() => fav(g)}><Star className="w-3.5 h-3.5" fill={g.is_favorited ? 'currentColor' : 'none'} /></IconBtn>
                    <IconBtn label="Save as WAV" disabled={g.status !== 'completed'} onClick={async () => downloadBlob(await voicebox.exportAudio(g.id), `${g.profile_name ?? 'voice'}-${g.id.slice(0, 6)}.wav`)}><Download className="w-3.5 h-3.5" /></IconBtn>
                    <IconBtn label="Delete" onClick={() => del(g)}><Trash2 className="w-3.5 h-3.5" /></IconBtn>
                  </div>
                </div>
                {open?.id === g.id && (
                  <div className="mt-3 pt-3 border-t border-[#EBECEF] dark:border-[#2C2F38] space-y-2">
                    <AudioPlayer src={open.url} autoPlay />
                    <div className="flex gap-2">
                      <Btn size="sm" variant="ghost" onClick={() => onSpeakAgain(g.text, g.profile_id)}>Edit & regenerate</Btn>
                      <Btn size="sm" variant="ghost" onClick={() => onAddToStory(g.id)}>Add to story</Btn>
                    </div>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {items.length < total && !favOnly && (
        <div className="flex justify-center"><Btn variant="secondary" loading={loading} onClick={() => load(false, items.length)}>Load more</Btn></div>
      )}
    </div>
  );
};
