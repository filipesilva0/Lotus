// Computer control (session 16): the agent can look at the screen and use the mouse and keyboard,
// like Claude's or ChatGPT's computer use. Off until the user turns it on in Settings → Tools, and
// every action that moves the mouse or types asks first unless the user chose "Never ask".
//
//   computer.screenshot   the main screen, scaled to at most 1280 px wide, sent to a vision model
//   computer.click        x, y in screenshot pixels (left/right, single/double)
//   computer.type         text into whatever has focus
//   computer.key          a key or shortcut: enter, tab, esc, ctrl+l, alt+tab, cmd+space…
//   computer.scroll       up/down at the current pointer
//
// Windows: PowerShell + user32 (no extra install). macOS: screencapture, sips and osascript
// (Lotus needs Screen Recording and Accessibility permission). Linux: xdotool and scrot/ImageMagick.

import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, rmSync } from 'node:fs';
import type { Tool, ToolCtx } from '../agent/types';
import { saveMedia } from '../media';

type Run = (cmd: string[], timeoutMs?: number) => Promise<{ ok: boolean; out: string; err: string }>;
export const sh: { run: Run } = {
  async run(cmd, timeoutMs = 15_000) {
    try {
      const p = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe', windowsHide: true } as Parameters<typeof Bun.spawn>[1]);
      const t = setTimeout(() => { try { p.kill(); } catch { /* gone */ } }, timeoutMs);
      const [out, err] = await Promise.all([new Response(p.stdout as ReadableStream).text(), new Response(p.stderr as ReadableStream).text()]);
      const code = await p.exited;
      clearTimeout(t);
      return { ok: code === 0, out, err };
    } catch (e) { return { ok: false, out: '', err: (e as Error).message }; }
  },
};

const ps = (script: string) => sh.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]);
const WIN_USER32 = `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class LotusU{[DllImport("user32.dll")]public static extern bool SetProcessDPIAware();[DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);[DllImport("user32.dll")]public static extern void mouse_event(uint f,int x,int y,int d,int e);[DllImport("user32.dll")]public static extern void keybd_event(byte k,byte s,uint f,int e);}';[LotusU]::SetProcessDPIAware()|Out-Null;`;

/** Screenshot pixels → screen coordinates, from the last screenshot. */
let scale = { x: 1, y: 1, w: 0, h: 0 };

export async function captureScreen(): Promise<{ png: Uint8Array; width: number; height: number }> {
  const os = platform();
  const file = join(tmpdir(), `lotus-shot-${Date.now()}.png`);
  try {
    if (os === 'win32') {
      const r = await ps(`${WIN_USER32}Add-Type -AssemblyName System.Windows.Forms,System.Drawing;$s=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds;$b=New-Object System.Drawing.Bitmap $s.Width,$s.Height;$g=[System.Drawing.Graphics]::FromImage($b);$g.CopyFromScreen($s.Location,[System.Drawing.Point]::Empty,$s.Size);$w=[Math]::Min(1280,$s.Width);$h=[int]($s.Height*$w/$s.Width);$o=New-Object System.Drawing.Bitmap $b,$w,$h;$o.Save('${file.replace(/'/g, "''")}',[System.Drawing.Imaging.ImageFormat]::Png);Write-Output "$($s.Width) $($s.Height) $w $h"`);
      if (!r.ok) throw new Error(`Couldn't take a screenshot: ${r.err.trim().split('\n')[0] || 'PowerShell failed'}`);
      const [sw, sh2, w, h] = r.out.trim().split(/\s+/).map(Number);
      scale = { x: sw / w, y: sh2 / h, w, h };
    } else if (os === 'darwin') {
      const r = await sh.run(['screencapture', '-x', '-t', 'png', file]);
      if (!r.ok) throw new Error('Couldn\'t take a screenshot. Allow Lotus in System Settings → Privacy & Security → Screen Recording.');
      const pts = await sh.run(['osascript', '-e', 'tell application "Finder" to get bounds of window of desktop']);
      const [, , pw, ph] = pts.out.split(',').map((v) => Number(v.trim()));
      await sh.run(['sips', '-Z', '1280', file]);
      const dims = await sh.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', file]);
      const w = Number(/pixelWidth: (\d+)/.exec(dims.out)?.[1] ?? 0), h = Number(/pixelHeight: (\d+)/.exec(dims.out)?.[1] ?? 0);
      scale = { x: pw && w ? pw / w : 1, y: ph && h ? ph / h : 1, w, h };
    } else {
      let r = await sh.run(['scrot', '-o', file]);
      if (!r.ok) r = await sh.run(['gnome-screenshot', '-f', file]);
      if (!r.ok) r = await sh.run(['import', '-window', 'root', file]);
      if (!r.ok) throw new Error('Couldn\'t take a screenshot. Install scrot (or ImageMagick) and xdotool.');
      const id = await sh.run(['identify', '-format', '%w %h', file]);
      const [sw, sh2] = id.out.trim().split(/\s+/).map(Number);
      if (sw > 1280 && (await sh.run(['convert', file, '-resize', '1280x', file])).ok) {
        const w = 1280, h = Math.round((sh2 * 1280) / sw);
        scale = { x: sw / w, y: sh2 / h, w, h };
      } else scale = { x: 1, y: 1, w: sw || 0, h: sh2 || 0 };
    }
    return { png: new Uint8Array(readFileSync(file)), width: scale.w, height: scale.h };
  } finally { try { rmSync(file, { force: true }); } catch { /* temp */ } }
}

