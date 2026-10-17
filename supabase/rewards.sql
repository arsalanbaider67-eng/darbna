-- Rewards preview. Starts disabled, with NO offers, fake prizes or seeded balances.
-- Apply after schema.sql. Owner-only operations remain in the private schema.
begin;
create table if not exists darbna_private.reward_program (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  launch_reviewed boolean not null default false,
  terms_version text not null default 'draft-v1',
  pool_revision integer not null default 1,
  terms jsonb not null default '{}'::jsonb
);
insert into darbna_private.reward_program(singleton) values(true) on conflict do nothing;
alter table darbna_private.reward_program add column if not exists launch_reviewed boolean not null default false;
create table if not exists darbna_private.reward_offers (
  id uuid primary key default gen_random_uuid(),
  milestone integer not null check(milestone>0 and milestone%10=0),
  kind text not null check(kind in('mobile_credit','voucher','physical_gift','oil_change','car','guaranteed_reward')),
  title jsonb not null,
  detail jsonb not null,
  capacity integer not null check(capacity>0),
  used integer not null default 0 check(used>=0),
  weight integer not null default 0 check(weight>=0 and weight<=20000),
  published boolean not null default false,
  funded boolean not null default false,
  revision integer not null default 1,
  created_at timestamptz not null default now()
);
alter table darbna_private.reward_offers add column if not exists funded boolean not null default false;
create table if not exists darbna_private.reward_ledger (
  who text not null,
  event_key text not null,
  report_id uuid references darbna_private.reports(id) on delete set null,
  points integer not null check(points>0),
  reversed boolean not null default false,
  created_at timestamptz not null default now(),
  primary key(who,event_key)
);
create table if not exists darbna_private.reward_draws (
  id uuid primary key default gen_random_uuid(),
  claimant_hash text not null,
  milestone integer not null,
  offer_id uuid not null references darbna_private.reward_offers(id),
  title jsonb not null,
  detail jsonb not null,
  terms_version text not null,
  terms_snapshot jsonb not null,
  odds_snapshot jsonb not null,
  bucket integer not null check(bucket>=0 and bucket<20000),
  created_at timestamptz not null default now(),
  unique(claimant_hash,milestone)
);
create table if not exists darbna_private.reward_claims (
  id uuid primary key default gen_random_uuid(),
  claimant_hash text not null,
  milestone integer not null,
  draw_id uuid not null unique references darbna_private.reward_draws(id),
  offer_id uuid not null references darbna_private.reward_offers(id),
  offer_title jsonb not null,
  offer_detail jsonb not null,
  offer_revision integer not null,
  terms_version text not null,
  terms_snapshot jsonb not null,
  contact_method text not null check(contact_method in('email','phone','whatsapp','telegram')),
  contact_value text not null,
  contact_hash text not null,
  status text not null default 'pending' check(status in('pending','approved','sent','rejected')),
  owner_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(claimant_hash,milestone), unique(contact_hash,milestone)
);
alter table darbna_private.reward_program enable row level security;
alter table darbna_private.reward_offers enable row level security;
alter table darbna_private.reward_ledger enable row level security;
alter table darbna_private.reward_claims enable row level security;
alter table darbna_private.reward_draws enable row level security;
revoke all on darbna_private.reward_program,darbna_private.reward_offers,darbna_private.reward_ledger,darbna_private.reward_claims,darbna_private.reward_draws from public,anon,authenticated;

create or replace function darbna_private.reward_level(p bigint) returns integer
language sql immutable as $$
select case when p>=2500 then (6+(p-2500)/1000)::integer
 when p>=1000 then 5 when p>=400 then 4 when p>=150 then 3 when p>=50 then 2 else 1 end;
$$;
create or replace function darbna_private.reward_balance(h text) returns bigint
language sql stable security definer set search_path=darbna_private,extensions,public as $$
select coalesce(sum(points) filter(where not reversed),0)::bigint from darbna_private.reward_ledger where who=h;
$$;

