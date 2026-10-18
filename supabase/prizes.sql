-- Milestone prizes: every 10 levels (level 10, 20, 30 …) a driver wins a prize.
-- Apply after schema.sql, rewards.sql, report-integrity.sql and review-moderation.sql. Safe to run again.
--
-- How it works
--  * Levels come from the same helper points the app shows (darbna_private.points.points):
--    +2 when another driver confirms your report, +2 for each report you confirm.
--  * When a driver reaches a new tens level, darbna_prizes() records ONE win for that milestone with
--    a random claim code (e.g. DRB-7K2Q-9MXA). The app only says "you won a prize — contact support"
--    and shows the code; it never says what the prize is.
--  * The owner decides and delivers the prize (phone top-up, voucher, free oil change, cash …)
--    after the driver contacts support with the code. Nothing is sent automatically.
--  * Deleting your data (darbna_delete_me) deletes your wins too (trigger on points).
--
-- Owner, in Supabase → SQL Editor (never exposed to the app):
--   select * from darbna_private.prize_wins where code = 'DRB-XXXX-XXXX';      -- check a claim
--   select darbna_private.set_prize_status('DRB-XXXX-XXXX', 'delivered', 'Asia top-up 10,000 IQD');
--   select * from darbna_private.prize_wins order by created_at desc;          -- all wins
begin;

create table if not exists darbna_private.prize_wins (
  code text primary key,
  who text not null,
  milestone int not null check (milestone >= 10 and milestone % 10 = 0),
  points_at_win int not null,
  status text not null default 'won' check (status in ('won', 'contacted', 'delivered', 'rejected')),
  owner_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (who, milestone)
);
alter table darbna_private.prize_wins enable row level security;
revoke all on darbna_private.prize_wins from public, anon, authenticated;

-- Same curve as levelFor() in packages/core/src/extras.ts: 50 points per level, so level 10 = 450 points.
create or replace function darbna_private.prize_level(p bigint) returns int
language sql immutable as $$
  select (1 + greatest(p, 0) / 50)::int;
$$;

-- Readable claim code without look-alike characters (no 0/O, 1/I/L).
create or replace function darbna_private.prize_code() returns text
language plpgsql volatile security definer set search_path = darbna_private, extensions, public as $$
declare
  abc constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  b bytea := extensions.gen_random_bytes(8);
  s text := '';
begin
  for i in 0..7 loop
    s := s || substr(abc, 1 + (get_byte(b, i) % length(abc)), 1);
    if i = 3 then s := s || '-'; end if;
  end loop;
  return 'DRB-' || s;
end $$;

-- Your level, the next prize milestone and every prize you've won (records new wins).
create or replace function public.darbna_prizes(install text)
returns json language plpgsql volatile security definer set search_path = darbna_private, extensions, public as $$
declare
  h text := darbna_private.check_install(install);
  pts int;
  lvl int;
  m int;
  c text;
begin
  select coalesce(p.points, 0) into pts from darbna_private.points p where p.who = h;
  pts := coalesce(pts, 0);
  lvl := darbna_private.prize_level(pts);
  -- Banned reporters keep their history but win nothing new.
  if not exists (select 1 from darbna_private.banned_reporters b where b.reporter_hash = h) then
    m := 10;
    while m <= lvl loop
      if not exists (select 1 from darbna_private.prize_wins w where w.who = h and w.milestone = m) then
        loop
          c := darbna_private.prize_code();
          begin
            insert into darbna_private.prize_wins (code, who, milestone, points_at_win) values (c, h, m, pts);
            exit;
          exception when unique_violation then
            -- Same code drawn twice (astronomically rare) → new code; same milestone raced → done.
            exit when exists (select 1 from darbna_private.prize_wins w where w.who = h and w.milestone = m);
          end;
        end loop;
      end if;
      m := m + 10;
    end loop;
  end if;
  return json_build_object(
    'points', pts, 'level', lvl, 'nextMilestone', (lvl / 10 + 1) * 10,
    'wins', coalesce((select json_agg(json_build_object(
        'milestone', w.milestone, 'code', w.code,
        'status', case when w.status = 'rejected' then 'rejected' when w.status = 'delivered' then 'delivered' else 'won' end,
        'at', to_char(w.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      order by w.milestone) from darbna_private.prize_wins w where w.who = h), '[]'::json));
end $$;

-- Owner only (not granted to the app): move a claim along after checking it.
create or replace function darbna_private.set_prize_status(claim text, next_status text, note text default null)
returns darbna_private.prize_wins language plpgsql volatile security definer set search_path = darbna_private, extensions, public as $$
declare w darbna_private.prize_wins;
begin
  if next_status not in ('won', 'contacted', 'delivered', 'rejected') then raise exception 'bad_status'; end if;
  update darbna_private.prize_wins set status = next_status, owner_note = coalesce(note, owner_note), updated_at = now()
    where code = upper(trim(claim)) returning * into w;
  if not found then raise exception 'no_such_code'; end if;
  return w;
end $$;

-- "Delete my data" removes the points row → remove that driver's wins too.
create or replace function darbna_private.delete_prize_wins() returns trigger
language plpgsql security definer set search_path = darbna_private, extensions, public as $$
begin
  delete from darbna_private.prize_wins where who = old.who;
  return old;
end $$;
drop trigger if exists delete_prize_wins on darbna_private.points;
create trigger delete_prize_wins after delete on darbna_private.points
  for each row execute function darbna_private.delete_prize_wins();

revoke all on function darbna_private.prize_code() from public, anon, authenticated;
revoke all on function darbna_private.set_prize_status(text, text, text) from public, anon, authenticated;
revoke all on function public.darbna_prizes(text) from public;
grant execute on function public.darbna_prizes(text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
