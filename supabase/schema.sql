-- Darbna shared community reports on Supabase.
-- Paste this whole file into Supabase → SQL Editor → New query → Run. Safe to run again.
--
-- Design
--  * Tables live in the private schema "darbna_private", which the public API can't see.
--    Apps can only call the API functions (darbna_reports, darbna_create_report, darbna_vote,
--    darbna_delete_me, darbna_traffic_submit, darbna_traffic), so every rule is enforced by the database.
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
  ('flooding',    360,  1440, 150),
  ('checkpoint',      120,    480, 200),
  ('checkpoint_slow',  60,    240, 200),
  ('camera',        43200, 525600,  80),
  ('fuel_queue',       90,    360,  80),
  ('fuel_closed',     360,   1440,  80)
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
alter table darbna_private.reports add column if not exists thanks int not null default 0;
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

-- Points for helping other drivers (reports others confirm, thanks received, confirming reports).
create table if not exists darbna_private.points (
  who text primary key,
  points int not null default 0,
  reports int not null default 0,
  thanks int not null default 0,
  updated_at timestamptz not null default now()
);
create table if not exists darbna_private.thanks (
  report_id uuid not null references darbna_private.reports(id) on delete cascade,
  voter_hash text not null,
  created_at timestamptz not null default now(),
  primary key (report_id, voter_hash)
);
alter table darbna_private.points enable row level security;
alter table darbna_private.thanks enable row level security;

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

create or replace function darbna_private.add_points(h text, n int, d_reports int default 0, d_thanks int default 0) returns void
language sql volatile security definer set search_path = darbna_private, extensions, public as $$
  insert into darbna_private.points (who, points, reports, thanks) values (h, greatest(n, 0), d_reports, d_thanks)
  on conflict (who) do update set points = darbna_private.points.points + n,
    reports = darbna_private.points.reports + d_reports, thanks = darbna_private.points.thanks + d_thanks, updated_at = now();
$$;

