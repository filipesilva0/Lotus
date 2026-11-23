import React, { useEffect, useState } from 'react';
import { Tip } from '../common/Tip';
import { Toggle } from '../common/Toggle';
import { Btn, Banner, Select, InfoNote, TextInput } from '../common/ui';
import { IslandSettings, loadIsland, saveIsland } from '../../island/state';
import { voicebox, VoiceProfile } from '../../services/voicebox';
import { invokeNative } from '../../lib/bus';
import { isTauri } from '../../lib/http';
import { LotusSettings } from '../../types/lotus';

const Row: React.FC<{ title: string; hint?: string; children?: React.ReactNode }> = ({ title, hint, children }) => (
  <div className="flex items-center justify-between gap-6 py-3.5">
    <div className="min-w-0">
      <p className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-text-main)]">{title}<Tip label={title} /></p>
      {hint && <p className="text-xs text-[var(--color-text-muted)] mt-0.5 leading-relaxed">{hint}</p>}
    </div>
    {children && <div className="shrink-0">{children}</div>}
  </div>
);

const Group: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="py-3.5 border-b border-[var(--sep)] last:border-b-0">
    <h4 className="text-xs font-semibold text-[var(--color-text-muted)] mb-1">{title}</h4>
    <div className="divide-y divide-black/5 dark:divide-white/5">{children}</div>
  </section>
);