-- Only successful independent checks earn reward credit. Unconfirmed reports and thanks
-- earn recognition points as before, but cannot alone unlock a prize.
create or replace function darbna_private.reward_vote() returns trigger
language plpgsql security definer set search_path=darbna_private,extensions,public as $$
declare author text;
begin
  if new.vote<>'confirm' then return new; end if;
  select reporter_hash into author from darbna_private.reports where id=new.report_id;
  if author is null or author=new.voter_hash then return new; end if;
  if exists(select 1 from darbna_private.banned_reporters where reporter_hash in(author,new.voter_hash)) then return new; end if;
  insert into darbna_private.reward_ledger(who,event_key,report_id,points)
    values(new.voter_hash,'check:'||new.report_id,new.report_id,2) on conflict do nothing;
  if new.vote='confirm' then
    insert into darbna_private.reward_ledger(who,event_key,report_id,points)
      values(author,'report:'||new.report_id,new.report_id,2) on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists reward_vote on darbna_private.votes;
create trigger reward_vote after insert on darbna_private.votes for each row execute function darbna_private.reward_vote();
create or replace function darbna_private.reverse_bad_reward_report() returns trigger
language plpgsql security definer set search_path=darbna_private,extensions,public as $$
begin
  if new.status='removed' or new.hidden_reason='flags' then
    update darbna_private.reward_ledger set reversed=true where report_id=new.id;
  end if;
  return new;
end $$;
drop trigger if exists reverse_bad_reward_report on darbna_private.reports;
create trigger reverse_bad_reward_report after update of status,hidden_reason on darbna_private.reports
 for each row execute function darbna_private.reverse_bad_reward_report();
create or replace function darbna_private.bump_reward_offer() returns trigger
language plpgsql security definer set search_path=darbna_private,extensions,public as $$
begin
  if tg_op='UPDATE' then
    if (to_jsonb(new)-'used'-'revision')=(to_jsonb(old)-'used'-'revision') then return new; end if;
    new.revision:=old.revision+1;
  end if;
  update darbna_private.reward_program set pool_revision=pool_revision+1 where singleton;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists bump_reward_offer on darbna_private.reward_offers;
create trigger bump_reward_offer before insert or update or delete on darbna_private.reward_offers for each row execute function darbna_private.bump_reward_offer();

create or replace function darbna_private.reward_random_bucket() returns integer
language plpgsql volatile set search_path=extensions,public as $$
declare b bytea; n bigint;
begin
  loop
    b:=extensions.gen_random_bytes(4);
    n:=get_byte(b,0)::bigint*16777216+get_byte(b,1)::bigint*65536+get_byte(b,2)::bigint*256+get_byte(b,3);
    -- Rejection sampling avoids modulo bias. Client never provides randomness.
    if n<4294960000 then return (n%20000)::integer; end if;
  end loop;
end $$;
create or replace function darbna_private.reward_kind_for_bucket(b integer) returns text
language plpgsql immutable as $$ begin
  if b is null or b<0 or b>=20000 then raise exception 'bad_bucket'; end if;
  return case when b<8000 then 'voucher' when b<8100 then 'oil_change' when b<8101 then 'car' else 'mobile_credit' end;
end $$;
create or replace function darbna_private.bump_reward_program() returns trigger
language plpgsql as $$ begin
  if new.terms is distinct from old.terms or new.terms_version is distinct from old.terms_version or new.enabled is distinct from old.enabled or new.launch_reviewed is distinct from old.launch_reviewed then new.pool_revision:=old.pool_revision+1; end if;
  return new;
end $$;
drop trigger if exists bump_reward_program on darbna_private.reward_program;
create trigger bump_reward_program before update on darbna_private.reward_program for each row execute function darbna_private.bump_reward_program();