create or replace function darbna_private.to_public(r darbna_private.reports) returns json
language sql stable as $$
  select json_build_object(
    'id', r.id, 'category', r.category, 'source', 'community', 'verified', false,
    'coord', json_build_array(r.lng, r.lat), 'heading', r.heading,
    'createdAt', to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expiresAt', to_char(r.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'confirms', r.confirms, 'gone', r.gone, 'thanks', r.thanks, 'isSample', false);
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
  -- Points: helping keep the map right (+1), and your report confirmed by another driver (+5).
  if vote in ('confirm', 'gone') then perform darbna_private.add_points(voter, 1); end if;
  if vote = 'confirm' and r.reporter_hash is not null then perform darbna_private.add_points(r.reporter_hash, 5); end if;
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
  perform darbna_private.add_points(reporter, 10, 1, 0);

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
  delete from darbna_private.thanks where voter_hash = h;
  delete from darbna_private.points where who = h;
  delete from darbna_private.shares where owner_hash = h;
  return json_build_object('deleted', json_build_object('reports', nr, 'votes', nv));
end $$;

-- ------------------------------------------------------------------ live traffic (crowdsourced)
-- Speed samples from navigating drivers: no account or device id, only a hashed random
-- per-trip id; first/last 300 m of each trip are never sent (app side); deleted after 2 hours.
create table if not exists darbna_private.speed_samples (
  cell bigint not null,
  dir smallint not null check (dir between 0 and 7),
  lat real not null,
  lng real not null,
  ratio real not null,
  trip_hash text not null,
  ip_hash text,
  created_at timestamptz not null default now()
);
create index if not exists speed_samples_area on darbna_private.speed_samples (created_at, lat, lng);
create index if not exists speed_samples_ip on darbna_private.speed_samples (ip_hash, created_at);
alter table darbna_private.speed_samples enable row level security;

-- Must match trafficCell() in packages/core/src/traffic.ts.
create or replace function darbna_private.traffic_cell(lat float8, lng float8) returns bigint
language sql immutable as $$ select floor(lat / 0.001)::bigint * 100000 + floor(lng / 0.0012)::bigint $$;

create or replace function public.darbna_traffic_submit(trip text, samples json)
returns json language plpgsql volatile security definer set search_path = darbna_private, extensions, public as $$
declare
  th text; ip text := darbna_private.client_ip_hash(); n int; s json; added int := 0;
  la float8; lo float8; hd float8; sp float8; ex float8;
begin
  if trip is null or length(trip) < 16 or length(trip) > 100 then raise exception 'bad_trip' using errcode = 'P0001'; end if;
  if samples is null or json_typeof(samples) <> 'array' or json_array_length(samples) > 40 then
    raise exception 'bad_samples' using errcode = 'P0001';
  end if;
  th := darbna_private.hash('trip:' || trip);
  if ip is not null then
    select count(*) into n from darbna_private.speed_samples where ip_hash = ip and created_at > now() - interval '10 minutes';
    if n >= 3000 then raise exception 'rate_limited' using errcode = 'P0001'; end if;
  end if;
  select count(*) into n from darbna_private.speed_samples where trip_hash = th and created_at > now() - interval '10 minutes';
  if n >= 200 then raise exception 'rate_limited' using errcode = 'P0001'; end if;
  for s in select * from json_array_elements(samples) loop
    begin
      la := (s->>'lat')::float8; lo := (s->>'lng')::float8; hd := (s->>'heading')::float8;
      sp := (s->>'speed')::float8; ex := (s->>'expected')::float8;
    exception when others then continue;
    end;
    -- Plausible values only: inside Iraq, 0–60 m/s driven, 2–40 m/s expected.
    if la is null or lo is null or hd is null or sp is null or ex is null
       or la not between 28.9 and 37.5 or lo not between 38.7 and 48.9
       or sp < 0 or sp > 60 or ex < 2 or ex > 40 or hd < 0 or hd >= 360 then continue; end if;
    insert into darbna_private.speed_samples (cell, dir, lat, lng, ratio, trip_hash, ip_hash)
      values (darbna_private.traffic_cell(la, lo), ((round(hd / 45)::int % 8) + 8) % 8, la, lo, least(sp / ex, 2), th, ip);
    added := added + 1;
  end loop;
  delete from darbna_private.speed_samples where created_at < now() - interval '2 hours';
  return json_build_object('accepted', added);
end $$;

-- Slow cells in an area over the last 15 minutes: median of per-trip average ratios.
-- Only cells where traffic is below 70 % of normal speed are returned.
create or replace function public.darbna_traffic(min_lng float8, min_lat float8, max_lng float8, max_lat float8)
returns json language plpgsql stable security definer set search_path = darbna_private, extensions, public as $$
begin
  if max_lng - min_lng > 2.05 or max_lat - min_lat > 2.05 or max_lng < min_lng or max_lat < min_lat then
    raise exception 'area_too_large' using errcode = 'P0001';
  end if;
  return json_build_object('cells', coalesce((
    select json_agg(json_build_array(cell, dir, round(ratio::numeric, 2), trips, samples, round(lng::numeric, 5), round(lat::numeric, 5)))
    from (
      select cell, dir, percentile_cont(0.5) within group (order by trip_ratio) as ratio,
             count(*)::int as trips, sum(n)::int as samples, avg(lat) as lat, avg(lng) as lng
      from (
        select cell, dir, trip_hash, avg(ratio) as trip_ratio, count(*) as n, avg(lat) as lat, avg(lng) as lng
        from darbna_private.speed_samples
        where created_at > now() - interval '15 minutes'
          and lat between min_lat and max_lat and lng between min_lng and max_lng
        group by cell, dir, trip_hash
      ) per_trip
      group by cell, dir
      limit 5000
    ) c where ratio < 0.7), '[]'::json),
    'serverTime', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $$;

-- ------------------------------------------------------------------ thanks & points
-- "Thanks" for a report: +2 points to whoever reported it, +1 to you. Once per report.
create or replace function public.darbna_thank(install text, report_id uuid)
returns json language plpgsql volatile security definer set search_path = darbna_private, extensions, public as $$
#variable_conflict use_variable
declare voter text := darbna_private.check_install(install); r darbna_private.reports; n int;
begin
  select count(*) into n from darbna_private.thanks where voter_hash = voter and created_at > now() - interval '1 hour';
  if n >= 60 then raise exception 'rate_limited' using errcode = 'P0001'; end if;
  select * into r from darbna_private.reports where id = report_id and status = 'active' for update;
  if not found then raise exception 'report_not_active' using errcode = 'P0001'; end if;
  if r.reporter_hash = voter then raise exception 'own_report' using errcode = 'P0001'; end if;
  begin
    insert into darbna_private.thanks (report_id, voter_hash) values (r.id, voter);
  exception when unique_violation then
    raise exception 'already_thanked' using errcode = 'P0001';
  end;
  update darbna_private.reports set thanks = thanks + 1 where id = r.id returning * into r;
  if r.reporter_hash is not null then perform darbna_private.add_points(r.reporter_hash, 2, 0, 1); end if;
  perform darbna_private.add_points(voter, 1);
  return json_build_object('report', darbna_private.to_public(r));
end $$;

-- Your points (only you can see them: needs your install id).
create or replace function public.darbna_me(install text)
returns json language plpgsql stable security definer set search_path = darbna_private, extensions, public as $$
declare h text := darbna_private.check_install(install); p darbna_private.points;
begin
  select * into p from darbna_private.points where who = h;
  return json_build_object('points', coalesce(p.points, 0), 'reports', coalesce(p.reports, 0), 'thanks', coalesce(p.thanks, 0));
end $$;

-- ------------------------------------------------------------------ "share my trip"
-- A live link that shows family where you are and when you'll arrive. Only the person who
-- started it (holding the secret) can move it; it stops by itself 30 min after the last update.
create table if not exists darbna_private.shares (
  id uuid primary key default gen_random_uuid(),
  owner_hash text not null,
  secret_hash text not null,
  dest_name text,
  dest_lat double precision, dest_lng double precision,
  lat double precision, lng double precision, heading real,
  eta timestamptz, remaining_m int,
  travel text not null default 'car',
  ended boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shares_by_owner on darbna_private.shares (owner_hash, created_at);
alter table darbna_private.shares enable row level security;

create or replace function public.darbna_share_start(install text, dest_name text, dest_lng float8, dest_lat float8, travel text default 'car')
returns json language plpgsql volatile security definer set search_path = darbna_private, extensions, public as $$
#variable_conflict use_variable
declare h text := darbna_private.check_install(install); n int; sec text := encode(extensions.gen_random_bytes(18), 'hex'); sid uuid;
begin
  select count(*) into n from darbna_private.shares where owner_hash = h and created_at > now() - interval '1 day';
  if n >= 30 then raise exception 'rate_limited' using errcode = 'P0001'; end if;
  insert into darbna_private.shares (owner_hash, secret_hash, dest_name, dest_lat, dest_lng, travel)
    values (h, darbna_private.hash('share:' || sec), left(dest_name, 120), dest_lat, dest_lng, case when travel = 'walk' then 'walk' else 'car' end)
    returning id into sid;
  delete from darbna_private.shares where updated_at < now() - interval '1 day';
  return json_build_object('id', sid, 'secret', sec);
end $$;

create or replace function public.darbna_share_update(share_id uuid, secret text, lng float8, lat float8, heading float8, eta_s int, remaining_m int, ended boolean default false)
returns json language plpgsql volatile security definer set search_path = darbna_private, extensions, public as $$
#variable_conflict use_variable
declare sh darbna_private.shares;
begin
  select * into sh from darbna_private.shares where id = share_id for update;
  if not found or sh.secret_hash <> darbna_private.hash('share:' || coalesce(secret, '')) then
    raise exception 'share_not_found' using errcode = 'P0001';
  end if;
  if sh.ended then raise exception 'share_ended' using errcode = 'P0001'; end if;
  if sh.lat is not null and sh.updated_at > now() - interval '3 seconds' and not ended then return json_build_object('ok', true); end if;
  update darbna_private.shares set
    lat = case when lat between 28.9 and 37.5 then lat else sh.lat end,
    lng = case when lng between 38.7 and 48.9 then lng else sh.lng end,
    heading = case when heading >= 0 and heading < 360 then heading else null end,
    eta = case when eta_s between 0 and 172800 then now() + make_interval(secs => eta_s) else sh.eta end,
    remaining_m = greatest(0, remaining_m), ended = ended, updated_at = now()
    where id = share_id;
  return json_build_object('ok', true);
end $$;

create or replace function public.darbna_share_get(share_id uuid)
returns json language plpgsql stable security definer set search_path = darbna_private, extensions, public as $$
declare sh darbna_private.shares;
begin
  select * into sh from darbna_private.shares where id = share_id;
  if not found or sh.updated_at < now() - interval '30 minutes' then raise exception 'share_not_found' using errcode = 'P0001'; end if;
  return json_build_object(
    'destName', sh.dest_name, 'dest', json_build_array(sh.dest_lng, sh.dest_lat),
    'coord', case when sh.lat is null then null else json_build_array(sh.lng, sh.lat) end,
    'heading', sh.heading, 'remainingM', sh.remaining_m, 'travel', sh.travel, 'ended', sh.ended,
    'eta', to_char(sh.eta at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', to_char(sh.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $$;

-- Only the API functions are callable from the app.
revoke all on all functions in schema darbna_private from public, anon, authenticated;
revoke all on function public.darbna_reports(float8, float8, float8, float8) from public;
revoke all on function public.darbna_vote(text, uuid, text) from public;
revoke all on function public.darbna_create_report(text, text, float8, float8, float8) from public;
revoke all on function public.darbna_delete_me(text) from public;
grant execute on function public.darbna_reports(float8, float8, float8, float8) to anon, authenticated;
grant execute on function public.darbna_vote(text, uuid, text) to anon, authenticated;
grant execute on function public.darbna_create_report(text, text, float8, float8, float8) to anon, authenticated;
grant execute on function public.darbna_delete_me(text) to anon, authenticated;
revoke all on function public.darbna_traffic_submit(text, json) from public;
revoke all on function public.darbna_traffic(float8, float8, float8, float8) from public;
grant execute on function public.darbna_traffic_submit(text, json) to anon, authenticated;
grant execute on function public.darbna_traffic(float8, float8, float8, float8) to anon, authenticated;
revoke all on function public.darbna_thank(text, uuid) from public;
revoke all on function public.darbna_me(text) from public;
revoke all on function public.darbna_share_start(text, text, float8, float8, text) from public;
revoke all on function public.darbna_share_update(uuid, text, float8, float8, float8, int, int, boolean) from public;
revoke all on function public.darbna_share_get(uuid) from public;
grant execute on function public.darbna_thank(text, uuid) to anon, authenticated;
grant execute on function public.darbna_me(text) to anon, authenticated;
grant execute on function public.darbna_share_start(text, text, float8, float8, text) to anon, authenticated;
grant execute on function public.darbna_share_update(uuid, text, float8, float8, float8, int, int, boolean) to anon, authenticated;
grant execute on function public.darbna_share_get(uuid) to anon, authenticated;
