import React, { useCallback, useEffect, useState } from 'react';
import { Power, FolderSearch } from 'lucide-react';
import { ToolbarContent } from '../common/ToolbarSlot';
import { Btn, Empty, Banner, Spinner, cx } from '../common/ui';
import { VoiceSidebar, VoiceMode } from '../voice/VoiceSidebar';
import { VoiceInspector } from '../voice/VoiceInspector';
import { useVoiceData, useSelectedProfile } from '../voice/useVoiceData';
import { SpeakTab } from '../voice/SpeakTab';
import { VoicesTab } from '../voice/VoicesTab';
import { StoriesTab } from '../voice/StoriesTab';
import { DictateTab } from '../voice/DictateTab';
import { LibraryTab } from '../voice/LibraryTab';
import { startEngine, browseForExe, NeedsExecutable } from '../../services/engineControl';
import { onEvent } from '../../lib/bus';
import { voicebox } from '../../services/voicebox';

type Tab = VoiceMode;

export const VoiceWorkspace: React.FC<{ onOpenEngines: () => void }> = ({ onOpenEngines }) => {
  const data = useVoiceData();
  const [profile, selectProfile] = useSelectedProfile(data.profiles);
  const [tab, setTab] = useState<Tab>(() => (localStorage.getItem('lotus.voice.tab') as Tab) || 'speak');
  const [text, setText] = useState('');
  const [createRequested, setCreateRequested] = useState(false);
  const [storyClip, setStoryClip] = useState<string | null>(null);
  const [newStory, setNewStory] = useState(0);
  const [starting, setStarting] = useState(false);
  const [startErr, setStartErr] = useState<string | null>(null);
  const [needsExe, setNeedsExe] = useState(false);

  const go = (t: Tab) => { setTab(t); localStorage.setItem('lotus.voice.tab', t); };

  // Text sent over from the island or chat ("speak this").
  useEffect(() => {
    let off: (() => void) | undefined;
    void onEvent<string>('voice:speak-text', (t) => { setText(t); go('speak'); }).then((u) => (off = u));
    return () => off?.();
  }, []);

  const start = useCallback(async () => {
    setStarting(true); setStartErr(null); setNeedsExe(false);
    try {
      await startEngine('voicebox');
      // First launch loads Python and models, so give it time before declaring failure.
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        if (await voicebox.isUp()) { data.recheck(); break; }
      }
    } catch (e) {
      if (e instanceof NeedsExecutable) setNeedsExe(true); else setStartErr((e as Error).message);
    } finally { setStarting(false); }
  }, [data]);

  useEffect(() => { if (data.status === 'online') { setStarting(false); } }, [data.status]);

  return (
    <div className="flex-1 flex h-full min-h-0 bg-[var(--color-bg-panel)] overflow-hidden">
      <ToolbarContent>
        <div className="flex-1" />
        <span className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text-muted)]" role="status">
          <span className={cx('w-2 h-2 rounded-full', data.status === 'online' ? 'bg-[var(--c-green)]' : data.status === 'checking' ? 'bg-[var(--c-orange)] animate-pulse' : 'bg-[var(--c-red)]')} />
          {data.status === 'online'
            ? `Voicebox${data.health?.gpu_type ? ` · ${data.health.gpu_type}` : data.health?.gpu_available ? ' · GPU' : ' · CPU'}`
            : data.status === 'checking' ? 'Connecting…' : 'Voicebox offline'}
        </span>
      </ToolbarContent>

      <VoiceSidebar mode={tab} onMode={go} data={data} online={data.status === 'online'} profile={profile} onSelectProfile={selectProfile}
        onNew={() => { if (tab === 'voices') setCreateRequested(true); else if (tab === 'speak' || tab === 'library') { setText(''); go('speak'); } else if (tab === 'dictate') go('dictate'); else setNewStory((n) => n + 1); }}
        onReuse={(g) => { setText(g.text); selectProfile(g.profile_id); go('speak'); }} />
      <div className="flex-1 min-w-0 min-h-0 overflow-y-auto">
        {data.status === 'checking' ? (
          <div className="flex justify-center py-24"><Spinner className="w-5 h-5 text-[var(--color-accent-vibrant)]" /></div>
        ) : data.status === 'offline' ? (
          <div className="max-w-md mx-auto py-16 px-6 space-y-4">
            <Empty icon={<Power className="w-5 h-5" />} title="The voice engine isn't running"
              body="Voice runs on Voicebox, a local engine that keeps your voices, history and models on this computer. Start it to continue."
              action={<>
                <Btn variant="primary" loading={starting} icon={<Power className="w-3.5 h-3.5" />} onClick={start}>{starting ? 'Starting…' : 'Start Voicebox'}</Btn>
                <Btn variant="ghost" onClick={onOpenEngines}>Engine Settings</Btn>
              </>} />
            {needsExe && (
              <Banner tone="warn" action={<Btn size="sm" variant="secondary" icon={<FolderSearch className="w-3 h-3" />}
                onClick={async () => { if (await browseForExe('voicebox')) void start(); }}>Browse…</Btn>}>
                Lotus couldn't find Voicebox. Locate <code>voicebox-server.exe</code> once and it will remember.
              </Banner>
            )}
            {startErr && <Banner tone="error">{startErr}</Banner>}
          </div>
        ) : (
          <>
            {tab === 'speak' && <SpeakTab data={data} profile={profile} onSelectProfile={selectProfile} text={text} onText={setText}
              onOpenModels={onOpenEngines} onCreateVoice={() => { setCreateRequested(true); go('voices'); }}
              onAddToStory={(id) => { setStoryClip(id); go('stories'); }} />}
            {tab === 'voices' && <VoicesTab data={data} selectedId={profile?.id ?? null} onUse={(id) => { selectProfile(id); }}
              openCreate={createRequested} onCreateHandled={() => setCreateRequested(false)} />}
            {tab === 'stories' && <StoriesTab key={newStory} data={data} pendingGeneration={storyClip} onPendingHandled={() => setStoryClip(null)} />}
            {tab === 'dictate' && <DictateTab onSpeak={(t) => { setText(t); go('speak'); }} onOpenModels={onOpenEngines} />}
            {tab === 'library' && <LibraryTab data={data} onSpeakAgain={(t, pid) => { setText(t); selectProfile(pid); go('speak'); }}
              onAddToStory={(id) => { setStoryClip(id); go('stories'); }} />}
          </>
        )}
      </div>
      <VoiceInspector mode={tab} data={data} profile={profile} />
    </div>
  );
};