const toScreen = (x: number, y: number) => ({ x: Math.round(x * scale.x), y: Math.round(y * scale.y) });

async function click(x: number, y: number, button: 'left' | 'right', double: boolean) {
  const p = toScreen(x, y);
  const os = platform();
  if (os === 'win32') {
    const [d, u] = button === 'right' ? [0x08, 0x10] : [0x02, 0x04];
    const once = `[LotusU]::mouse_event(${d},0,0,0,0);[LotusU]::mouse_event(${u},0,0,0,0);`;
    return ps(`${WIN_USER32}[LotusU]::SetCursorPos(${p.x},${p.y})|Out-Null;Start-Sleep -Milliseconds 40;${once}${double ? `Start-Sleep -Milliseconds 60;${once}` : ''}`);
  }
  if (os === 'darwin') {
    const down = button === 'right' ? '$.kCGEventRightMouseDown' : '$.kCGEventLeftMouseDown';
    const up = button === 'right' ? '$.kCGEventRightMouseUp' : '$.kCGEventLeftMouseUp';
    const btn = button === 'right' ? '$.kCGMouseButtonRight' : '$.kCGMouseButtonLeft';
    const js = `ObjC.import('CoreGraphics');var p=$.CGPointMake(${p.x},${p.y});$.CGEventPost($.kCGHIDEventTap,$.CGEventCreateMouseEvent(null,$.kCGEventMouseMoved,p,${btn}));for(var i=0;i<${double ? 2 : 1};i++){var d=$.CGEventCreateMouseEvent(null,${down},p,${btn});$.CGEventSetIntegerValueField(d,$.kCGMouseEventClickState,i+1);$.CGEventPost($.kCGHIDEventTap,d);var u=$.CGEventCreateMouseEvent(null,${up},p,${btn});$.CGEventSetIntegerValueField(u,$.kCGMouseEventClickState,i+1);$.CGEventPost($.kCGHIDEventTap,u);}`;
    return sh.run(['osascript', '-l', 'JavaScript', '-e', js]);
  }
  return sh.run(['xdotool', 'mousemove', String(p.x), String(p.y), 'click', ...(double ? ['--repeat', '2'] : []), button === 'right' ? '3' : '1']);
}

/** SendKeys needs these characters wrapped in braces. */
export const sendKeysEscape = (t: string) => t.replace(/[+^%~(){}[\]]/g, (c) => `{${c}}`).replace(/\r?\n/g, '{ENTER}');

async function typeText(text: string) {
  const os = platform();
  if (os === 'win32') return ps(`Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.SendKeys]::SendWait('${sendKeysEscape(text).replace(/'/g, "''")}')`);
  if (os === 'darwin') return sh.run(['osascript', '-e', `tell application "System Events" to keystroke ${JSON.stringify(text)}`]);
  return sh.run(['xdotool', 'type', '--delay', '12', '--', text]);
}

const WIN_KEYS: Record<string, string> = { enter: '{ENTER}', return: '{ENTER}', tab: '{TAB}', esc: '{ESC}', escape: '{ESC}', backspace: '{BACKSPACE}', delete: '{DELETE}', del: '{DELETE}', up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}', home: '{HOME}', end: '{END}', pageup: '{PGUP}', pagedown: '{PGDN}', space: ' ', f1: '{F1}', f2: '{F2}', f3: '{F3}', f4: '{F4}', f5: '{F5}', f11: '{F11}', f12: '{F12}' };
const MAC_CODES: Record<string, number> = { enter: 36, return: 36, tab: 48, esc: 53, escape: 53, backspace: 51, delete: 117, up: 126, down: 125, left: 123, right: 124, home: 115, end: 119, pageup: 116, pagedown: 121, space: 49, f5: 96 };
const X_KEYS: Record<string, string> = { enter: 'Return', return: 'Return', esc: 'Escape', escape: 'Escape', backspace: 'BackSpace', del: 'Delete', pageup: 'Page_Up', pagedown: 'Page_Down', cmd: 'super', win: 'super' };

