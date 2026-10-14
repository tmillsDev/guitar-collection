-- Per-pair totals bucketed by hour, so the site can rank by recent periods
-- (last 24 hours, last 7 days) without downloading every vote.
create view public.vote_tallies_hourly with (security_invoker = true) as
  select category, winner, loser, date_trunc('hour', created_at) as hour, count(*)::int as n
  from public.votes
  group by category, winner, loser, date_trunc('hour', created_at);

grant select on public.vote_tallies_hourly to anon, authenticated;
