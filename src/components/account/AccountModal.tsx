import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Banner, Btn, Label, TextInput } from '../common/ui';
import { Avatar } from './Avatar';
import {
  AccountError, getServer, imageToAvatar, setServer, signIn, signOut, signUp, updateProfile, useAccount,
} from '../../services/account';
import { openExternal } from '../../lib/open';

export type AccountView = 'signin' | 'signup' | 'profile' | 'server';

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const host = (url: string) => { try { return new URL(url).host; } catch { return url; } };

/** Sign in, create an account, edit the profile, or point Lotus at a sync server. */
export const AccountModal: React.FC<{ open: boolean; view: AccountView; onView: (v: AccountView) => void; onClose: () => void }> = ({ open, view, onView, onClose }) => {
  const account = useAccount();
  const server = getServer();
  const title = { signin: 'Sign in to Lotus', signup: 'Create a Lotus account', profile: 'Your profile', server: 'Sync server' }[view];
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {view === 'server' && <ServerForm onDone={() => onView(account.kind === 'signed-in' ? 'profile' : 'signin')} />}
      {view === 'signin' && (server ? <SignInForm onSignUp={() => onView('signup')} onServer={() => onView('server')} onDone={onClose} /> : <NoServer onSetUp={() => onView('server')} />)}
      {view === 'signup' && (server ? <SignUpForm onSignIn={() => onView('signin')} onDone={onClose} /> : <NoServer onSetUp={() => onView('server')} />)}
      {view === 'profile' && (account.kind === 'signed-in' ? <ProfileForm onSignedOut={onClose} /> : <SignInForm onSignUp={() => onView('signup')} onServer={() => onView('server')} onDone={onClose} />)}
    </Modal>
  );
};

const NoServer: React.FC<{ onSetUp: () => void }> = ({ onSetUp }) => (
  <div className="flex flex-col gap-3 text-[13px]">
    <p className="text-[var(--color-text-main)] leading-relaxed">
      A Lotus account keeps your studio in sync between PCs. Accounts live on a sync server, and none is set up yet.
    </p>
    <p className="text-[var(--color-text-muted)] leading-relaxed">
      You can use a free Supabase project or host one yourself. Everything else in Lotus keeps working without an account.
    </p>
    <div className="flex justify-end"><Btn variant="primary" onClick={onSetUp}>Set up sync server</Btn></div>
  </div>
);

const ServerLine: React.FC<{ onChange: () => void }> = ({ onChange }) => {
  const s = getServer();
  if (!s) return null;
  return (
    <p className="text-[12px] text-[var(--color-text-muted)]">
      Sync server: {host(s.url)} · <button type="button" onClick={onChange} className="text-[var(--color-accent-vibrant)] hover:underline">Change</button>
    </p>
  );
};

const SignInForm: React.FC<{ onSignUp: () => void; onServer: () => void; onDone: () => void }> = ({ onSignUp, onServer, onDone }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await signIn(email, password); onDone(); } catch (err) { setError(msg(err)); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {error && <Banner tone="error">{error}</Banner>}
      <div><Label>Email</Label><TextInput ref={first} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div><Label>Password</Label><TextInput type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
      <div className="flex items-center justify-between gap-2 pt-1">
        <button type="button" onClick={onSignUp} className="text-[13px] text-[var(--color-accent-vibrant)] hover:underline">Create an account</button>
        <Btn variant="primary" type="submit" loading={busy} disabled={!email || !password}>Sign in</Btn>
      </div>
      <ServerLine onChange={onServer} />
    </form>
  );
};

const SignUpForm: React.FC<{ onSignIn: () => void; onDone: () => void }> = ({ onSignIn, onDone }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await signUp(email, password, name);
      if (r === 'confirm-email') setSent(true); else onDone();
    } catch (err) { setError(msg(err)); } finally { setBusy(false); }
  };
  if (sent) {
    return (
      <div className="flex flex-col gap-3 text-[13px]">
        <Banner tone="info">We sent a confirmation link to {email}. Open it, then come back and sign in.</Banner>
        <div className="flex justify-end"><Btn variant="primary" onClick={onSignIn}>Go to sign in</Btn></div>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {error && <Banner tone="error">{error}</Banner>}
      <div><Label>Name</Label><TextInput autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
      <div><Label>Email</Label><TextInput type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div><Label hint="At least 8 characters">Password</Label><TextInput type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} /></div>
      <div className="flex items-center justify-between gap-2 pt-1">
        <button type="button" onClick={onSignIn} className="text-[13px] text-[var(--color-accent-vibrant)] hover:underline">I already have an account</button>
        <Btn variant="primary" type="submit" loading={busy} disabled={!name || !email || password.length < 8}>Create account</Btn>
      </div>
    </form>
  );
};

