-- Apply after schema.sql and rewards.sql. No existing users are banned or scored here.
begin;
create table if not exists darbna_private.report_reviews (
  report_id uuid primary key,
  reporter_hash text not null,
  verdict text not null check(verdict in ('fake','abuse','valid')),
  reason text not null check(length(trim(reason))>=3),
  reviewed_at timestamptz not null default now()
);
alter table darbna_private.report_reviews enable row level security;
revoke all on darbna_private.report_reviews from public,anon,authenticated;

-- Owner-confirmed decisions only. Flags, clearance votes and expiration never create strikes.
-- One decision per report survives report expiry. A correction replaces that decision.
create or replace function darbna_private.review_report(report uuid, verdict text, reason text)
returns json language plpgsql security definer set search_path=darbna_private,extensions,public as $$
#variable_conflict use_variable
declare author text; offences integer;
begin
  if verdict is null or verdict not in ('fake','abuse','valid') or coalesce(length(trim(reason)),0)<3 then
    raise exception 'invalid_review' using errcode='P0001';
  end if;
  select reporter_hash into author from darbna_private.reports where id=report;
  if author is null then select reporter_hash into author from darbna_private.report_reviews where report_id=report; end if;
  if author is null then raise exception 'report_not_found' using errcode='P0001'; end if;
  -- Serialize decisions and report creation for the same installation, including distinct reports.
  perform pg_advisory_xact_lock(hashtextextended(author,2741));
  perform 1 from darbna_private.reports where id=report for update;
  insert into darbna_private.report_reviews(report_id,reporter_hash,verdict,reason)
    values(report,author,verdict,left(trim(reason),500))
    on conflict(report_id) do update set verdict=excluded.verdict,reason=excluded.reason,reviewed_at=now();
  if verdict in ('fake','abuse') then
    update darbna_private.reports set status='removed',hidden_reason='confirmed_'||verdict where id=report;
  else
    update darbna_private.reports set status='active',hidden_reason=null,flags=0
      where id=report and (hidden_reason in ('confirmed_fake','confirmed_abuse','flags'));
    update darbna_private.reward_ledger set reversed=false where report_id=report;
  end if;
  select count(*) into offences from darbna_private.report_reviews r
    where r.reporter_hash=author and r.verdict in ('fake','abuse');
  if offences>=5 then
    insert into darbna_private.banned_reporters(reporter_hash,reason)
      values(author,'five_confirmed_report_abuses') on conflict do nothing;
  else
    -- Appeals can lift this automatic ban; they never remove a separately imposed owner ban.
    delete from darbna_private.banned_reporters b where b.reporter_hash=author and b.reason='five_confirmed_report_abuses';
  end if;
  return json_build_object('offences',offences,'reportingBanned',exists(select 1 from darbna_private.banned_reporters b where b.reporter_hash=author));
end $$;
revoke all on function darbna_private.review_report(uuid,text,text) from public,anon,authenticated;

create or replace view darbna_private.report_review_queue as
select r.id,r.category,r.lat,r.lng,r.created_at,r.expires_at,r.status,r.hidden_reason,
  r.confirms,r.gone,r.flags,r.reporter_hash,
  (select count(*) from darbna_private.reports x where x.reporter_hash=r.reporter_hash and x.created_at>now()-interval '1 hour') as reports_last_hour,
  (select count(*) from darbna_private.report_reviews x where x.reporter_hash=r.reporter_hash and x.verdict in ('fake','abuse')) as confirmed_offences
from darbna_private.reports r
where r.flags>0 and not exists(select 1 from darbna_private.report_reviews x where x.report_id=r.id)
order by r.flags desc,r.created_at;
revoke all on darbna_private.report_review_queue from public,anon,authenticated;

create or replace function darbna_private.enforce_reporter_ban() returns trigger
language plpgsql security definer set search_path=darbna_private,extensions,public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.reporter_hash,2741));
  if exists(select 1 from darbna_private.banned_reporters where reporter_hash=new.reporter_hash) then
    raise exception 'reporter_banned' using errcode='P0001';
  end if;
  return new;
end $$;
revoke all on function darbna_private.enforce_reporter_ban() from public,anon,authenticated;

-- Public report/vote RPC replacements follow. They keep the existing validation,
-- location limits, expiry and duplicate handling, with +2 points and an early ban check.

create or replace function public.darbna_vote(install text, report_id uuid, vote text)
returns json language plpgsql volatile security definer set search_path = darbna_private, extensions, public as $$
#variable_conflict use_variable
declare
  voter text := darbna_private.check_install(install);
  r darbna_private.reports;
  c darbna_private.categories;
  n int;
begin
  if exists(select 1 from darbna_private.banned_reporters where reporter_hash=voter) then raise exception 'reporter_banned' using errcode='P0001'; end if;
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
  -- +2 per independent confirmation; author earns +2 once for this correct report.
  if vote='confirm' then perform darbna_private.add_points(voter, 2); end if;
  if vote='confirm' and r.confirms=1 and r.reporter_hash is not null and not exists(select 1 from darbna_private.banned_reporters where reporter_hash=r.reporter_hash) then perform darbna_private.add_points(r.reporter_hash, 2); end if;
  return json_build_object('report', darbna_private.to_public(r));
end $$;

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
  perform pg_advisory_xact_lock(hashtextextended(reporter,2741));
  if exists(select 1 from darbna_private.banned_reporters where reporter_hash=reporter) then raise exception 'reporter_banned' using errcode='P0001'; end if;
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
  perform darbna_private.add_points(reporter, 0, 1, 0);

  -- Housekeeping: forget IP hashes after a day; drop reports a week after they ended.
  update darbna_private.reports set ip_hash = null where ip_hash is not null and created_at < now() - interval '1 day';
  delete from darbna_private.reports where expires_at < now() - interval '7 days' and status <> 'removed';

  return json_build_object('report', darbna_private.to_public(r), 'duplicate', false);
end $$;
notify pgrst,'reload schema';
commit;
