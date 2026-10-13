-- One row per head-to-head vote. No user identity is stored.
create table public.votes (
  id bigint generated always as identity primary key,
  category text not null check (category in (
    'looks',
    'clean-neck', 'clean-middle', 'clean-bridge',
    'dirt-neck', 'dirt-middle', 'dirt-bridge'
  )),
  winner text not null check (winner ~ '^[A-Za-z0-9-]{1,40}$'),
  loser text not null check (loser ~ '^[A-Za-z0-9-]{1,40}$'),
  created_at timestamptz not null default now(),
  check (winner <> loser)
);

alter table public.votes enable row level security;

-- Anyone visiting the site can cast and read votes; nobody can edit or delete them.
create policy "Anyone can vote" on public.votes
  for insert to anon, authenticated with check (true);
create policy "Anyone can read votes" on public.votes
  for select to anon, authenticated using (true);

grant insert, select on public.votes to anon, authenticated;

-- Per-pair totals, which is all the site needs to compute rankings.
create view public.vote_tallies with (security_invoker = true) as
  select category, winner, loser, count(*)::int as n
  from public.votes
  group by category, winner, loser;

grant select on public.vote_tallies to anon, authenticated;