const ProfileForm: React.FC<{ onSignedOut: () => void }> = ({ onSignedOut }) => {
  const account = useAccount();
  const user = account.kind === 'signed-in' ? account.user : null;
  const [name, setName] = useState(user?.name ?? '');
  const [busy, setBusy] = useState<'' | 'name' | 'pic' | 'out'>('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  if (!user) return null;

  const run = async (kind: 'name' | 'pic' | 'out', fn: () => Promise<void>) => {
    setBusy(kind); setError(''); setSaved(false);
    try { await fn(); if (kind === 'name') setSaved(true); } catch (e) { setError(msg(e)); } finally { setBusy(''); }
  };
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) void run('pic', async () => updateProfile({ avatar: await imageToAvatar(f) }));
  };

  return (
    <div className="flex flex-col gap-4">
      {error && <Banner tone="error">{error}</Banner>}
      <div className="flex items-center gap-4">
        <Avatar user={user} size={64} />
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-2">
            <Btn size="sm" onClick={() => file.current?.click()} loading={busy === 'pic'}>Change picture</Btn>
            {user.avatar && <Btn size="sm" variant="ghost" onClick={() => void run('pic', () => updateProfile({ avatar: null }))} disabled={!!busy}>Remove</Btn>}
          </div>
          <span className="text-[12px] text-[var(--color-text-muted)]">{user.email}</span>
        </div>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={pick} aria-label="Choose a profile picture" />
      </div>
      <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void run('name', () => updateProfile({ name })); }}>
        <div className="flex-1"><Label hint={saved ? 'Saved' : undefined}>Name</Label><TextInput value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} required /></div>
        <Btn type="submit" loading={busy === 'name'} disabled={!name.trim() || name.trim() === user.name}>Save</Btn>
      </form>
      <div className="flex items-center justify-between pt-2 border-t border-[var(--sep)]">
        <ServerLine onChange={() => undefined} />
        <Btn className="ml-auto" variant="danger" loading={busy === 'out'} onClick={() => void run('out', async () => { await signOut(); onSignedOut(); })}>Log out</Btn>
      </div>
    </div>
  );
};

const ServerForm: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const cur = getServer();
  const account = useAccount();
  const [url, setUrl] = useState(cur?.url ?? '');
  const [key, setKey] = useState(cur?.anonKey ?? '');
  const [error, setError] = useState('');
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const u = new URL(url.trim());
      if (u.protocol !== 'https:' && !/^(127\.0\.0\.1|localhost)$/.test(u.hostname)) throw new Error('Use an https:// address (plain http is only allowed for a server on this PC).');
    } catch (err) { setError(err instanceof TypeError ? 'That is not a valid web address.' : msg(err)); return; }
    if (account.kind === 'signed-in' && cur && cur.url !== url.trim().replace(/\/+$/, '')) void signOut();
    setServer({ url, anonKey: key });
    onDone();
  };
  return (
    <form onSubmit={save} className="flex flex-col gap-3 text-[13px]">
      {error && <Banner tone="error">{error}</Banner>}
      <ol className="list-decimal pl-5 flex flex-col gap-1 text-[var(--color-text-main)] leading-relaxed">
        <li>Create a free project at supabase.com (or run Supabase on your own server).</li>
        <li>In its SQL Editor, run <code className="text-[12px]">sync-server/schema.sql</code> from the Lotus source.</li>
        <li>From Project Settings → API, copy the Project URL and the anon public key here.</li>
      </ol>
      <div>
        <Btn size="sm" variant="ghost" icon={<ExternalLink className="w-3.5 h-3.5" />} type="button" onClick={() => void openExternal('https://supabase.com/dashboard/projects')}>Open supabase.com</Btn>
      </div>
      <div><Label>Project URL</Label><TextInput placeholder="https://abcd1234.supabase.co" value={url} onChange={(e) => setUrl(e.target.value)} required autoFocus /></div>
      <div><Label>Public (anon) key</Label><TextInput placeholder="eyJhbGciOi…" value={key} onChange={(e) => setKey(e.target.value)} required spellCheck={false} /></div>
      <p className="text-[12px] text-[var(--color-text-muted)]">The public key is safe to share; each person can only reach their own data.</p>
      <div className="flex justify-between gap-2 pt-1">
        {cur ? <Btn type="button" variant="danger" onClick={() => { void signOut(); setServer(null); setUrl(''); setKey(''); }}>Remove server</Btn> : <span />}
        <Btn variant="primary" type="submit" disabled={!url.trim() || !key.trim()}>Save</Btn>
      </div>
    </form>
  );
};
