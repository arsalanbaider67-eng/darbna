-- Transaction-isolated fixtures: never committed or visible to other connections.
begin;
do $$
declare
  viewer text := 'review-viewer-' || gen_random_uuid()::text;
  author_a text := 'review-author-a-' || gen_random_uuid()::text;
  author_b text := 'review-author-b-' || gen_random_uuid()::text;
  a uuid; a2 uuid; b uuid; payload json; before_count int; after_count int;
begin
  if has_table_privilege('anon', 'darbna_private.reporter_blocks', 'select') then raise exception 'private blocks exposed'; end if;
  if has_table_privilege('anon', 'darbna_private.banned_reporters', 'select') then raise exception 'private bans exposed'; end if;
  insert into darbna_private.reports(category,lat,lng,expires_at,reporter_hash)
    values('pothole',36.01,44.01,now()+interval '1 hour',darbna_private.check_install(author_a)) returning id into a;
  insert into darbna_private.reports(category,lat,lng,expires_at,reporter_hash)
    values('pothole',36.011,44.011,now()+interval '1 hour',darbna_private.check_install(author_a)) returning id into a2;
  insert into darbna_private.reports(category,lat,lng,expires_at,reporter_hash)
    values('pothole',36.012,44.012,now()+interval '1 hour',darbna_private.check_install(author_b)) returning id into b;
  payload := public.darbna_reports_for_install(viewer,44.0,36.0,44.02,36.02);
  select count(*) into before_count from json_array_elements(payload->'reports') r where r->>'id' in(a::text,a2::text,b::text);
  if before_count <> 3 then raise exception 'fixture reports missing'; end if;
  payload := public.darbna_block_reporter(viewer,a);
  if json_array_length(payload->'hiddenIds') <> 2 then raise exception 'block does not cover same sender'; end if;
  payload := public.darbna_reports_for_install(viewer,44.0,36.0,44.02,36.02);
  select count(*) into after_count from json_array_elements(payload->'reports') r where r->>'id' in(a::text,a2::text,b::text);
  if after_count <> 1 then raise exception 'blocked sender still visible'; end if;
  payload := public.darbna_reports_for_install(author_b,44.0,36.0,44.02,36.02);
  select count(*) into after_count from json_array_elements(payload->'reports') r where r->>'id' in(a::text,a2::text,b::text);
  if after_count <> 3 then raise exception 'blocking leaked to another viewer'; end if;
  begin
    perform public.darbna_block_reporter(author_a,a);
    raise exception 'self blocking unexpectedly succeeded';
  exception when sqlstate 'P0001' then if sqlerrm <> 'own_report' then raise; end if; end;
  perform public.darbna_vote(viewer,b,'flag');
  payload := public.darbna_reports_for_install(viewer,44.0,36.0,44.02,36.02);
  if exists(select 1 from json_array_elements(payload->'reports') r where r->>'id'=b::text) then raise exception 'flagged report returned'; end if;
  insert into darbna_private.banned_reporters(reporter_hash,reason) values(darbna_private.check_install(author_a),'transaction test');
  begin
    insert into darbna_private.reports(category,lat,lng,expires_at,reporter_hash)
      values('pothole',36.01,44.01,now()+interval '1 hour',darbna_private.check_install(author_a));
    raise exception 'banned reporter inserted';
  exception when sqlstate 'P0001' then if sqlerrm <> 'reporter_banned' then raise; end if; end;
  perform public.darbna_delete_me(viewer);
  if exists(select 1 from darbna_private.reporter_blocks where blocker_hash=darbna_private.check_install(viewer)) then raise exception 'deletion kept block preferences'; end if;
end $$;
rollback;
select 'PASS: private tables, sender blocking, viewer isolation, self-block rejection, flag persistence, moderator ban and deletion; all fixtures rolled back' as review_test;
