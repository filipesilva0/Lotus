-- Lotus account sync: run once in your Supabase project's SQL editor
-- (supabase.com → your project → SQL Editor → New query → paste → Run).
-- Works the same on a self-hosted Supabase.
--
-- One table of per-user key/value rows. Row-level security means each signed-in user
-- can only read and write their own rows; the public "anon" key alone sees nothing.

create table if not exists public.user_state (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  key        text        not null check (char_length(key) between 1 and 200),
  value      jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.user_state enable row level security;

drop policy if exists "own rows: select" on public.user_state;
drop policy if exists "own rows: insert" on public.user_state;
drop policy if exists "own rows: update" on public.user_state;
drop policy if exists "own rows: delete" on public.user_state;

create policy "own rows: select" on public.user_state for select using (auth.uid() = user_id);
create policy "own rows: insert" on public.user_state for insert with check (auth.uid() = user_id);
create policy "own rows: update" on public.user_state for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows: delete" on public.user_state for delete using (auth.uid() = user_id);

-- Keep single values reasonable (a profile picture is ~10 KB; chats can be split per key).
alter table public.user_state drop constraint if exists user_state_value_size;
alter table public.user_state add constraint user_state_value_size check (pg_column_size(value) <= 1048576);

create index if not exists user_state_updated on public.user_state (user_id, updated_at desc);
