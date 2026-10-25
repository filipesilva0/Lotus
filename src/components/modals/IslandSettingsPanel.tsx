import React, { useEffect, useState } from 'react';
import { Toggle } from '../common/Toggle';
import { Btn, Banner, Select } from '../common/ui';
import { IslandSettings, loadIsland, saveIsland } from '../../island/state';
import { ollamaClient } from '../../services/ollamaService';
import { voicebox, VoiceProfile } from '../../services/voicebox';
import { invokeNative } from '../../lib/bus';
import { isTauri } from '../../lib/http';
import { LotusSettings } from '../../types/lotus';

const Row: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({ title, hint, children }) => (
  <div className="flex items-center justify-between gap-6 py-3.5">
    <div className="min-w-0">
      <p className="text-xs font-semibold text-[var(--color-text-main)]">{title}</p>
      {hint && <p className="text-xs text-[var(--color-text-muted)] mt-0.5 leading-relaxed">{hint}</p>}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
);

const Group: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="p-4 bg-[var(--color-bg-sidebar)] rounded-[10px] border border-[var(--sep)]">
    <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">{title}</h4>
    <div className="divide-y divide-black/5 dark:divide-white/5">{children}</div>
  </section>
);

export const IslandSettingsPanel: React.FC = () => {
  const [s, setS] = useState<IslandSettings>(loadIsland);
  const [models, setModels] = useState<string[]>([]);
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [hooksOn, setHooksOn] = useState<boolean | null>(null);
  const [hookErr, setHookErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    ollamaClient.listModels().then((m) => setModels(m.map((x) => x.name))).catch(() => undefined);
    voicebox.listProfiles().then(setProfiles).catch(() => undefined);
    invokeNative<boolean>('hooks_installed').then((v) => setHooksOn(v ?? false));
  }, []);

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
        <Row title="Show the island" hint="A small always-on-top pill at the top of your screen for quick chat, dictation and notifications.">
          <Toggle checked={s.enabled} onChange={(v) => set({ enabled: v })} ariaLabel="Show the island" />
        </Row>
        <Row title="Model" hint="Which chat model the island uses.">
          <Select value={s.model} onChange={(e) => set({ model: e.target.value })} className="!w-52" aria-label="Island model">
            <option value="">Same as main chat</option>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
        </Row>
        <Row title="Read-aloud voice" hint="Voice used when the island reads an answer or your clipboard.">
          <Select value={s.voiceProfileId} onChange={(e) => set({ voiceProfileId: e.target.value })} className="!w-52" aria-label="Island voice">
            <option value="">Same as Voice tab</option>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Row>
        <Row title="Collapse when I click away" hint="The chat folds back into the pill a few seconds after it loses focus.">
          <Toggle checked={s.autoCollapse} onChange={(v) => set({ autoCollapse: v })} ariaLabel="Collapse when I click away" />
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
    <Row title="Read replies aloud" hint="Speak each chat reply with your selected voice (needs Voicebox running).">
      <Toggle checked={settings.autoReadResponses} onChange={(v) => onUpdateSettings({ autoReadResponses: v })} ariaLabel="Read replies aloud" />
    </Row>
    <p className="text-xs text-[var(--color-text-muted)] pt-3 leading-relaxed">Voices, languages, effects and dictation are managed in the Voice tab.</p>
  </Group>
);