/** "ctrl+shift+t" → Windows SendKeys "^+t" (the Windows key is sent separately). */
export function toSendKeys(combo: string): { keys: string; win: boolean } {
  const parts = combo.toLowerCase().split('+').map((x) => x.trim()).filter(Boolean);
  let mods = '', win = false;
  const key = parts.pop() ?? '';
  for (const m of parts) { if (m === 'ctrl' || m === 'control') mods += '^'; else if (m === 'shift') mods += '+'; else if (m === 'alt' || m === 'option') mods += '%'; else if (m === 'win' || m === 'cmd' || m === 'meta' || m === 'super') win = true; }
  const k = WIN_KEYS[key] ?? (key.length === 1 ? sendKeysEscape(key) : `{${key.toUpperCase()}}`);
  return { keys: mods + k, win };
}

async function pressKey(combo: string) {
  const os = platform();
  if (os === 'win32') {
    const { keys, win } = toSendKeys(combo);
    if (win) {
      const rest = keys === '{}' ? '' : keys;
      return ps(`${WIN_USER32}[LotusU]::keybd_event(0x5B,0,0,0);Add-Type -AssemblyName System.Windows.Forms;${rest ? `[System.Windows.Forms.SendKeys]::SendWait('${rest.replace(/'/g, "''")}');` : ''}[LotusU]::keybd_event(0x5B,0,2,0)`);
    }
    return ps(`Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.SendKeys]::SendWait('${keys.replace(/'/g, "''")}')`);
  }
  const parts = combo.toLowerCase().split('+').map((x) => x.trim());
  const key = parts.pop() ?? '';
  if (os === 'darwin') {
    const using = parts.map((m) => ({ cmd: 'command down', command: 'command down', meta: 'command down', ctrl: 'control down', control: 'control down', alt: 'option down', option: 'option down', shift: 'shift down' } as Record<string, string>)[m]).filter(Boolean);
    const u = using.length ? ` using {${using.join(', ')}}` : '';
    const body = MAC_CODES[key] !== undefined ? `key code ${MAC_CODES[key]}${u}` : `keystroke ${JSON.stringify(key)}${u}`;
    return sh.run(['osascript', '-e', `tell application "System Events" to ${body}`]);
  }
  return sh.run(['xdotool', 'key', [...parts.map((m) => X_KEYS[m] ?? m), X_KEYS[key] ?? key].join('+')]);
}

async function scroll(amount: number) {
  const os = platform();
  if (os === 'win32') return ps(`${WIN_USER32}[LotusU]::mouse_event(0x0800,0,0,${-120 * amount},0)`);
  if (os === 'darwin') return sh.run(['osascript', '-l', 'JavaScript', '-e', `ObjC.import('CoreGraphics');$.CGEventPost($.kCGHIDEventTap,$.CGEventCreateScrollWheelEvent(null,0,1,${-amount * 3}))`]);
  return sh.run(['xdotool', 'click', '--repeat', String(Math.abs(amount)), amount > 0 ? '5' : '4']);
}

const failed = (what: string, r: { err: string }) => ({ ok: false, text: `${what} failed: ${r.err.trim().split('\n')[0] || 'the system refused it'}${platform() === 'darwin' ? ' (Lotus needs Accessibility permission in System Settings → Privacy & Security).' : platform() === 'linux' ? ' (needs xdotool).' : ''}`, summary: `${what} failed` });

async function shotResult(ctx: ToolCtx, label: string) {
  const s = await captureScreen();
  const row = await saveMedia(ctx.db, ctx.studio, s.png.buffer as ArrayBuffer, 'image/png', `screen ${label}`);
  return { ok: true, text: `Screenshot taken (${s.width}×${s.height}); it is attached for you to look at. Use these pixel coordinates with computer.click.`, summary: `Screenshot · ${s.width}×${s.height}`, media: [row.path], data: { imageB64: Buffer.from(s.png).toString('base64'), width: s.width, height: s.height } };
}

const needShot = () => (scale.w ? null : { ok: false, text: 'Take a computer.screenshot first so you know where things are.', summary: 'No screenshot yet' });