create or replace function darbna_private.reward_draw_json(d darbna_private.reward_draws) returns json
language sql stable as $$ select json_build_object('id',d.id,'milestone',d.milestone,'title',d.title,'detail',d.detail,'termsVersion',d.terms_version,'terms',d.terms_snapshot,'odds',d.odds_snapshot,'createdAt',d.created_at); $$;

create or replace function public.darbna_rewards(install text) returns json
language plpgsql stable security definer set search_path=darbna_private,extensions,public as $$
declare h text:=darbna_private.check_install(install); p darbna_private.reward_program;
begin
  select * into p from darbna_private.reward_program where singleton;
  return json_build_object('enabled',coalesce(p.enabled and p.launch_reviewed,false),'termsVersion',p.terms_version,'terms',p.terms,'poolRevision',p.pool_revision,
    'points',darbna_private.reward_balance(h),
    'offers',coalesce((select json_agg(json_build_object('id',o.id,'milestone',o.milestone,'kind',o.kind,'weight',o.weight,
      'title',o.title,'detail',o.detail,'revision',o.revision,'available',case when o.funded then greatest(0,o.capacity-o.used) else 0 end))
      from darbna_private.reward_offers o where p.enabled and o.published),'[]'::json),
    'draws',coalesce((select json_agg(darbna_private.reward_draw_json(d) order by d.created_at desc) from darbna_private.reward_draws d where d.claimant_hash=h),'[]'::json),
    'claims',coalesce((select json_agg(json_build_object('id',c.id,'milestone',c.milestone,'title',c.offer_title,
      'status',c.status,'note',c.owner_note,'createdAt',c.created_at) order by c.created_at desc)
      from darbna_private.reward_claims c where c.claimant_hash=h),'[]'::json));
end $$;

create or replace function public.darbna_reward_draw(install text,milestone integer,terms_version text,pool_revision integer) returns json
language plpgsql volatile security definer set search_path=darbna_private,extensions,public as $$
#variable_conflict use_variable
declare h text:=darbna_private.check_install(install); p darbna_private.reward_program; o darbna_private.reward_offers;
 d darbna_private.reward_draws; pool jsonb; n integer; total integer; bucket integer; edge integer:=0;
begin
  select * into p from darbna_private.reward_program where singleton for update;
  select * into d from darbna_private.reward_draws x where x.claimant_hash=h and x.milestone=milestone;
  if found then return darbna_private.reward_draw_json(d); end if;
  if not p.enabled or not p.launch_reviewed then raise exception 'program_closed' using errcode='P0001'; end if;
  if terms_version is distinct from p.terms_version or pool_revision is distinct from p.pool_revision then raise exception 'terms_changed' using errcode='P0001'; end if;
  if milestone is null or milestone<10 or milestone%10<>0 or darbna_private.reward_level(darbna_private.reward_balance(h))<milestone
    or exists(select 1 from darbna_private.banned_reporters where reporter_hash=h) then raise exception 'not_eligible' using errcode='P0001'; end if;
  if coalesce(length(p.terms->>'ar'),0)<30 or coalesce(length(p.terms->>'en'),0)<30 or coalesce(length(p.terms->>'ckb'),0)<30 then raise exception 'program_closed' using errcode='P0001'; end if;
  perform 1 from darbna_private.reward_offers x where x.milestone=milestone order by x.id for update;
  select count(*),sum(x.weight),jsonb_agg(jsonb_build_object('kind',x.kind,'weight',x.weight,'title',x.title,'detail',x.detail) order by x.kind)
    into n,total,pool from darbna_private.reward_offers x where x.milestone=milestone and x.published;
  if n<>4 or total<>20000 or not exists(select 1 from darbna_private.reward_offers x where x.milestone=milestone and x.published and x.kind='voucher' and x.weight=8000)
    or not exists(select 1 from darbna_private.reward_offers x where x.milestone=milestone and x.published and x.kind='oil_change' and x.weight=100)
    or not exists(select 1 from darbna_private.reward_offers x where x.milestone=milestone and x.published and x.kind='car' and x.weight=1)
    or not exists(select 1 from darbna_private.reward_offers x where x.milestone=milestone and x.published and x.kind='mobile_credit' and x.weight=11899) then raise exception 'pool_incomplete' using errcode='P0001'; end if;
  -- Pause the WHOLE pool if any prize is unavailable; never silently improve or worsen odds.
  if exists(select 1 from darbna_private.reward_offers x where x.milestone=milestone and x.published and
    (not x.funded or x.used>=x.capacity or coalesce(length(x.title->>'ar'),0)<1 or coalesce(length(x.title->>'en'),0)<1 or coalesce(length(x.title->>'ckb'),0)<1
    or coalesce(length(x.detail->>'ar'),0)<10 or coalesce(length(x.detail->>'en'),0)<10 or coalesce(length(x.detail->>'ckb'),0)<10)) then raise exception 'offer_unavailable' using errcode='P0001'; end if;
  bucket:=darbna_private.reward_random_bucket();
  for o in select * from darbna_private.reward_offers x where x.milestone=milestone and x.published order by case x.kind when 'voucher' then 0 when 'oil_change' then 1 when 'car' then 2 else 3 end loop
    edge:=edge+o.weight;
    if bucket<edge then
      insert into darbna_private.reward_draws(claimant_hash,milestone,offer_id,title,detail,terms_version,terms_snapshot,odds_snapshot,bucket)
        values(h,milestone,o.id,o.title,o.detail,p.terms_version,p.terms,pool,bucket) returning * into d;
      update darbna_private.reward_offers set used=used+1 where id=o.id;
      return darbna_private.reward_draw_json(d);
    end if;
  end loop;
  raise exception 'pool_incomplete' using errcode='P0001';
