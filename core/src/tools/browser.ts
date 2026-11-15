// Browser control (session 16): the agent drives its own Google Chrome window through the Chrome
// DevTools Protocol. It uses a separate Chrome profile in Lotus Studio/Work/.browser, so it never
// sees the user's own tabs, passwords or cookies; anything signed in there was signed in by the user
// in that window. Falls back to Microsoft Edge or Chromium when Chrome isn't installed.
//
//   browser.open        go to a URL (starts the window when needed)
//   browser.read        the page as text, with numbered buttons, links and fields
//   browser.click       click a numbered element (asks first by default)
//   browser.type        type into a numbered field, optionally press Enter (asks first by default)
//   browser.screenshot  what the page looks like, for a vision model
//   browser.back / browser.scroll

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { platform } from 'node:os';
import type { Tool, ToolCtx } from '../agent/types';
import { saveMedia } from '../media';

const PORT = 9333;

export function chromeCandidates(os = platform(), env = process.env): string[] {
  if (os === 'win32') {
    const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter(Boolean) as string[];
    return [
      ...roots.map((r) => join(r, 'Google', 'Chrome', 'Application', 'chrome.exe')),
      ...roots.map((r) => join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
    ];
  }
  if (os === 'darwin') return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/microsoft-edge'];
}

class Cdp {
  private ws: WebSocket | null = null;
  private seq = 0;
  private wait = new Map<number, { ok: (v: any) => void; fail: (e: Error) => void }>();
  private proc: ReturnType<typeof Bun.spawn> | null = null;

  async ensure(studio: string): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    let ok = await this.ping();
    if (!ok) {
      const exe = chromeCandidates().find((p) => existsSync(p));
      if (!exe) throw new Error('Google Chrome (or Edge/Chromium) was not found on this computer. Install Chrome to let Lotus use the browser.');
      const profile = join(studio, 'Work', '.browser');
      mkdirSync(profile, { recursive: true });
      this.proc = Bun.spawn([exe, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--new-window', 'about:blank'], { stdout: 'ignore', stderr: 'ignore' });
      for (let i = 0; i < 40 && !ok; i++) { await Bun.sleep(250); ok = await this.ping(); }
      if (!ok) throw new Error('Chrome started but did not open its control port. Close any Chrome window Lotus opened before and try again.');
    }
    const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string; url: string }[];
    let page = list.find((t) => t.type === 'page');
    if (!page) page = (await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json()) as { type: string; webSocketDebuggerUrl: string; url: string };
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(page!.webSocketDebuggerUrl);
      ws.onopen = () => { this.ws = ws; resolve(); };
      ws.onerror = () => reject(new Error('Could not connect to Chrome.'));
      ws.onclose = () => { this.ws = null; for (const w of this.wait.values()) w.fail(new Error('The browser window was closed.')); this.wait.clear(); };
      ws.onmessage = (m) => {
        const msg = JSON.parse(String(m.data));
        const w = msg.id !== undefined ? this.wait.get(msg.id) : undefined;
        if (!w) return;
        this.wait.delete(msg.id);
        if (msg.error) w.fail(new Error(msg.error.message)); else w.ok(msg.result);
      };
    });
    await this.send('Page.enable');
    await this.send('Page.bringToFront').catch(() => undefined);
  }

  private async ping() {
    try { return (await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; }
  }

  send<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const ws = this.ws;
    if (!ws) return Promise.reject(new Error('The browser is not open.'));
    const id = ++this.seq;
    return new Promise<T>((ok, fail) => {
      const t = setTimeout(() => { this.wait.delete(id); fail(new Error(`The browser did not answer (${method}).`)); }, 30_000);
      this.wait.set(id, { ok: (v) => { clearTimeout(t); ok(v); }, fail: (e) => { clearTimeout(t); fail(e); } });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval<T = any>(expression: string): Promise<T> {
    const r = await this.send<{ result: { value: T }; exceptionDetails?: { text: string } }>('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }

  async settle(ms = 15_000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { if ((await this.eval<string>('document.readyState')) === 'complete') break; } catch { /* navigating */ }
      await Bun.sleep(250);
    }
    await Bun.sleep(400);
  }
}

export const cdp = new Cdp();

/** Runs in the page: numbers visible interactive elements and returns the page as text. */
export const READ_SCRIPT = `(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none'; };
  document.querySelectorAll('[data-lotus-id]').forEach((e) => e.removeAttribute('data-lotus-id'));
  const els = [...document.querySelectorAll('a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[contenteditable=true],summary')].filter(vis).slice(0, 150);
  const items = els.map((e, i) => {
    e.setAttribute('data-lotus-id', String(i + 1));
    const tag = e.tagName.toLowerCase();
    const type = tag === 'input' ? '(' + (e.type || 'text') + ')' : '';
    const label = (e.getAttribute('aria-label') || e.innerText || e.value || e.placeholder || e.title || e.alt || e.name || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
    return '[' + (i + 1) + '] ' + (tag === 'a' ? 'link' : tag) + type + ' ' + JSON.stringify(label);
  });
  const text = (document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n').trim().slice(0, 7000);
  return { title: document.title, url: location.href, text, items };
})()`;

async function readPage() {
  const r = await cdp.eval<{ title: string; url: string; text: string; items: string[] }>(READ_SCRIPT);
  return { ...r, out: `Page: ${r.title}\nURL: ${r.url}\n\n${r.text}\n\nThings you can click or type in (use the number):\n${r.items.join('\n') || '(none)'}` };
}

const fail = (e: unknown) => ({ ok: false, text: (e as Error).message || String(e), summary: (e as Error).message?.slice(0, 80) || 'Browser error' });

async function center(id: number): Promise<{ x: number; y: number } | null> {
  return cdp.eval(`(() => { const e = document.querySelector('[data-lotus-id="${id}"]'); if (!e) return null; e.scrollIntoView({ block: 'center', inline: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
}

export const browserOpen: Tool = {
  name: 'browser.open', label: 'Opening a web page', risk: 'read',
  description: 'Open a web page in Lotus\'s own Chrome window (separate from the user\'s Chrome) and read it. Use for sites that need clicking or typing; for simple lookups prefer web.search / web.read.',
  parameters: { type: 'object', properties: { url: { type: 'string', description: 'Full address, e.g. https://example.com' } }, required: ['url'] },
  describe: (a) => `Open ${String(a.url)} in Lotus's browser`,
  async run(a, ctx) {
    let url = String(a.url ?? '').trim();
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    try {
      await cdp.ensure(ctx.studio);
      await cdp.send('Page.navigate', { url });
      await cdp.settle();
      const p = await readPage();
      return { ok: true, text: p.out, summary: `Opened ${p.title || p.url}`, data: { url: p.url } };
    } catch (e) { return fail(e); }
  },
};

export const browserRead: Tool = {
  name: 'browser.read', label: 'Reading the page', risk: 'read',
  description: 'Read the page open in Lotus\'s browser again (after it changed), with numbered buttons, links and fields.',
  parameters: { type: 'object', properties: {} },
  async run(_a, ctx) {
    try { await cdp.ensure(ctx.studio); const p = await readPage(); return { ok: true, text: p.out, summary: `Read ${p.title || p.url}` }; } catch (e) { return fail(e); }
  },
};

export const browserClick: Tool = {
  name: 'browser.click', label: 'Clicking in the browser', risk: 'risky',
  description: 'Click a numbered element from the latest browser.read / browser.open.',
  parameters: { type: 'object', properties: { id: { type: 'integer', description: 'The element number.' } }, required: ['id'] },
  describe: (a) => `Click element ${a.id} on the page in Lotus's browser`,
  async run(a, ctx) {
    try {
      await cdp.ensure(ctx.studio);
      const c = await center(Number(a.id));
      if (!c) return { ok: false, text: `There is no element ${a.id}. Call browser.read to number the page again.`, summary: 'Element not found' };
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: c.x, y: c.y, button: 'left', clickCount: 1 });
      await Bun.sleep(600);
      await cdp.settle(8000);
      const p = await readPage();
      return { ok: true, text: `Clicked ${a.id}.\n\n${p.out}`, summary: `Clicked element ${a.id}` };
    } catch (e) { return fail(e); }
  },
};

export const browserType: Tool = {
  name: 'browser.type', label: 'Typing in the browser', risk: 'risky',
  description: 'Type into a numbered field from the latest browser.read. Set submit to press Enter afterwards.',
  parameters: { type: 'object', properties: {
    id: { type: 'integer', description: 'The field number.' },
    text: { type: 'string', description: 'What to type.' },
    submit: { type: 'boolean', description: 'Press Enter after typing.' },
  }, required: ['id', 'text'] },
  describe: (a) => `Type “${String(a.text).slice(0, 60)}” into field ${a.id}${a.submit ? ' and press Enter' : ''}`,
  async run(a, ctx) {
    try {
      await cdp.ensure(ctx.studio);
      const found = await cdp.eval<boolean>(`(() => { const e = document.querySelector('[data-lotus-id="${Number(a.id)}"]'); if (!e) return false; e.scrollIntoView({ block: 'center' }); e.focus(); if ('value' in e) { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); } return true; })()`);
      if (!found) return { ok: false, text: `There is no field ${a.id}. Call browser.read first.`, summary: 'Field not found' };
      await cdp.send('Input.insertText', { text: String(a.text ?? '') });
      if (a.submit) {
        for (const type of ['keyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: type === 'keyDown' ? '\r' : undefined });
        await Bun.sleep(600);
        await cdp.settle(10_000);
      }
      const p = await readPage();
      return { ok: true, text: `Typed into ${a.id}.\n\n${p.out}`, summary: `Typed into field ${a.id}${a.submit ? ' and pressed Enter' : ''}` };
    } catch (e) { return fail(e); }
  },
};

export const browserScreenshot: Tool = {
  name: 'browser.screenshot', label: 'Looking at the page', risk: 'read',
  description: 'See what the page in Lotus\'s browser looks like (needs a model that can see images).',
  parameters: { type: 'object', properties: {} },
  async run(_a, ctx: ToolCtx) {
    try {
      await cdp.ensure(ctx.studio);
      const r = await cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
      const buf = Buffer.from(r.data, 'base64');
      const row = await saveMedia(ctx.db, ctx.studio, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, 'image/png', 'browser');
      return { ok: true, text: 'Screenshot of the page attached. Use browser.read for element numbers to click.', summary: 'Page screenshot', media: [row.path], data: { imageB64: r.data } };
    } catch (e) { return fail(e); }
  },
};

export const browserBack: Tool = {
  name: 'browser.back', label: 'Going back', risk: 'read',
  description: 'Go back one page in Lotus\'s browser.',
  parameters: { type: 'object', properties: {} },
  async run(_a, ctx) {
    try { await cdp.ensure(ctx.studio); await cdp.eval('history.back()'); await Bun.sleep(500); await cdp.settle(8000); const p = await readPage(); return { ok: true, text: p.out, summary: `Back to ${p.title || p.url}` }; } catch (e) { return fail(e); }
  },
};

export const browserScroll: Tool = {
  name: 'browser.scroll', label: 'Scrolling the page', risk: 'read',
  description: 'Scroll the page in Lotus\'s browser. Positive is down, in screens (1 = one screen).',
  parameters: { type: 'object', properties: { screens: { type: 'number', description: 'How far; negative scrolls up.' } }, required: ['screens'] },
  async run(a, ctx) {
    try { await cdp.ensure(ctx.studio); await cdp.eval(`window.scrollBy(0, innerHeight * ${Number(a.screens) || 1})`); await Bun.sleep(300); const p = await readPage(); return { ok: true, text: p.out, summary: `Scrolled ${Number(a.screens) > 0 ? 'down' : 'up'}` }; } catch (e) { return fail(e); }
  },
};

export const BROWSER_TOOLS: Tool[] = [browserOpen, browserRead, browserClick, browserType, browserScreenshot, browserBack, browserScroll];
