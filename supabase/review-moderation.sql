-- Additive review-readiness migration. No existing reports are removed.
begin;
create table if not exists darbna_private.reporter_blocks (
  blocker_hash text not null,
  reporter_hash text not null,
  created_at timestamptz not null default now(),
  primary key (blocker_hash, reporter_hash)
);
alter table darbna_private.reporter_blocks enable row level security;
revoke all on darbna_private.reporter_blocks from public, anon, authenticated;

-- Moderators can add a reporter hash here through the private dashboard.
-- The hash is never returned by the public API.
create table if not exists darbna_private.banned_reporters (
  reporter_hash text primary key,
  reason text not null,
  created_at timestamptz not null default now()
);
alter table darbna_private.banned_reporters enable row level security;
revoke all on darbna_private.banned_reporters from public, anon, authenticated;

create or replace function darbna_private.enforce_reporter_ban() returns trigger
language plpgsql security definer set search_path = darbna_private, extensions, public as $$
begin
  if exists (select 1 from darbna_private.banned_reporters b where b.reporter_hash = new.reporter_hash) then
    raise exception 'reporter_banned' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function darbna_private.enforce_reporter_ban() from public, anon, authenticated;
drop trigger if exists enforce_reporter_ban on darbna_private.reports;
create trigger enforce_reporter_ban before insert on darbna_private.reports
for each row execute function darbna_private.enforce_reporter_ban();

create or replace function public.darbna_reports_for_install(install text, min_lng float8, min_lat float8, max_lng float8, max_lat float8)
returns json language plpgsql stable security definer set search_path = darbna_private, extensions, public as $$
declare viewer text := darbna_private.check_install(install);
begin
  if max_lng - min_lng > 2.05 or max_lat - min_lat > 2.05 or max_lng < min_lng or max_lat < min_lat then
    raise exception 'area_too_large' using errcode = 'P0001';
  end if;
  return json_build_object('reports', coalesce((
    select json_agg(darbna_private.to_public(r) order by r.created_at desc)
    from (select rr.* from darbna_private.reports rr
      where rr.status = 'active' and rr.expires_at > now()
        and rr.lat between min_lat and max_lat and rr.lng between min_lng and max_lng
        and not exists (select 1 from darbna_private.reporter_blocks b where b.blocker_hash = viewer and b.reporter_hash = rr.reporter_hash)
        and not exists (select 1 from darbna_private.votes v where v.voter_hash = viewer and v.report_id = rr.id and v.vote in ('flag', 'gone'))
        and not exists (select 1 from darbna_private.banned_reporters b where b.reporter_hash = rr.reporter_hash)
      order by rr.created_at desc limit 400) r), '[]'::json),
    'serverTime', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $$;

create or replace function public.darbna_block_reporter(install text, report_id uuid)
returns json language plpgsql volatile security definer set search_path = darbna_private, extensions, public as $$
declare viewer text := darbna_private.check_install(install); author text;
begin
  select r.reporter_hash into author from darbna_private.reports r
    where r.id = report_id and r.status = 'active' and r.expires_at > now();
  if author is null then raise exception 'report_not_active' using errcode = 'P0001'; end if;
  if author = viewer then raise exception 'own_report' using errcode = 'P0001'; end if;
  if (select count(*) from darbna_private.reporter_blocks b where b.blocker_hash = viewer) >= 2000 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into darbna_private.reporter_blocks(blocker_hash, reporter_hash) values(viewer, author)
    on conflict do nothing;
  return json_build_object('hiddenIds', coalesce((select json_agg(r.id) from darbna_private.reports r
    where r.reporter_hash = author and r.status = 'active' and r.expires_at > now()), '[]'::json));
end $$;

-- Clear the caller's block preferences when they explicitly delete their data.
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
  delete from darbna_private.reporter_blocks where blocker_hash = h;
  return json_build_object('deleted', json_build_object('reports', nr, 'votes', nv));
end $$;
revoke all on function public.darbna_reports_for_install(text,float8,float8,float8,float8) from public;
revoke all on function public.darbna_block_reporter(text,uuid) from public;
grant execute on function public.darbna_reports_for_install(text,float8,float8,float8,float8) to anon, authenticated;
grant execute on function public.darbna_block_reporter(text,uuid) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
