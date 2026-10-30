import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, Circle, Play, RefreshCw, Square } from 'lucide-react';
import { invokeNative } from '../../lib/bus';
import { Banner, Btn, IconBtn, Select, Spinner } from '../common/ui';

interface Device { serial: string; state: string; model: string }
interface Paths { sdk: string | null; adb: string | null; emulator: string | null }

/**
 * Shows a connected Android phone or emulator inside Lotus: a screenshot every second or so (adb),
 * taps and swipes sent back. It is a mirror, not a video stream, so it is not smooth.
 */
export const AndroidMirror: React.FC<{ onRun: (command: string) => void }> = ({ onRun }) => {
  const [paths, setPaths] = useState<Paths | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [avds, setAvds] = useState<string[]>([]);
  const [avd, setAvd] = useState('');
  const [serial, setSerial] = useState('');
  const [frame, setFrame] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const img = useRef<HTMLImageElement>(null);
  const down = useRef<{ x: number; y: number; t: number } | null>(null);

  useEffect(() => {
    void invokeNative<Paths>('android_paths').then((p) => setPaths(p ?? null));
    void invokeNative<string[]>('emulator_avds').then((l) => { setAvds(l ?? []); setAvd((l ?? [])[0] ?? ''); }).catch(() => undefined);
  }, []);

  const scan = useCallback(async () => {
    try { const d = (await invokeNative<Device[]>('adb_devices')) ?? []; setDevices(d); setSerial((s) => (d.some((x) => x.serial === s) ? s : d.find((x) => x.state === 'device')?.serial ?? '')); setErr(null); }
    catch (e) { setErr(typeof e === 'string' ? e : (e as Error).message); }
  }, []);
  useEffect(() => { void scan(); const t = setInterval(() => void scan(), 4000); return () => clearInterval(t); }, [scan]);

  // One screenshot at a time, about once a second.
  useEffect(() => {
    if (!serial) { setFrame(null); return; }
    let alive = true;
    let timer: number | undefined;
    const tick = async () => {
      try { const b64 = await invokeNative<string>('adb_screenshot', { serial }); if (alive && b64) { setFrame(`data:image/png;base64,${b64}`); setErr(null); } }
      catch (e) { if (alive) setErr(typeof e === 'string' ? e : (e as Error).message); }
      if (alive) timer = window.setTimeout(tick, 900);
    };
    void tick();
    return () => { alive = false; if (timer) window.clearTimeout(timer); };
  }, [serial]);

  const toDevice = (clientX: number, clientY: number) => {
    const el = img.current;
    if (!el || !el.naturalWidth) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(((clientX - r.left) / r.width) * el.naturalWidth), y: Math.round(((clientY - r.top) / r.height) * el.naturalHeight) };
  };
  const onUp = (e: React.PointerEvent) => {
    const d = down.current; down.current = null;
    const end = toDevice(e.clientX, e.clientY);
    if (!d || !end || !serial) return;
    const dist = Math.hypot(end.x - d.x, end.y - d.y);
    if (dist < 24) void invokeNative('adb_tap', { serial, x: end.x, y: end.y });
    else void invokeNative('adb_swipe', { serial, x1: d.x, y1: d.y, x2: end.x, y2: end.y, ms: Math.min(800, Math.max(120, Date.now() - d.t)) });
  };
  const key = (code: number) => { if (serial) void invokeNative('adb_key', { serial, code }); };

  if (paths && !paths.adb && !devices.length) {
    return (
      <div className="flex-1 min-h-0 p-6 overflow-y-auto">
        <Banner tone="info">Android tools were not found. Install Android Studio (it includes the SDK and the emulator) and Lotus will find them in <span className="font-mono">%LOCALAPPDATA%\Android\Sdk</span>. Then create a virtual device in Android Studio's Device Manager.</Banner>
        <p className="mt-3 text-[12px] text-[var(--color-text-muted)] leading-snug">A real phone also works: turn on Developer options and USB debugging, plug it in, and accept the prompt on the phone. iPhones cannot be shown here; Apple only allows iOS apps to run on a Mac.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 border-b border-[var(--sep)]">
        <Select aria-label="Android device" value={serial} onChange={(e) => setSerial(e.target.value)} className="!w-[220px]">
          {!devices.length && <option value="">No device connected</option>}
          {devices.map((d) => <option key={d.serial} value={d.serial} disabled={d.state !== 'device'}>{d.model || d.serial}{d.state !== 'device' ? ` (${d.state})` : ''}</option>)}
        </Select>
        <IconBtn label="Look for devices" onClick={() => void scan()}><RefreshCw className="w-3.5 h-3.5" /></IconBtn>
        {avds.length > 0 && paths?.emulator && (<>
          <Select aria-label="Virtual device to start" value={avd} onChange={(e) => setAvd(e.target.value)} className="!w-[170px]">{avds.map((a) => <option key={a}>{a}</option>)}</Select>
          <Btn size="sm" icon={<Play className="w-3 h-3" />} onClick={() => onRun(`"${paths.emulator}" -avd ${avd}`)} disabled={!avd}>Start emulator</Btn>
        </>)}
        <span className="flex-1" />
        <IconBtn label="Back" onClick={() => key(4)} disabled={!serial}><ChevronLeft className="w-4 h-4" /></IconBtn>
        <IconBtn label="Home" onClick={() => key(3)} disabled={!serial}><Circle className="w-3.5 h-3.5" /></IconBtn>
        <IconBtn label="Recent apps" onClick={() => key(187)} disabled={!serial}><Square className="w-3.5 h-3.5" /></IconBtn>
      </div>
      {err && <Banner tone="warn" className="m-3 mb-0">{err}</Banner>}
      <div className="flex-1 min-h-0 flex items-center justify-center p-4 bg-[var(--hover)]/40">
        {frame
          ? <img ref={img} src={frame} alt="Android screen (taps and swipes are sent to the device)" draggable={false} onPointerDown={(e) => { const p = toDevice(e.clientX, e.clientY); if (p) down.current = { ...p, t: Date.now() }; }} onPointerUp={onUp}
              className="max-h-full max-w-full rounded-[18px] shadow-[0_0_0_1px_var(--sep),0_8px_30px_rgba(0,0,0,.25)] cursor-pointer select-none touch-none" />
          : serial ? <Spinner className="w-5 h-5 text-[var(--color-accent-vibrant)]" /> : <p className="text-[13px] text-[var(--color-text-muted)] text-center max-w-xs leading-snug">Start an emulator or plug in a phone with USB debugging on. Install your app with "Install on connected phone" in the Build tab.</p>}
      </div>
    </div>
  );
};
