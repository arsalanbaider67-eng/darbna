-- Darbna shared community reports on Supabase.
-- Paste this whole file into Supabase → SQL Editor → New query → Run. Safe to run again.
--
-- Design
--  * Tables live in the private schema "darbna_private", which the public API can't see.
--    Apps can only call the four functions at the bottom (darbna_reports, darbna_create_report,
--    darbna_vote, darbna_delete_me), so every rule below is enforced by the database itself.
--  * Privacy: the app sends a random per-install id; only a salted hash of it is stored.
--    The caller's IP is also stored only as a salted hash, used for rate limits and erased after a day.
--  * Rules mirror the Darbna server (packages/core/src/reports.ts):
--      lifetimes per category, duplicates merged into a confirmation, "gone" votes hide a report,
--      3 flags hide it for moderation, rate limits per install, per IP and overall.
--  * Moderation: Supabase → Table Editor → schema "darbna_private" → reports.
--      Set status to 'removed' to delete a report for everyone, or 'active' to restore a hidden one.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists darbna_private;
revoke all on schema darbna_private from public, anon, authenticated;

create table if not exists darbna_private.settings (k text primary key, v text not null);
insert into darbna_private.settings (k, v)
  values ('salt', encode(extensions.gen_random_bytes(32), 'hex'))
  on conflict (k) do nothing;

create table if not exists darbna_private.categories (
  category text primary key,
  ttl_initial_min int not null,
  ttl_max_min int not null,
  duplicate_radius_m int not null
);
insert into darbna_private.categories values
  ('congestion',   30,   120, 250),
  ('crash',        60,   180, 150),
  ('closure',     360,  2880, 120),
  ('roadworks',  4320, 20160, 150),
  ('pothole',   20160, 86400,  40),
  ('flooding',    360,  1440, 150)
on conflict (category) do update set
  ttl_initial_min = excluded.ttl_initial_min, ttl_max_min = excluded.ttl_max_min,
  duplicate_radius_m = excluded.duplicate_radius_m;

create table if not exists darbna_private.reports (
  id uuid primary key default gen_random_uuid(),
  category text not null references darbna_private.categories(category),
  -- Iraq plus a small margin.
  lat double precision not null check (lat between 28.9 and 37.5),
  lng double precision not null check (lng between 38.7 and 48.9),
  heading real check (heading is null or (heading >= 0 and heading < 360)),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'hidden', 'removed')),
  hidden_reason text,
  confirms int not null default 0,
  gone int not null default 0,
  flags int not null default 0,
  reporter_hash text,
  ip_hash text
);
create index if not exists reports_live on darbna_private.reports (lat, lng) where status = 'active';
create index if not exists reports_by_reporter on darbna_private.reports (reporter_hash, created_at);
create index if not exists reports_by_ip on darbna_private.reports (ip_hash, created_at);

create table if not exists darbna_private.votes (
  report_id uuid not null references darbna_private.reports(id) on delete cascade,
  voter_hash text not null,
  vote text not null check (vote in ('confirm', 'gone', 'flag')),
  created_at timestamptz not null default now(),
  primary key (report_id, voter_hash)
);
create index if not exists votes_by_voter on darbna_private.votes (voter_hash, created_at);

alter table darbna_private.settings enable row level security;
alter table darbna_private.categories enable row level security;
alter table darbna_private.reports enable row level security;
alter table darbna_private.votes enable row level security;

-- ------------------------------------------------------------------ helpers (private)
create or replace function darbna_private.hash(v text) returns text
language sql stable security definer set search_path = darbna_private, extensions, public as $$
  select encode(extensions.digest(v || (select s.v from darbna_private.settings s where s.k = 'salt'), 'sha256'), 'hex');
$$;

create or replace function darbna_private.client_ip_hash() returns text
language plpgsql stable security definer set search_path = darbna_private, extensions, public as $$
declare h json; ip text;
begin
  begin h := current_setting('request.headers', true)::json; exception when others then h := null; end;
  ip := coalesce(h->>'cf-connecting-ip', split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1), '');
  return case when trim(ip) = '' then null else darbna_private.hash('ip:' || trim(ip)) end;
end $$;

create or replace function darbna_private.check_install(install text) returns text
language plpgsql stable security definer set search_path = darbna_private, extensions, public as $$
begin
  if install is null or length(install) < 16 or length(install) > 100 then
    raise exception 'bad_install' using errcode = 'P0001';
  end if;
  return darbna_private.hash('install:' || install);
