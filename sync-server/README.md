# Lotus sync server

Lotus accounts (the profile button at the bottom of the sidebar) need a small server that stores
sign-ins and each user's synced data. Lotus speaks the standard **Supabase** APIs, so you can use:

- **Supabase cloud** (free tier is plenty to start): https://supabase.com
- **Self-hosted Supabase** (Docker) on your own machine, e.g. next to PhysioPulse.

## Set up (about 5 minutes)
1. Create a project at supabase.com (pick a region close to you, set a database password).
2. Open **SQL Editor → New query**, paste `schema.sql` from this folder, press **Run**.
3. Open **Project Settings → API**. Copy the **Project URL** and the **anon public** key.
4. In Lotus: profile button → **Log in** → **Set up sync server**, paste both, Save.
5. Create an account. If email confirmation is on (Supabase default), click the link in the email, then sign in.
   For a private server you can turn confirmation off in **Authentication → Providers → Email**.

To ship Lotus with a built-in server for everyone, set `VITE_LOTUS_SYNC_URL` and
`VITE_LOTUS_SYNC_KEY` at build time (e.g. as CI secrets); users then just see "Log in".

## What is stored
`auth.users` (email, hashed password, display name) and the `user_state` table: one row per
`(user, key)` with a JSON value. Row-level security limits every row to its owner.
Today only `profile.avatar` is synced; settings, chats, skills and tasks can be added with
`syncPut` / `syncList` from `src/services/sync.ts`.

## Not done yet
- Sign in with Google/GitHub (needs an OAuth redirect back into the app via a deep link).
- Password reset from inside the app (use the Supabase dashboard meanwhile).
- Tokens are kept in the WebView's localStorage, like the rest of Lotus's data; moving them to
  Windows Credential Manager would need the `keyring` crate.
