-- Run after prizes.sql. Everything is rolled back.
begin;
do $$
declare
  a text := 'prize-test-install-aaaaaaaaaaaa';
  b text := 'prize-test-install-bbbbbbbbbbbb';
  ha text := darbna_private.check_install(a);
  hb text := darbna_private.check_install(b);
  j json;
  code10 text;
begin
  -- New driver: level 1, nothing won, next prize at level 10.
  j := public.darbna_prizes(a);
  if (j->>'level')::int <> 1 or json_array_length(j->'wins') <> 0 or (j->>'nextMilestone')::int <> 10 then raise exception 'fresh: %', j; end if;

  -- Level 9 (5500 points): still nothing.
  perform darbna_private.add_points(ha, 5500);
  j := public.darbna_prizes(a);
  if (j->>'level')::int <> 9 or json_array_length(j->'wins') <> 0 then raise exception 'level 9: %', j; end if;

  -- Level 10 (6500): one win with a code; asking again returns the same single win.
  perform darbna_private.add_points(ha, 1000);
  j := public.darbna_prizes(a);
  if (j->>'level')::int <> 10 or json_array_length(j->'wins') <> 1 then raise exception 'level 10: %', j; end if;
  code10 := j->'wins'->0->>'code';
  if code10 !~ '^DRB-[A-Z2-9]{4}-[A-Z2-9]{4}$' then raise exception 'bad code %', code10; end if;
  j := public.darbna_prizes(a);
  if json_array_length(j->'wins') <> 1 or j->'wins'->0->>'code' <> code10 then raise exception 'not idempotent: %', j; end if;
  if (j->>'nextMilestone')::int <> 20 then raise exception 'next: %', j; end if;

  -- Jump to level 30: wins for 20 and 30 are added; 10 keeps its code.
  perform darbna_private.add_points(ha, 20000);
  j := public.darbna_prizes(a);
  if json_array_length(j->'wins') <> 3 or j->'wins'->0->>'code' <> code10 or (j->'wins'->2->>'milestone')::int <> 30 then raise exception 'level 30: %', j; end if;

  -- Points dropping later (reversed reports) doesn't take a won prize back.
  update darbna_private.points set points = 100 where who = ha;
  j := public.darbna_prizes(a);
  if json_array_length(j->'wins') <> 3 then raise exception 'wins lost: %', j; end if;

  -- Another driver sees only their own wins.
  j := public.darbna_prizes(b);
  if json_array_length(j->'wins') <> 0 then raise exception 'leak: %', j; end if;

  -- Banned drivers win nothing new.
  insert into darbna_private.banned_reporters (reporter_hash, reason) values (hb, 'test') on conflict do nothing;
  perform darbna_private.add_points(hb, 7000);
  j := public.darbna_prizes(b);
  if json_array_length(j->'wins') <> 0 then raise exception 'banned won: %', j; end if;

  -- Owner marks delivered; the app only ever sees won/delivered/rejected.
  perform darbna_private.set_prize_status(lower(code10), 'delivered', 'test');
  j := public.darbna_prizes(a);
  if j->'wins'->0->>'status' <> 'delivered' then raise exception 'status: %', j; end if;
  if (j::text) like '%test%' then raise exception 'owner note leaked'; end if;

  -- The app role can't read the table or call owner functions.
  if has_table_privilege('anon', 'darbna_private.prize_wins', 'select') then raise exception 'anon can read wins'; end if;
  if has_function_privilege('anon', 'darbna_private.set_prize_status(text,text,text)', 'execute') then raise exception 'anon can set status'; end if;
  if not has_function_privilege('anon', 'public.darbna_prizes(text)', 'execute') then raise exception 'anon cannot read own prizes'; end if;

  -- Delete my data removes the wins.
  perform public.darbna_delete_me(a);
  if exists (select 1 from darbna_private.prize_wins where who = ha) then raise exception 'wins survived deletion'; end if;
end $$;
select 'PASS: milestones every 10 levels, one stable code per milestone, catch-up, no take-backs, isolation, bans, owner status, privileges, deletion; all fixtures rolled back';
rollback;