end $$;

create or replace function public.darbna_reward_claim(install text,draw_id uuid,contact_method text,contact_value text,terms_version text)
returns json language plpgsql volatile security definer set search_path=darbna_private,extensions,public as $$
#variable_conflict use_variable
declare h text:=darbna_private.check_install(install); d darbna_private.reward_draws;
 canonical text; ch text; cid uuid; existing darbna_private.reward_claims;
begin
  select * into d from darbna_private.reward_draws x where x.id=draw_id and x.claimant_hash=h for update;
  if not found then raise exception 'draw_not_found' using errcode='P0001'; end if;
  if terms_version is distinct from d.terms_version then raise exception 'terms_changed' using errcode='P0001'; end if;
  if darbna_private.reward_level(darbna_private.reward_balance(h))<d.milestone
    or exists(select 1 from darbna_private.banned_reporters where reporter_hash=h) then raise exception 'not_eligible' using errcode='P0001'; end if;
  canonical:=trim(contact_value);
  if contact_method='email' then
    canonical:=lower(canonical);
    if length(canonical)>254 or canonical !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'bad_contact' using errcode='P0001'; end if;
  elsif contact_method in('phone','whatsapp') then
    canonical:=regexp_replace(canonical,'[[:space:]().-]','','g');
    if canonical !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'bad_contact' using errcode='P0001'; end if;
  elsif contact_method='telegram' then
    canonical:='@'||lower(ltrim(canonical,'@'));
    if canonical !~ '^@[a-z][a-z0-9_]{4,31}$' then raise exception 'bad_contact' using errcode='P0001'; end if;
  else raise exception 'bad_contact' using errcode='P0001'; end if;
  if canonical is null then raise exception 'bad_contact' using errcode='P0001'; end if;
  ch:=darbna_private.hash('reward-contact:'||(case when contact_method in('phone','whatsapp') then 'phone' else contact_method end)||':'||canonical);
  select * into existing from darbna_private.reward_claims c where c.claimant_hash=h and c.milestone=d.milestone;
  if found then
    if existing.draw_id=draw_id and existing.contact_hash=ch then return json_build_object('id',existing.id); end if;
    raise exception 'already_claimed' using errcode='P0001';
  end if;
  begin
    insert into darbna_private.reward_claims(claimant_hash,milestone,draw_id,offer_id,offer_title,offer_detail,offer_revision,terms_version,terms_snapshot,contact_method,contact_value,contact_hash)
      values(h,d.milestone,d.id,d.offer_id,d.title,d.detail,1,d.terms_version,d.terms_snapshot,contact_method,canonical,ch) returning id into cid;
  exception when unique_violation then raise exception 'already_claimed' using errcode='P0001'; end;
  return json_build_object('id',cid);