export const IslandSettingsPanel: React.FC<{ models: { id: string; name: string }[]; voiceEngine: LotusSettings['voiceEngine'] }> = ({ models, voiceEngine }) => {
  const [s, setS] = useState<IslandSettings>(loadIsland);
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [hooksOn, setHooksOn] = useState<boolean | null>(null);
  const [hookErr, setHookErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (voiceEngine === 'voicebox') voicebox.listProfiles().then(setProfiles).catch(() => undefined);
    invokeNative<boolean>('hooks_installed').then((v) => setHooksOn(v ?? false));
  }, [voiceEngine]);

  const set = (p: Partial<IslandSettings>) => setS(saveIsland(p));

  const toggleHooks = async () => {
    setBusy(true); setHookErr(null);
    try {
      await invokeNative(hooksOn ? 'hooks_uninstall' : 'hooks_install');
      setHooksOn(!hooksOn);
    } catch (e) { setHookErr(String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <Group title="Floating island">
        <Row title="Show the island" hint="A small pill at the top of your screen that appears only while something is happening (work, images, voice) or when Lotus needs your answer, then gets out of the way. Questions and permission requests always show, even with this off. Quick chat: Ctrl+Alt+Space.">
          <Toggle checked={s.enabled} onChange={(v) => set({ enabled: v })} ariaLabel="Show the island" />
        </Row>
        <Row title="Model" hint="Which chat model the island uses.">
          <Select value={s.model} onChange={(e) => set({ model: e.target.value })} className="!w-52" aria-label="Island model">
            <option value="">Same as main chat</option>
            {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            {s.model && !models.some((m) => m.id === s.model) && <option value={s.model}>{s.model} (not installed)</option>}
          </Select>
        </Row>
        {voiceEngine === 'voicebox' ? (
          <Row title="Read-aloud voice" hint="Voicebox voice used when the island reads an answer or your clipboard.">
            <Select value={s.voiceProfileId} onChange={(e) => set({ voiceProfileId: e.target.value })} className="!w-52" aria-label="Island voice">
              <option value="">Same as the Voice page</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Row>
        ) : <div className="py-2.5"><InfoNote title="Read-aloud voice">The island reads with the voice in use on the Voice page. Change it there.</InfoNote></div>}
        <Row title="Collapse when I click away" hint="The chat folds back into the pill a few seconds after it loses focus.">
          <Toggle checked={s.autoCollapse} onChange={(v) => set({ autoCollapse: v })} ariaLabel="Collapse when I click away" />
        </Row>
        <Row title="Open with the mouse" hint="Push the mouse against the top centre of any screen and the island opens there, with your quick buttons, a note box and what's next.">
          <Toggle checked={s.wake} onChange={(v) => set({ wake: v })} ariaLabel="Open with the mouse" />
        </Row>
        <Row title="Colour" hint="Match Lotus: white in light mode, black in dark mode. Frosted glass: see-through, light or dark with Lotus. On a Mac it is always black, to blend with the notch.">
          <Select value={s.surface} onChange={(e) => set({ surface: e.target.value as IslandSettings['surface'] })} className="!w-52" aria-label="Island colour">
            <option value="auto">Match Lotus</option>
            <option value="black">Always black</option>
            <option value="glass">Frosted glass</option>
          </Select>
        </Row>
      </Group>

      <Group title="On the island">
        <Row title="Now playing" hint="Shows the song or video playing on this PC, with play, pause and skip.">
          <Toggle checked={s.media} onChange={(v) => set({ media: v })} ariaLabel="Now playing" />
        </Row>
        <Row title="Pause music while Lotus talks" hint="Your music pauses during calls, dictation and read-aloud, and plays again when they end.">
          <Toggle checked={s.autoPause} onChange={(v) => set({ autoPause: v })} ariaLabel="Pause music while Lotus talks" />
        </Row>
        <Row title="Offer actions for copied text" hint="After you copy some text, the island offers Explain, Summarise, Translate, Fix wording and Read aloud. Everything stays on this PC. Copies from password managers are ignored.">
          <Toggle checked={s.clipboard} onChange={(v) => set({ clipboard: v })} ariaLabel="Offer actions for copied text" />
        </Row>
        {s.clipboard && (
          <Row title="Translate into" hint="The language for Translate.">
            <TextInput value={s.translateTo} onChange={(e) => set({ translateTo: e.target.value })} className="!w-52" aria-label="Translate into" />
          </Row>
        )}
        <Row title="Focus timer" hint="Minutes for a focus timer. Start one from the island, or with Focus on a task.">
          <Select value={String(s.focusMinutes)} onChange={(e) => set({ focusMinutes: Number(e.target.value) })} className="!w-52" aria-label="Focus timer minutes">
            {[15, 25, 45, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
          </Select>
        </Row>
        <Row title="Calendar for Next up" hint="Paste your calendar's private address (in Google Calendar: Settings → your calendar → Secret address in iCal format; in Outlook: Settings → Shared calendars → Publish). Lotus reads it every 10 minutes to show your next meeting with a Join button. Leave empty to show only tasks and routines.">
          <TextInput value={s.calendarUrl} onChange={(e) => set({ calendarUrl: e.target.value.trim() })} placeholder="https://…/basic.ics" className="!w-52" aria-label="Calendar address" />
        </Row>
      </Group>

      <Group title="Shortcuts">
        {[['Ctrl + Alt + Space', 'Open the island chat'], ['Ctrl + Alt + D', 'Start or stop dictation'], ['Ctrl + Alt + T', 'Show or hide the island']].map(([k, d]) => (
          <Row key={k} title={d}><kbd className="px-2 py-1 rounded-[6px] bg-black/5 dark:bg-white/10 text-xs font-semibold">{k}</kbd></Row>
        ))}
        <p className="text-xs text-[var(--color-text-muted)] pt-3">If a shortcut does nothing, another app may already be using it.</p>
      </Group>

      <Group title="Claude Code">
        <Row title="Show Claude Code on the island" hint="See when a session is working, and approve or deny its permission prompts without switching windows.">
          <Toggle checked={s.agents} onChange={(v) => set({ agents: v })} ariaLabel="Show Claude Code on the island" />
        </Row>
        <Row title={hooksOn ? 'Connected' : 'Not connected'}
          hint="Adds Lotus's hooks to your Claude Code settings file (a backup is saved next to it). Claude Code keeps working normally while Lotus is closed.">
          {isTauri
            ? <Btn variant={hooksOn ? 'ghost' : 'primary'} loading={busy} disabled={hooksOn === null} onClick={toggleHooks}>{hooksOn ? 'Disconnect' : 'Connect'}</Btn>
            : <span className="text-xs text-[var(--color-text-muted)]">Desktop app only</span>}
        </Row>
        {hookErr && <div className="pt-3"><Banner tone="error">{hookErr}</Banner></div>}
      </Group>
    </div>
  );
};

export const VoiceSettingsPanel: React.FC<{ settings: LotusSettings; onUpdateSettings: (p: Partial<LotusSettings>) => void }> = ({ settings, onUpdateSettings }) => (
  <Group title="Voice">
    <Row title="Read replies aloud" hint="Speaks each chat reply with the voice in use on the Voice page.">
      <Toggle checked={settings.autoReadResponses} onChange={(v) => onUpdateSettings({ autoReadResponses: v })} ariaLabel="Read replies aloud" />
    </Row>
    <Row title="Speak when Lotus needs you" hint="Reads aloud when an agent asks you something (“This happened. Should I continue with A, B or C?”), needs your permission, or finishes a piece of work. Uses the voice in use on the Voice page, or your computer's own voice when none is ready.">
      <Toggle checked={settings.voiceNotify === true} onChange={(v) => onUpdateSettings({ voiceNotify: v })} ariaLabel="Speak when Lotus needs you" />
    </Row>
    <Row title="Listen for my answer" hint="After a spoken question, Lotus listens and answers for you when you stop talking: say an option (“the second one”), “allow” or “deny”, or anything else. Needs a Whisper model (Models) to turn speech into text. Clicking or typing an answer still works.">
      <Toggle checked={settings.voiceAnswer !== false} onChange={(v) => onUpdateSettings({ voiceAnswer: v })} ariaLabel="Listen for my answer" />
    </Row>
    <p className="text-xs text-[var(--color-text-muted)] pt-3 leading-relaxed">Voices, effects, the speech-to-text language and voice calls are on the Voice page.</p>
  </Group>
);
