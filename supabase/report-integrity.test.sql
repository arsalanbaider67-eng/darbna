-- Requires schema.sql, rewards.sql and report-integrity.sql. All fixtures roll back.
begin;
do $$
declare a text:='integrity-author-'||gen_random_uuid(); b text:='integrity-checker-'||gen_random_uuid();
 c text:='integrity-other-'||gen_random_uuid(); h text; rid uuid; ids uuid[]:='{}'; i integer; result json;
begin
 h:=darbna_private.check_install(a);
 if has_table_privilege('anon','darbna_private.report_reviews','select') or has_table_privilege('anon','darbna_private.report_review_queue','select')
   or has_function_privilege('anon','darbna_private.review_report(uuid,text,text)','execute') then raise exception 'moderation exposed'; end if;
 -- A real submission earns zero until another installation confirms it.
 result:=public.darbna_create_report(a,'pothole',44.01,36.01); rid:=(result->'report'->>'id')::uuid;
 if (public.darbna_me(a)->>'points')::integer<>0 then raise exception 'submission earned points'; end if;
 perform public.darbna_vote(b,rid,'confirm');
 perform public.darbna_vote(c,rid,'confirm');
 if darbna_private.reward_balance(h)<>2 or (public.darbna_me(a)->>'points')::integer<>2
   or darbna_private.reward_balance(darbna_private.check_install(b))<>2 or (public.darbna_me(b)->>'points')::integer<>2 then raise exception 'plus two incorrect'; end if;
 perform darbna_private.review_report(rid,'fake','TEST ONLY confirmed fabrication');
 if darbna_private.reward_balance(h)<>0 or darbna_private.reward_balance(darbna_private.check_install(b))<>0 then raise exception 'confirmed fake retained rewards'; end if;
 perform darbna_private.review_report(rid,'valid','TEST ONLY corrected evidence after appeal');
 if darbna_private.reward_balance(h)<>2 or darbna_private.reward_balance(darbna_private.check_install(b))<>2 then raise exception 'appeal failed to restore credit'; end if;
 -- Clearance and raw flags do not convict a reporter or grant reward credit.
 insert into darbna_private.reports(category,lat,lng,reporter_hash,expires_at) values('pothole',36.02,44.02,h,now()+interval '1 hour') returning id into rid;
 perform public.darbna_vote(b,rid,'gone');
 if darbna_private.reward_balance(darbna_private.check_install(b))<>2 then raise exception 'clearance earned reward'; end if;
 update darbna_private.reports set flags=3,status='hidden',hidden_reason='flags' where id=rid;
 if exists(select 1 from darbna_private.report_reviews where reporter_hash=h and verdict in ('fake','abuse')) or exists(select 1 from darbna_private.banned_reporters where reporter_hash=h) then raise exception 'flags convicted reporter'; end if;
 for i in 1..5 loop
   insert into darbna_private.reports(category,lat,lng,reporter_hash,expires_at) values('pothole',36.03,44.03,h,now()+interval '1 hour') returning id into rid;
   ids:=array_append(ids,rid);
   result:=darbna_private.review_report(rid,case when i%2=0 then 'abuse' else 'fake' end,'TEST ONLY reviewed evidence');
   if (result->>'offences')::integer<>i then raise exception 'wrong strike count'; end if;
   if i<5 and (result->>'reportingBanned')::boolean then raise exception 'ban before fifth case'; end if;
   perform darbna_private.review_report(rid,'fake','TEST ONLY repeated review');
 end loop;
 if not exists(select 1 from darbna_private.banned_reporters where reporter_hash=h) then raise exception 'fifth case did not ban'; end if;
 begin perform public.darbna_create_report(a,'pothole',44.01,36.01); raise exception 'ban bypass through duplicate path';
 exception when sqlstate 'P0001' then if sqlerrm<>'reporter_banned' then raise; end if; end;
 begin perform public.darbna_vote(a,ids[1],'confirm'); raise exception 'banned user voted';
 exception when sqlstate 'P0001' then if sqlerrm<>'reporter_banned' then raise; end if; end;
 result:=darbna_private.review_report(ids[5],'valid','TEST ONLY corrected moderation mistake');
 if (result->>'offences')::integer<>4 or (result->>'reportingBanned')::boolean then raise exception 'appeal failed'; end if;
 -- Corrections must not remove a separate owner-imposed ban.
 insert into darbna_private.banned_reporters(reporter_hash,reason) values(h,'owner_imposed_test_ban');
 perform darbna_private.review_report(ids[4],'valid','TEST ONLY corrected moderation mistake');
 if not exists(select 1 from darbna_private.banned_reporters where reporter_hash=h and reason='owner_imposed_test_ban') then raise exception 'manual ban removed'; end if;
 -- Erasing normal app data cannot erase a confirmed abuse history for the same identity.
 perform public.darbna_delete_me(a);
 if (select count(*) from darbna_private.report_reviews where reporter_hash=h and verdict in ('fake','abuse'))<>3 then raise exception 'abuse history erased'; end if;
end $$;
rollback;
select 'PASS: +2 credits, zero submission/clearance credits, flags require review, five distinct confirmed cases ban, duplicate/confirmation bypass blocked, appeals and retained moderation history; all fixtures rolled back' as integrity_test;