end $$;

-- Owner uses SQL Editor under the database-owner session. Never grant this to app roles.
create or replace function darbna_private.review_reward_claim(claim_id uuid,next_status text,note text default null)
returns void language plpgsql security definer set search_path=darbna_private,extensions,public as $$
declare c darbna_private.reward_claims;
begin
  select * into c from darbna_private.reward_claims where id=claim_id for update;
  if not found then raise exception 'claim_not_found'; end if;
  if not ((c.status='pending' and next_status in('approved','rejected')) or (c.status='approved' and next_status in('sent','rejected'))) then raise exception 'invalid_transition'; end if;
  if next_status in('approved','sent') and (exists(select 1 from darbna_private.banned_reporters where reporter_hash=c.claimant_hash)
     or darbna_private.reward_level(darbna_private.reward_balance(c.claimant_hash))<c.milestone) then raise exception 'not_eligible'; end if;
  if next_status='rejected' and coalesce(length(trim(note)),0)<3 then raise exception 'reason_required'; end if;
  if next_status='rejected' then update darbna_private.reward_offers set used=greatest(0,used-1) where id=c.offer_id; end if;
  update darbna_private.reward_claims set status=next_status,owner_note=left(note,300),updated_at=now() where id=claim_id;
end $$;

-- Deletion of the installation's points also removes its reward credit and contact records.
create or replace function darbna_private.delete_reward_identity() returns trigger
language plpgsql security definer set search_path=darbna_private,extensions,public as $$
begin
  delete from darbna_private.reward_claims where claimant_hash=old.who;
  delete from darbna_private.reward_draws where claimant_hash=old.who;
  delete from darbna_private.reward_ledger where who=old.who;
  return old;
end $$;
drop trigger if exists delete_reward_identity on darbna_private.points;
create trigger delete_reward_identity after delete on darbna_private.points for each row execute function darbna_private.delete_reward_identity();
create or replace function public.darbna_delete_me(install text)
returns json language plpgsql volatile security definer set search_path=darbna_private,extensions,public as $$
declare h text:=darbna_private.check_install(install); nr integer; nv integer;
begin
  delete from darbna_private.votes where voter_hash=h;
  get diagnostics nv=row_count;
  delete from darbna_private.reports where reporter_hash=h;
  get diagnostics nr=row_count;
  delete from darbna_private.thanks where voter_hash=h;
  delete from darbna_private.points where who=h;
  delete from darbna_private.shares where owner_hash=h;
  delete from darbna_private.reporter_blocks where blocker_hash=h;
  delete from darbna_private.reward_claims where claimant_hash=h;
  delete from darbna_private.reward_draws where claimant_hash=h;
  delete from darbna_private.reward_ledger where who=h;
  return json_build_object('deleted',json_build_object('reports',nr,'votes',nv));
end $$;
revoke all on all functions in schema darbna_private from public,anon,authenticated;
revoke all on function public.darbna_rewards(text) from public;
revoke all on function public.darbna_reward_claim(text,uuid,text,text,text) from public;
grant execute on function public.darbna_rewards(text) to anon,authenticated;
grant execute on function public.darbna_reward_claim(text,uuid,text,text,text) to anon,authenticated;
revoke all on function public.darbna_reward_draw(text,integer,text,integer) from public;
grant execute on function public.darbna_reward_draw(text,integer,text,integer) to anon,authenticated;
notify pgrst,'reload schema';
commit;