export const computerScreenshot: Tool = {
  name: 'computer.screenshot', label: 'Looking at the screen', risk: 'read',
  description: 'See the user\'s main screen. Take one before clicking, and again after actions to check what happened. Needs a model that can see images.',
  parameters: { type: 'object', properties: {} },
  run: (_a, ctx) => shotResult(ctx, 'now'),
};

export const computerClick: Tool = {
  name: 'computer.click', label: 'Clicking', risk: 'risky',
  description: 'Click at a point on the screen, in pixels of the latest screenshot.',
  parameters: { type: 'object', properties: {
    x: { type: 'integer', description: 'Pixels from the left of the screenshot.' },
    y: { type: 'integer', description: 'Pixels from the top of the screenshot.' },
    button: { type: 'string', description: 'left (default) or right.', enum: ['left', 'right'] },
    double: { type: 'boolean', description: 'Double-click.' },
  }, required: ['x', 'y'] },
  describe: (a) => `${a.double ? 'Double-click' : a.button === 'right' ? 'Right-click' : 'Click'} at ${a.x}, ${a.y} on your screen`,
  async run(a) {
    const no = needShot(); if (no) return no;
    const x = Number(a.x), y = Number(a.y);
    if (!(x >= 0 && y >= 0 && x <= scale.w && y <= scale.h)) return { ok: false, text: `That point is outside the ${scale.w}×${scale.h} screenshot.`, summary: 'Outside the screen' };
    const r = await click(x, y, a.button === 'right' ? 'right' : 'left', a.double === true);
    if (!r.ok) return failed('Click', r);
    await Bun.sleep(350);
    return { ok: true, text: `Clicked at ${x}, ${y}. Take a screenshot to see the result.`, summary: `${a.double ? 'Double-clicked' : 'Clicked'} at ${x}, ${y}` };
  },
};

export const computerType: Tool = {
  name: 'computer.type', label: 'Typing', risk: 'risky',
  description: 'Type text into whatever has keyboard focus on the user\'s computer.',
  parameters: { type: 'object', properties: { text: { type: 'string', description: 'What to type.' } }, required: ['text'] },
  describe: (a) => `Type “${String(a.text).slice(0, 80)}” on your computer`,
  async run(a) {
    const text = String(a.text ?? '');
    if (!text) return { ok: false, text: 'Nothing to type.', summary: 'Empty' };
    const r = await typeText(text.slice(0, 4000));
    return r.ok ? { ok: true, text: `Typed ${text.length} characters.`, summary: `Typed “${text.slice(0, 40)}”` } : failed('Typing', r);
  },
};

export const computerKey: Tool = {
  name: 'computer.key', label: 'Pressing keys', risk: 'risky',
  description: 'Press a key or shortcut on the user\'s computer, e.g. enter, tab, esc, ctrl+l, alt+tab, cmd+space, win.',
  parameters: { type: 'object', properties: { keys: { type: 'string', description: 'Key or combination joined with +.' } }, required: ['keys'] },
  describe: (a) => `Press ${String(a.keys)} on your computer`,
  async run(a) {
    const keys = String(a.keys ?? '').trim();
    if (!keys) return { ok: false, text: 'Which key?', summary: 'No key' };
    const r = await pressKey(keys);
    await Bun.sleep(250);
    return r.ok ? { ok: true, text: `Pressed ${keys}.`, summary: `Pressed ${keys}` } : failed('Key press', r);
  },
};

export const computerScroll: Tool = {
  name: 'computer.scroll', label: 'Scrolling', risk: 'risky',
  description: 'Scroll where the mouse pointer is. Positive scrolls down, negative up (3 is about a third of a page).',
  parameters: { type: 'object', properties: { amount: { type: 'integer', description: 'Notches; positive is down.' } }, required: ['amount'] },
  describe: (a) => `Scroll ${Number(a.amount) > 0 ? 'down' : 'up'} on your screen`,
  async run(a) {
    const n = Math.max(-20, Math.min(20, Math.round(Number(a.amount) || 0)));
    if (!n) return { ok: false, text: 'amount must not be 0.', summary: 'No scroll' };
    const r = await scroll(n);
    return r.ok ? { ok: true, text: `Scrolled ${n > 0 ? 'down' : 'up'} ${Math.abs(n)}.`, summary: `Scrolled ${n > 0 ? 'down' : 'up'}` } : failed('Scroll', r);
  },
};

export const COMPUTER_TOOLS: Tool[] = [computerScreenshot, computerClick, computerType, computerKey, computerScroll];