end $$;

create or replace function darbna_private.distance_m(lat1 float8, lng1 float8, lat2 float8, lng2 float8) returns float8
language sql immutable as $$
  select 2 * 6371008.8 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)));
$$;

create or replace function darbna_private.to_public(r darbna_private.reports) returns json
language sql stable as $$
  select json_build_object(
    'id', r.id, 'category', r.category, 'source', 'community', 'verified', false,
    'coord', json_build_array(r.lng, r.lat), 'heading', r.heading,
    'createdAt', to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expiresAt', to_char(r.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'confirms', r.confirms, 'gone', r.gone, 'isSample', false);
$$;

-- ------------------------------------------------------------------ public API (what the app calls)

-- Active reports in a map area (at most ~2° across), newest first.
create or replace function public.darbna_reports(min_lng float8, min_lat float8, max_lng float8, max_lat float8)
returns json language plpgsql stable security definer set search_path = darbna_private, extensions, public as $$
begin
  if max_lng - min_lng > 2.05 or max_lat - min_lat > 2.05 or max_lng < min_lng or max_lat < min_lat then
    raise exception 'area_too_large' using errcode = 'P0001';
  end if;
  return json_build_object(
    'reports', coalesce((
      select json_agg(darbna_private.to_public(r) order by r.created_at desc)
      from (select * from darbna_private.reports
            where status = 'active' and expires_at > now()
              and lat between min_lat and max_lat and lng between min_lng and max_lng
            order by created_at desc limit 400) r), '[]'::json),
    'serverTime', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $$;

-- Vote on a report: 'confirm' (still there), 'gone' (not there any more) or 'flag' (abusive/fake).
create or replace function public.darbna_vote(install text, report_id uuid, vote text)
returns json language plpgsql volatile security definer set search_path = darbna_private, extensions, public as $$
#variable_conflict use_variable
declare
  voter text := darbna_private.check_install(install);
  r darbna_private.reports;
  c darbna_private.categories;
  n int;
begin
  if vote not in ('confirm', 'gone', 'flag') then raise exception 'bad_vote' using errcode = 'P0001'; end if;
  select count(*) into n from darbna_private.votes where voter_hash = voter and created_at > now() - interval '1 hour';
  if n >= 60 then raise exception 'rate_limited' using errcode = 'P0001'; end if;

  select * into r from darbna_private.reports
    where id = report_id and status = 'active' and expires_at > now() for update;
  if not found then raise exception 'report_not_active' using errcode = 'P0001'; end if;
  if r.reporter_hash = voter then raise exception 'own_report' using errcode = 'P0001'; end if;
  begin
    insert into darbna_private.votes (report_id, voter_hash, vote) values (r.id, voter, vote);
  exception when unique_violation then
    raise exception 'already_voted' using errcode = 'P0001';
  end;

  select * into c from darbna_private.categories where category = r.category;
  if vote = 'confirm' then
    r.confirms := r.confirms + 1;
    -- Reset the clock from now, never beyond the category's maximum lifetime.
    r.expires_at := greatest(r.expires_at, least(now() + make_interval(mins => c.ttl_initial_min),
                                                 r.created_at + make_interval(mins => c.ttl_max_min)));
  elsif vote = 'gone' then
    r.gone := r.gone + 1;
  else
    r.flags := r.flags + 1;
  end if;
  if r.gone >= 2 and r.gone >= r.confirms + 2 then r.status := 'hidden'; r.hidden_reason := 'gone_votes'; end if;
  if r.flags >= 3 then r.status := 'hidden'; r.hidden_reason := 'flags'; end if;

  update darbna_private.reports
    set confirms = r.confirms, gone = r.gone, flags = r.flags, expires_at = r.expires_at,
        status = r.status, hidden_reason = r.hidden_reason
    where id = r.id;
  return json_build_object('report', darbna_private.to_public(r));
end $$;

-- New report. A report of the same kind nearby counts as a confirmation of that one instead.
create or replace function public.darbna_create_report(install text, category text, lng float8, lat float8, heading float8 default null)
returns json language plpgsql volatile security definer set search_path = darbna_private, extensions, public as $$
#variable_conflict use_variable
declare
  reporter text := darbna_private.check_install(install);
  ip text := darbna_private.client_ip_hash();
  c darbna_private.categories;
  ex darbna_private.reports;
  r darbna_private.reports;
  m10 int; h1 int; ip10 int; total int;
  dlat float8; dlng float8;
begin
  select * into c from darbna_private.categories where categories.category = darbna_create_report.category;
  if not found then raise exception 'bad_category' using errcode = 'P0001'; end if;
  if lat is null or lng is null or lat not between 28.9 and 37.5 or lng not between 38.7 and 48.9 then
    raise exception 'outside_iraq' using errcode = 'P0001';
  end if;
  if heading is not null and (heading < 0 or heading >= 360) then heading := null; end if;

  -- Rate limits: per install (as on the server), per IP (generous: mobile networks share IPs),
  -- and overall, so a script can't flood the map.
  select count(*) filter (where created_at > now() - interval '10 minutes'), count(*)
    into m10, h1 from darbna_private.reports
    where reporter_hash = reporter and created_at > now() - interval '1 hour';
  if m10 >= 3 or h1 >= 10 then raise exception 'rate_limited' using errcode = 'P0001'; end if;
  if ip is not null then
    select count(*) into ip10 from darbna_private.reports where ip_hash = ip and created_at > now() - interval '10 minutes';
    if ip10 >= 30 then raise exception 'rate_limited' using errcode = 'P0001'; end if;
  end if;
  select count(*) into total from darbna_private.reports where created_at > now() - interval '1 hour';
  if total >= 1000 then raise exception 'rate_limited' using errcode = 'P0001'; end if;

  -- Same event already reported nearby?
  dlat := c.duplicate_radius_m / 111320.0;
  dlng := dlat / greatest(cos(radians(lat)), 0.2);
  select * into ex from darbna_private.reports x
    where x.status = 'active' and x.expires_at > now() and x.category = c.category
      and x.lat between lat - dlat and lat + dlat and x.lng between lng - dlng and lng + dlng
      and darbna_private.distance_m(lat, lng, x.lat, x.lng) < c.duplicate_radius_m
    order by darbna_private.distance_m(lat, lng, x.lat, x.lng) limit 1;
  if found then
    begin
      return json_build_object('report', (public.darbna_vote(install, ex.id, 'confirm'))->'report', 'duplicate', true);
    exception when others then
      -- Their own report, or already confirmed: just hand back the existing one.
      return json_build_object('report', darbna_private.to_public(ex), 'duplicate', true);
    end;
  end if;

  insert into darbna_private.reports (category, lat, lng, heading, expires_at, reporter_hash, ip_hash)
    values (c.category, lat, lng, heading, now() + make_interval(mins => c.ttl_initial_min), reporter, ip)
    returning * into r;

  -- Housekeeping: forget IP hashes after a day; drop reports a week after they ended.
  update darbna_private.reports set ip_hash = null where ip_hash is not null and created_at < now() - interval '1 day';
  delete from darbna_private.reports where expires_at < now() - interval '7 days' and status <> 'removed';

  return json_build_object('report', darbna_private.to_public(r), 'duplicate', false);
end $$;

-- "Delete my data": removes this install's reports and votes.
create or replace function public.darbna_delete_me(install text)
returns json language plpgsql volatile security definer set search_path = darbna_private, extensions, public as $$
declare h text := darbna_private.check_install(install); nr int; nv int;
begin
  delete from darbna_private.votes where voter_hash = h;
  get diagnostics nv = row_count;
  delete from darbna_private.reports where reporter_hash = h;
  get diagnostics nr = row_count;
  return json_build_object('deleted', json_build_object('reports', nr, 'votes', nv));
end $$;

-- Only the four API functions are callable from the app.
revoke all on all functions in schema darbna_private from public, anon, authenticated;
revoke all on function public.darbna_reports(float8, float8, float8, float8) from public;
revoke all on function public.darbna_vote(text, uuid, text) from public;
revoke all on function public.darbna_create_report(text, text, float8, float8, float8) from public;
revoke all on function public.darbna_delete_me(text) from public;
grant execute on function public.darbna_reports(float8, float8, float8, float8) to anon, authenticated;
grant execute on function public.darbna_vote(text, uuid, text) to anon, authenticated;
grant execute on function public.darbna_create_report(text, text, float8, float8, float8) to anon, authenticated;
grant execute on function public.darbna_delete_me(text) to anon, authenticated;
