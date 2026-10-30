import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, Monitor, RefreshCw, Smartphone, Tablet } from 'lucide-react';
import { Banner, IconBtn, Segmented, cx } from '../common/ui';
import { openExternal } from '../../lib/open';
import { AndroidMirror } from './AndroidMirror';
import type { PreviewState } from '../../builder/usePreview';
import type { Template } from '../../builder/templates';

type Device = 'fit' | 'phone' | 'tablet';
type Surface = 'web' | 'android';
const SIZES: Record<Exclude<Device, 'fit'>, { w: number; h: number; r: number }> = { phone: { w: 390, h: 800, r: 44 }, tablet: { w: 820, h: 1100, r: 28 } };

/** The running app. Web projects render in a frame inside Lotus; Android shows a connected device. */
export const PreviewPane: React.FC<{ preview: PreviewState & { reload: () => void }; template: Template; onRun: (cmd: string) => void }> = ({ preview, template, onRun }) => {
  const [surface, setSurface] = useState<Surface>('web');
  const [device, setDevice] = useState<Device>(template.phone ? 'phone' : 'fit');
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => setDevice(template.phone ? 'phone' : 'fit'), [template.id, template.phone]);

  useEffect(() => {
    const el = box.current;
    if (!el || device === 'fit') { setScale(1); return; }
    const s = SIZES[device];
    const calc = () => setScale(Math.min(1, (el.clientWidth - 32) / s.w, (el.clientHeight - 32) / s.h));
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [device, surface]);

  const showAndroid = template.platforms.includes('Android');
  const frame = preview.url ? (
    <iframe key={preview.nonce} src={preview.url} title="App preview" sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals allow-pointer-lock"
      className="w-full h-full border-0 bg-white" />
  ) : null;

  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col bg-[var(--color-bg-panel)]">
      <div className="h-10 shrink-0 flex items-center gap-2 px-3 border-b border-[var(--sep)]">
        {showAndroid && <Segmented<Surface> label="What to show" value={surface} onChange={setSurface} options={[{ id: 'web', label: 'Web' }, { id: 'android', label: 'Android' }]} />}
        {surface === 'web' && (<>
          <input readOnly aria-label="Preview address" value={preview.url ?? ''} placeholder="Nothing is running yet" className="flex-1 min-w-0 h-6 px-2 rounded-[6px] bg-[var(--hover)] text-[12px] font-mono text-[var(--color-text-muted)] outline-none" />
          <IconBtn label="Reload preview" onClick={preview.reload} disabled={!preview.url}><RefreshCw className="w-3.5 h-3.5" /></IconBtn>
          <IconBtn label="Open in your browser" onClick={() => preview.url && void openExternal(preview.url)} disabled={!preview.url}><ExternalLink className="w-3.5 h-3.5" /></IconBtn>
          <Segmented<Device> label="Screen size" value={device} onChange={setDevice} options={[{ id: 'fit', label: 'Fit', icon: <Monitor className="w-3.5 h-3.5" /> }, { id: 'phone', label: 'Phone', icon: <Smartphone className="w-3.5 h-3.5" /> }, { id: 'tablet', label: 'Tablet', icon: <Tablet className="w-3.5 h-3.5" /> }]} />
        </>)}
      </div>

      {surface === 'android' ? <AndroidMirror onRun={onRun} /> : (
        <div ref={box} className={cx('flex-1 min-h-0 flex', device === 'fit' ? '' : 'items-center justify-center bg-[var(--hover)]/40 overflow-hidden')}>
          {preview.error && <div className="p-4 w-full"><Banner tone="error">{preview.error}</Banner></div>}
          {!preview.error && !frame && (
            <div className="m-auto max-w-sm text-center p-6">
              <p className="text-[14px] font-medium mb-1">Nothing to show yet</p>
              <p className="text-[12px] text-[var(--color-text-muted)] leading-snug">
                {template.previewDir === null
                  ? 'This project runs on a dev server. Install packages, then start the dev server from the Build tab, or ask the agent to build and run it. The app appears here.'
                  : 'The preview appears when the project has an index.html. Ask the agent to build something.'}
              </p>
            </div>
          )}
          {frame && device === 'fit' && frame}
          {frame && device !== 'fit' && (
            <div style={{ width: SIZES[device].w * scale, height: SIZES[device].h * scale }} className="shrink-0">
              <div style={{ width: SIZES[device].w, height: SIZES[device].h, transform: `scale(${scale})`, transformOrigin: 'top left', borderRadius: SIZES[device].r, padding: 10 }}
                className="bg-[#1b1b1f] shadow-[0_8px_30px_rgba(0,0,0,.3)]">
                <div className="w-full h-full overflow-hidden bg-white" style={{ borderRadius: SIZES[device].r - 10 }}>{frame}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
