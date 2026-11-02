// Starter projects. Files are plain text (icons are base64) and written by Lotus itself, so creating a
// project needs no internet and no tools. Installing packages and building need the tools listed in `needs`.

import { TargetId } from './types';

export interface TemplateFile { path: string; content: string; base64?: boolean }

export interface ProjectAction {
  id: string;
  label: string;
  command: string;
  /** Keeps running (a dev server); its address is detected and shown in the preview. */
  server?: boolean;
  needs: string[];
  note?: string;
}

export interface Template {
  id: TargetId;
  title: string;
  blurb: string;
  /** What this project can become. */
  platforms: string[];
  /** Built-in preview folder (static server). Empty string = project root. null = no static preview. */
  previewDir: string | null;
  /** Show the preview in a phone-shaped frame. */
  phone: boolean;
  actions: ProjectAction[];
  /** Short guidance given to the agent. */
  agentNotes: string;
  files: TemplateFile[];
}

const gitignoreNode = 'node_modules\ndist\n.DS_Store\n';

const WEBSITE: Template = {
  id: 'website', title: 'Website', platforms: ['Web'], previewDir: '', phone: false,
  blurb: 'Plain HTML, CSS and JavaScript. Nothing to install: the preview runs straight away and reloads when you save.',
  actions: [],
  agentNotes: 'Static website: index.html, style.css, script.js in the project root. There is no build step and no package manager. Link extra pages and assets with relative paths. The preview serves the project folder and reloads on every save.',
  files: [
    { path: 'index.html', content: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>__NAME__</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main>
    <h1>__NAME__</h1>
    <p>Your site is running. Ask the agent to change it, or edit the files yourself.</p>
    <button id="hello">Say hello</button>
    <p id="out" aria-live="polite"></p>
  </main>
  <script src="script.js"></script>
</body>
</html>
` },
    { path: 'style.css', content: `:root { color-scheme: light dark; --accent: #6d4aff; }
* { box-sizing: border-box; }
body { margin: 0; font: 16px/1.5 system-ui, sans-serif; display: grid; min-height: 100vh; place-items: center; }
main { max-width: 36rem; padding: 2rem; text-align: center; }
h1 { font-size: 2.2rem; margin: 0 0 .5rem; }
button { font: inherit; padding: .55rem 1.1rem; border: 0; border-radius: 8px; background: var(--accent); color: #fff; cursor: pointer; }
button:focus-visible { outline: 3px solid color-mix(in srgb, var(--accent) 40%, transparent); outline-offset: 2px; }
` },
    { path: 'script.js', content: `document.getElementById('hello').addEventListener('click', () => {
  document.getElementById('out').textContent = 'Hello from __NAME__!';
});
` },
  ],
};

const WEBAPP: Template = {
  id: 'webapp', title: 'Web app (React)', platforms: ['Web'], previewDir: null, phone: false,
  blurb: 'React with Vite: components, hot reload, a production build. Needs Node.js.',
  actions: [
    { id: 'install', label: 'Install packages', command: 'npm install', needs: ['node', 'npm'] },
    { id: 'dev', label: 'Start dev server', command: 'npm run dev -- --host 127.0.0.1', server: true, needs: ['node', 'npm'], note: 'Run "Install packages" first.' },
    { id: 'build', label: 'Build for production', command: 'npm run build', needs: ['node', 'npm'], note: 'Output goes to the dist folder; upload it to any web host.' },
  ],
  agentNotes: 'React 18 + Vite project (JavaScript, JSX). Source is in src/. Packages are installed with npm. Start the dev server with <start_server>npm run dev -- --host 127.0.0.1</start_server> (it reloads by itself) and run npm install first if node_modules is missing or package.json changed.',
  files: [
    { path: 'package.json', content: `{
  "name": "__SLUG__",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build", "preview": "vite preview" },
  "dependencies": { "react": "^18.3.1", "react-dom": "^18.3.1" },
  "devDependencies": { "@vitejs/plugin-react": "^4.3.4", "vite": "^5.4.11" }
}
` },
    { path: 'vite.config.js', content: `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({ plugins: [react()] });
` },
    { path: 'index.html', content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>__NAME__</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
` },
    { path: 'src/main.jsx', content: `import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(<App />);
` },
    { path: 'src/App.jsx', content: `import { useState } from 'react';

export default function App() {
  const [count, setCount] = useState(0);
  return (
    <main>
      <h1>__NAME__</h1>
      <p>Edit <code>src/App.jsx</code> or ask the agent to change it.</p>
      <button onClick={() => setCount((c) => c + 1)}>Clicked {count} times</button>
    </main>
  );
}
` },
    { path: 'src/styles.css', content: `:root { color-scheme: light dark; --accent: #6d4aff; }
body { margin: 0; font: 16px/1.5 system-ui, sans-serif; display: grid; min-height: 100vh; place-items: center; }
main { max-width: 36rem; padding: 2rem; text-align: center; }
button { font: inherit; padding: .55rem 1.1rem; border: 0; border-radius: 8px; background: var(--accent); color: #fff; cursor: pointer; }
` },
    { path: '.gitignore', content: gitignoreNode },
  ],
};

const PWA: Template = {
  id: 'pwa', title: 'Mobile web app (PWA)', platforms: ['Android', 'iOS', 'Web'], previewDir: '', phone: true,
  blurb: 'A phone-first web app that installs to the home screen on Android and iPhone. No tools needed; previewed in a phone frame.',
  actions: [],
  agentNotes: 'Installable progressive web app, designed for a phone screen first: index.html, style.css, app.js, manifest.webmanifest, sw.js (service worker for offline). No build step. Keep touch targets at least 44px, respect safe areas, and keep the layout single-column. It is previewed in a phone-shaped frame and reloads on every save. To publish, host the folder on any HTTPS site; users then use "Add to Home Screen".',
  files: [
    { path: 'index.html', content: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#6d4aff">
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="icon" href="icon.svg" type="image/svg+xml">
  <title>__NAME__</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header><h1>__NAME__</h1></header>
  <main>
    <p>Tap the button. This page works offline once installed.</p>
    <button id="tap">Tap me</button>
    <p id="count" aria-live="polite">0 taps</p>
  </main>
  <script src="app.js"></script>
</body>
</html>
` },
    { path: 'style.css', content: `:root { color-scheme: light dark; --accent: #6d4aff; }
* { box-sizing: border-box; }
body { margin: 0; font: 17px/1.45 system-ui, sans-serif; min-height: 100vh; padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
header { padding: 1rem 1.25rem; background: var(--accent); color: #fff; }
h1 { margin: 0; font-size: 1.25rem; }
main { padding: 1.25rem; }
button { font: inherit; min-height: 44px; padding: 0 1.4rem; border: 0; border-radius: 12px; background: var(--accent); color: #fff; }
` },
    { path: 'app.js', content: `let taps = 0;
document.getElementById('tap').addEventListener('click', () => {
  taps += 1;
  document.getElementById('count').textContent = taps + (taps === 1 ? ' tap' : ' taps');
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
` },
    { path: 'manifest.webmanifest', content: `{
  "name": "__NAME__",
  "short_name": "__NAME__",
  "start_url": ".",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#6d4aff",
  "icons": [{ "src": "icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any" }]
}
` },
    { path: 'sw.js', content: `const CACHE = '__SLUG__-v1';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icon.svg'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))));
self.addEventListener('fetch', (e) => e.respondWith(fetch(e.request).catch(() => caches.match(e.request))));
` },
    { path: 'icon.svg', content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#6d4aff"/><circle cx="50" cy="50" r="18" fill="#fff"/></svg>
` },
  ],
};

const TAURI_WORKFLOW = `name: Build desktop apps
on:
  workflow_dispatch:
  push:
    tags: ['v*']
jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: windows-latest
            args: ''
          - os: macos-latest
            args: '--target universal-apple-darwin'
          - os: ubuntu-22.04
            args: ''
    runs-on: \${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: \${{ matrix.os == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}
      - name: Linux packages
        if: matrix.os == 'ubuntu-22.04'
        run: sudo apt-get update && sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
      - run: npm install
      - run: npx tauri build \${{ matrix.args }}
      - uses: actions/upload-artifact@v4
        with:
          name: app-\${{ matrix.os }}
          path: src-tauri/target/**/release/bundle/**
`;

const DESKTOP: Template = {
  id: 'desktop', title: 'Desktop app (Tauri)', platforms: ['Windows', 'macOS', 'Linux'], previewDir: 'www', phone: false,
  blurb: 'A small native app with a web interface. The preview shows the interface; "Run as app" opens the real window. Windows builds locally; macOS and Linux build on GitHub (workflow included).',
  actions: [
    { id: 'install', label: 'Install packages', command: 'npm install', needs: ['node', 'npm'] },
    { id: 'dev', label: 'Run as app (opens a window)', command: 'npm run tauri dev', server: false, needs: ['node', 'npm', 'cargo', 'rustc'], note: 'The first run compiles Rust and takes several minutes.' },
    { id: 'build', label: 'Build installer (this computer)', command: 'npm run tauri build', needs: ['node', 'npm', 'cargo', 'rustc'], note: 'On Windows this makes an .exe and .msi under src-tauri/target/release/bundle. A Mac app can only be built on a Mac or on GitHub.' },
  ],
  agentNotes: 'Tauri 2 desktop app. The interface is plain HTML/CSS/JS in www/ (no bundler), shown in the preview; the Rust shell is in src-tauri/ and rarely needs changes. To call Rust from the page, add a #[tauri::command] in src-tauri/src/main.rs, register it in generate_handler!, and set "withGlobalTauri": true under "app" in src-tauri/tauri.conf.json so the page can use window.__TAURI__.core.invoke. Windows builds happen on this computer; macOS and Linux builds happen through .github/workflows/build.yml on GitHub.',
  files: [
    { path: 'package.json', content: `{
  "name": "__SLUG__",
  "private": true,
  "version": "0.1.0",
  "scripts": { "tauri": "tauri" },
  "devDependencies": { "@tauri-apps/cli": "^2" }
}
` },
    { path: 'www/index.html', content: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>__NAME__</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main>
    <h1>__NAME__</h1>
    <p>Your desktop app is running. Ask the agent to build something.</p>
    <button id="go">Click me</button>
    <p id="out" aria-live="polite"></p>
  </main>
  <script src="main.js"></script>
</body>
</html>
` },
    { path: 'www/style.css', content: `:root { color-scheme: light dark; --accent: #6d4aff; }
* { box-sizing: border-box; }
body { margin: 0; font: 15px/1.5 system-ui, sans-serif; display: grid; min-height: 100vh; place-items: center; }
main { padding: 2rem; text-align: center; }
button { font: inherit; padding: .5rem 1rem; border: 0; border-radius: 8px; background: var(--accent); color: #fff; cursor: pointer; }
` },
    { path: 'www/main.js', content: `document.getElementById('go').addEventListener('click', () => {
  document.getElementById('out').textContent = 'It works.';
});
` },
    { path: 'src-tauri/Cargo.toml', content: `[package]
name = "__SLUG__"
version = "0.1.0"
edition = "2021"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
` },
    { path: 'src-tauri/build.rs', content: `fn main() {\n    tauri_build::build()\n}\n` },
    { path: 'src-tauri/src/main.rs', content: `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
` },
    { path: 'src-tauri/tauri.conf.json', content: `{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "__NAME__",
  "version": "0.1.0",
  "identifier": "com.example.__SLUG__",
  "build": { "frontendDist": "../www" },
  "app": {
    "windows": [{ "label": "main", "title": "__NAME__", "width": 900, "height": 640 }],
    "security": { "csp": null }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/icon.ico"]
  }
}
` },
    { path: 'src-tauri/capabilities/default.json', content: `{
  "identifier": "default",
  "windows": ["main"],
  "permissions": ["core:default"]
}
` },
    { path: 'src-tauri/icons/32x32.png', base64: true, content: '__ICON32__' },
    { path: 'src-tauri/icons/128x128.png', base64: true, content: '__ICON128__' },
    { path: 'src-tauri/icons/icon.ico', base64: true, content: '__ICOICO__' },
    { path: '.github/workflows/build.yml', content: TAURI_WORKFLOW },
    { path: '.gitignore', content: gitignoreNode + 'src-tauri/target\nsrc-tauri/gen\n' },
  ],
};

const MOBILE_WORKFLOW = `name: Build mobile apps
on:
  workflow_dispatch:
jobs:
  android:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: 17 }
      - run: npm install
      - run: '[ -d android ] || npx cap add android'
      - run: npx cap sync android
      - run: cd android && chmod +x gradlew && ./gradlew assembleDebug
      - uses: actions/upload-artifact@v4
        with:
          name: android-debug-apk
          path: android/app/build/outputs/apk/debug/*.apk
  ios:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm install
      - run: '[ -d ios ] || npx cap add ios'
      - run: npx cap sync ios
      - run: xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator -configuration Debug -derivedDataPath build CODE_SIGNING_ALLOWED=NO build
      - uses: actions/upload-artifact@v4
        with:
          name: ios-simulator-app
          path: build/Build/Products/Debug-iphonesimulator/App.app
`;

const MOBILE: Template = {
  id: 'mobile', title: 'Phone app (Android & iOS)', platforms: ['Android', 'iOS'], previewDir: 'www', phone: true,
  blurb: 'A web interface packaged as a real Android and iPhone app with Capacitor. Preview it here in a phone frame; build the Android app on this computer; the iPhone app builds on GitHub\u2019s Macs (Apple does not allow it on Windows).',
  actions: [
    { id: 'install', label: 'Install packages', command: 'npm install', needs: ['node', 'npm'] },
    { id: 'add-android', label: 'Add Android project', command: 'npx cap add android', needs: ['node', 'npm'], note: 'Once. Creates the android folder.' },
    { id: 'apk', label: 'Build Android app (debug APK)', command: 'npx cap sync android && cd android && gradlew.bat assembleDebug', needs: ['node', 'npm', 'java'], note: 'Needs the Android SDK (Android Studio). APK: android/app/build/outputs/apk/debug/app-debug.apk' },
    { id: 'install-apk', label: 'Install on connected phone or emulator', command: 'adb install -r android/app/build/outputs/apk/debug/app-debug.apk', needs: ['adb'] },
  ],
  agentNotes: 'Capacitor project: the app\u2019s interface is plain HTML/CSS/JS in www/ (no bundler) and is previewed in a phone-shaped frame. Design for a phone screen first (single column, touch targets of 44px or more, safe areas). Capacitor plugins are added with npm install @capacitor/<name> and then npx cap sync. Android builds happen on this computer (needs the Android SDK and Java); the iPhone app can only be built on a Mac, so .github/workflows/build.yml builds it on GitHub.',
  files: [
    { path: 'package.json', content: `{
  "name": "__SLUG__",
  "private": true,
  "version": "0.1.0",
  "dependencies": {
    "@capacitor/android": "^6.1.2",
    "@capacitor/core": "^6.1.2",
    "@capacitor/ios": "^6.1.2"
  },
  "devDependencies": { "@capacitor/cli": "^6.1.2" }
}
` },
    { path: 'capacitor.config.json', content: `{
  "appId": "com.example.__SLUG__",
  "appName": "__NAME__",
  "webDir": "www"
}
` },
    { path: 'www/index.html', content: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>__NAME__</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header><h1>__NAME__</h1></header>
  <main>
    <p>Your phone app is running.</p>
    <button id="tap">Tap me</button>
    <p id="count" aria-live="polite">0 taps</p>
  </main>
  <script src="app.js"></script>
</body>
</html>
` },
    { path: 'www/style.css', content: `:root { color-scheme: light dark; --accent: #6d4aff; }
* { box-sizing: border-box; }
body { margin: 0; font: 17px/1.45 system-ui, sans-serif; min-height: 100vh; padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
header { padding: 1rem 1.25rem; background: var(--accent); color: #fff; }
h1 { margin: 0; font-size: 1.25rem; }
main { padding: 1.25rem; }
button { font: inherit; min-height: 44px; padding: 0 1.4rem; border: 0; border-radius: 12px; background: var(--accent); color: #fff; }
` },
    { path: 'www/app.js', content: `let taps = 0;
document.getElementById('tap').addEventListener('click', () => {
  taps += 1;
  document.getElementById('count').textContent = taps + (taps === 1 ? ' tap' : ' taps');
});
` },
    { path: '.github/workflows/build.yml', content: MOBILE_WORKFLOW },
    { path: '.gitignore', content: gitignoreNode + 'android/build\nandroid/app/build\nios/App/Pods\n' },
  ],
};

const BLANK: Template = {
  id: 'blank', title: 'Empty project', platforms: ['Anything'], previewDir: '', phone: false,
  blurb: 'An empty folder. Tell the agent what to build (any language), and use the terminal for the rest.',
  actions: [],
  agentNotes: 'Empty project. Decide the stack from the request, say what you chose, and create the files. If the result is a web page, put an index.html in the project root so the preview can show it.',
  files: [{ path: 'README.md', content: '# __NAME__\n\nDescribe what you want to build in the agent panel.\n' }],
};

export const TEMPLATES: Template[] = [WEBSITE, WEBAPP, PWA, DESKTOP, MOBILE, BLANK];
export const templateFor = (id: TargetId) => TEMPLATES.find((t) => t.id === id) ?? BLANK;

export const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'app';

const ICONS: Record<string, string> = { __ICON32__: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAnUlEQVR42tVXyQ3AIAxj0I7SFdmFDShIPEqlqjkIdi1Z4mdDQo6U/ojzqLmxNNbBfs7RonfBLxaU8FojDuGJUHGTidXiKhNR4iITzoTzJ+YG8fdX0N7+CfcrWIWtRkwGpFAbGLV9q4Gpd0jir4UqD1be3hQGBgPwEGCTEP4NWQoRthTDmxFFO4YPJBQjGcVQSjGWUywmFKsZzXIahQuEux1BwomsNgAAAABJRU5ErkJggg==', __ICON128__: 'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAClklEQVR42u3dO47DMAyE4Rx0j7KXTOEiTS6QC7gI4M22+wDysB2R8w3AzpXmp0RLMn04EBERERF11OfHcrzF5RbLnfH97NHI1TN6esDkZ2My0mNl9vLmMFPsbPppANP/ixOHtjN+qRQcq7OmqxkGNP7cwPifceZsjaJO0WiNVyMwHgjMB8F2xs+M/xWzrBcL88XS0fiJsaEbSA8ew4ofx9KKPTFXNf/KvNXiKvPFbM0Xl9HNV+0nvx0wJ3ifgDHBEDAkGAIVf/ibAROCZwEGBENg4MMhMOjBABjwYAhCrm67ci77zQJ/mX82yMFfIBnc4FnASV/4iaFBDZ8FOgzKvQJAI/NfFQgKArCVIgEYvCfPbuYXheAUk/17K2YWYH5tCNrv+79brc8HmN8DgpYAjCYABJs/OgTt9v4BsMPZAPPDZwHm94IAAAAAAAAKA1BNpQEYcQcQADvuCI7Y5QMAO3YXYX74MgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgBwAbAWHbwU7DEo+DLIMhB8HuxDiQggAAAAAAIAg+lq4D0OamP900ygAhGa/j0NbZX9PAHwevg8AGkQUN//lBtJaxJQ2P6NHkCZR2wKgTVxB41drE6dRZFnzczuFahWrX7Bm0bqFaxfvhxF+GGEWkP1+GpUW2/00yiwQnP1+HBmw728WkP0gYD4AAAAC5oOA+fcCMDPibTEfRhAjQrMfBMwHAfOdGLY46VsRgguTBujy4c1Axf9uCK5MWy2uh4oyEwRmvpogcM33dhBY7dsnCHzPBwHzFYeKPbOBrAcB84HAeFfOR766XRyEjl8gnTmbuYE0cTKwRuDYdiCM3LPoxKG8olFRF1YzWNOLzhSPHEtfZDYRERERtdUXOB5z7RP6gf0AAAAASUVORK5CYII=', __ICOICO__: 'AAABAAEAICAAAAEAIACoEAAAFgAAACgAAAAgAAAAQAAAAAEAIAAAAAAAgBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/XHz//1x8//9cfP//XHz//1x8//9cfP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8/wAAAAAAAAAAAAAAAAAAAAAAAAAA/1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz///////////////////////9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8/wAAAAAAAAAAAAAAAAAAAAD/XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz/////////////////////////////////////////////XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz/AAAAAAAAAAAAAAAAAAAAAP9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8////////////////////////////////////////////////////////XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP8AAAAAAAAAAAAAAAD/XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz///////////////////////////////////////////////////////9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP8AAAAAAAAAAP9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//////////////////////////////////////////////////////////////////9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8/wAAAAAAAAAA/1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//////////////////////////////////////////////////////////////////1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz/AAAAAAAAAAD/XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//////////////////////////////////////////////////////////////////XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP8AAAAAAAAAAP9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//////////////////////////////////////////////////////////////////9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8/wAAAAAAAAAA/1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8////////////////////////////////////////////////////////XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz/AAAAAAAAAAAAAAAA/1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz///////////////////////////////////////////////////////9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8/wAAAAAAAAAAAAAAAAAAAAD/XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz/////////////////////////////////////////////XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz/AAAAAAAAAAAAAAAAAAAAAP9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8////////////////////////XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP8AAAAAAAAAAAAAAAAAAAAAAAAAAP9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8//9cfP//XHz//1x8/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/1x8//9cfP//XHz//1x8//9cfP//XHz/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };

/** The template's files with the project name filled in. */
export function renderTemplate(t: Template, name: string): TemplateFile[] {
  const slug = slugify(name);
  const safe = name.replace(/[<>&"]/g, '');
  return t.files.map((f) => {
    if (f.base64) return { ...f, content: ICONS[f.content] ?? '' };
    return { ...f, content: f.content.split('__NAME__').join(safe).split('__SLUG__').join(slug) };
  });
}
