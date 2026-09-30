begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- Instructor is an Academy capability on the existing Auth identity. It does
-- not require or grant the unrelated orders/payment staff role.
alter table tlb.academy_instructors drop constraint academy_instructors_user_id_fkey;
alter table tlb.academy_instructors add constraint academy_instructors_user_id_fkey foreign key(user_id) references auth.users(id);

-- Short-lived response records contain only the calling account's mutations.
-- They are excluded from curriculum backups; all business records are backed up.
create table tlb.academy_action_requests (
 user_id uuid not null references auth.users(id), action text not null, key uuid not null,
 request_hash text not null, response jsonb not null, created_at timestamptz not null default now(),
 primary key(user_id,action,key)
);
alter table tlb.academy_action_requests enable row level security;
revoke all on tlb.academy_action_requests from public,anon,authenticated,service_role;
create index academy_action_request_expiry on tlb.academy_action_requests(created_at);

-- Every asset has exactly its intended content relation, so forged payloads
-- cannot smuggle private media into unrelated recipe/announcement responses.
alter table tlb.academy_portal_media add constraint academy_media_purpose_relations check (
 (purpose='submission' and class_id is not null and submission_id is not null and num_nonnulls(message_id,announcement_id,upcoming_id,recipe_id,module_id)=0) or
 (purpose='message' and class_id is not null and message_id is not null and num_nonnulls(submission_id,announcement_id,upcoming_id,recipe_id,module_id)=0) or
 (purpose='module' and class_id is not null and module_id is not null and num_nonnulls(submission_id,message_id,announcement_id,upcoming_id,recipe_id)=0) or
 (purpose='class' and class_id is not null and num_nonnulls(submission_id,message_id,announcement_id,upcoming_id,recipe_id,module_id)=0) or
 (purpose='recipe' and recipe_id is not null and num_nonnulls(class_id,submission_id,message_id,announcement_id,upcoming_id,module_id)=0) or
 (purpose='announcement' and announcement_id is not null and num_nonnulls(class_id,submission_id,message_id,recipe_id,upcoming_id,module_id)=0) or
 (purpose='upcoming' and upcoming_id is not null and num_nonnulls(class_id,submission_id,message_id,recipe_id,announcement_id,module_id)=0) or
 (purpose='instructor' and num_nonnulls(class_id,submission_id,message_id,recipe_id,announcement_id,upcoming_id,module_id)=0)
);

create or replace function tlb.academy_thread_access(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from tlb.academy_message_threads t where t.id=p_id and (((tlb.academy_owner() or tlb.academy_teaches(t.class_id)) and exists(select 1 from tlb.academy_messages x where x.thread_id=t.id and x.submitted)) or (t.user_id=auth.uid() and tlb.academy_enrolled(t.class_id))))
$$;
create or replace function tlb.academy_notify(p_user uuid,p_class uuid,p_type text,p_preview text,p_target uuid,p_attachments boolean default false) returns void language plpgsql security invoker set search_path='' as $$
 declare c tlb.academy_curricula;i tlb.academy_instructors;recipient text;
 begin
 select * into c from tlb.academy_curricula where id=p_class;select * into i from tlb.academy_instructors where user_id=c.instructor_id;
 if i.user_id is null or not i.active or not i.notifications then return;end if;
 select coalesce(nullif(i.notification_email,''),email) into recipient from auth.users where id=i.user_id;
 insert into tlb.outbox(event_key,event_type,to_email,subject,payload) values('academy:'||p_type||':'||p_target,'academy_notification',recipient,'TLB Academy · '||p_type,
 jsonb_build_object('event_type','academy_notification','title',p_type,'account_name',tlb.academy_display_name(p_user),'class_name',c.name,'preview',left(p_preview,180),'attachments',p_attachments,'target_id',p_target,'class_id',p_class,'recipient_id',i.user_id,'url',case when p_type in ('Private student submission','Student work for review') then 'https://thelittlebakerkitchen.com/academy/admin#submissions' else 'https://thelittlebakerkitchen.com/academy/admin#inbox' end)) on conflict(event_key) do nothing;
 end $$;
create or replace function tlb.academy_portal_base(p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
 #variable_conflict use_variable
 declare u uuid:=auth.uid();id uuid:=nullif(p_payload->>'id','')::uuid;cid uuid:=nullif(p_payload->>'class_id','')::uuid;rid uuid;mid uuid;
 c tlb.academy_curricula;s tlb.academy_submissions;t tlb.academy_message_threads;m tlb.academy_messages;r tlb.academy_student_recipes;a tlb.academy_portal_media;
 doc jsonb;result jsonb;item jsonb;row record;counted integer:=0;owner boolean;instructor boolean;now_at timestamptz:=clock_timestamp();
 begin
 perform tlb.academy_assert(u is not null and exists(select 1 from auth.users where auth.users.id=u));
 perform tlb.require(jsonb_typeof(p_payload)='object' and octet_length(p_payload::text)<1000000,'Request is too large.');
 owner:=tlb.academy_owner();instructor:=exists(select 1 from tlb.academy_instructors where user_id=u and active);
 if p_action='dashboard' then
 return jsonb_build_object('name',tlb.academy_display_name(u),'admin',owner,'instructor',instructor,
 'classes',(select coalesce(jsonb_agg(tlb.academy_class_card(x.id) order by x.name),'[]') from tlb.academy_curricula x where tlb.academy_enrolled(x.id)),
 'announcements',(select coalesce(jsonb_agg(to_jsonb(x) order by x.publish_at desc),'[]') from (select n.id,n.title,n.summary,n.thumbnail_id,n.publish_at,exists(select 1 from tlb.academy_announcement_reads ar where ar.user_id=u and ar.announcement_id=n.id) as read from tlb.academy_announcements n where n.status='published' and n.publish_at<=now() order by n.publish_at desc limit 30)x),
 'upcoming',(select coalesce(jsonb_agg(to_jsonb(x) order by x.starts_at nulls last),'[]') from(select * from tlb.academy_upcoming_classes where status='published' order by starts_at nulls last limit 30)x),
 'gallery',tlb.academy_gallery(),'academy_newsletter',coalesce((select academy from tlb.academy_newsletter_preferences where user_id=u),false));
 end if;
 if p_action='gallery' then return jsonb_build_object('posts',tlb.academy_gallery(cid,nullif(p_payload->>'category',''),coalesce((p_payload->>'offset')::int,0)),
 'classes',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name) order by x.name),'[]') from tlb.academy_curricula x where exists(select 1 from tlb.academy_submissions q where q.class_id=x.id and q.submitted and q.visibility='gallery' and q.moderation='approved')));end if;
 if p_action='announcement' then
 select to_jsonb(x) into result from tlb.academy_announcements x where x.id=id and x.status='published' and x.publish_at<=now();perform tlb.academy_assert(result is not null);
 insert into tlb.academy_announcement_reads(user_id,announcement_id) values(u,id) on conflict do nothing;return result;
 end if;
 if p_action='newsletter' then
 perform tlb.require(jsonb_typeof(p_payload->'academy')='boolean','Choose your Academy newsletter preference.');
 insert into tlb.academy_newsletter_preferences(user_id,academy) values(u,(p_payload->>'academy')::boolean) on conflict(user_id) do update set academy=excluded.academy,updated_at=now();
 return jsonb_build_object('academy',(p_payload->>'academy')::boolean);end if;
 if p_action='class' then
 perform tlb.academy_assert(tlb.academy_class_access(id));select * into strict c from tlb.academy_curricula where tlb.academy_curricula.id=id;
 return tlb.academy_class_card(id)||jsonb_build_object('notes',c.notes,'sharing_enabled',c.sharing_enabled,'gallery_enabled',c.gallery_enabled,'require_approval',c.require_approval,
 'modules',(select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_order,x.id),'[]') from tlb.academy_modules x where x.class_id=id),
 'recipes',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'title',x.title,'module_id',cr.module_id) order by cr.sort_order,x.title),'[]') from tlb.academy_class_recipes cr join tlb.academy_student_recipes x on x.id=cr.recipe_id where cr.class_id=id),
 'submissions',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') from(select q.id,q.title,q.visibility,q.moderation,q.submitted,q.created_at from tlb.academy_submissions q where q.class_id=id and q.user_id=u and q.moderation<>'removed' order by q.created_at desc limit 50)x));
 end if;
 if p_action='submission' then
 select * into s from tlb.academy_submissions where tlb.academy_submissions.id=id;
 perform tlb.academy_assert(s.moderation<>'removed' and (s.submitted or s.user_id=u) and ((s.user_id=u and tlb.academy_enrolled(s.class_id)) or owner or tlb.academy_teaches(s.class_id)));
 return jsonb_build_object('title',s.title,'caption',s.caption,'visibility',s.visibility,'moderation',s.moderation,'media',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id)),'[]') from tlb.academy_portal_media p where p.submission_id=id and p.uploaded));end if;
 if p_action='recipe' then
 perform tlb.academy_assert(tlb.academy_class_access(cid) and exists(select 1 from tlb.academy_class_recipes cr where cr.class_id=cid and cr.recipe_id=id));
 select jsonb_build_object('id',x.id,'title',x.title,'document',x.document,'media',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'path',p.path)),'[]') from tlb.academy_portal_media p where p.recipe_id=x.id and p.uploaded)) into result from tlb.academy_student_recipes x where x.id=id;return result;
 end if;
 if p_action='threads' then
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.last_activity desc) from(
 select q.id,q.class_id,q.subject,q.type,q.resolved,q.last_activity,cx.name as class_name,ix.display_name as instructor,
 (select count(*) from tlb.academy_messages mx where mx.thread_id=q.id and mx.submitted and mx.sender_id<>u and mx.created_at>coalesce((select read_at from tlb.academy_message_reads rr where rr.thread_id=q.id and rr.user_id=u),'-infinity')) as unread
 from tlb.academy_message_threads q join tlb.academy_curricula cx on cx.id=q.class_id left join tlb.academy_instructors ix on ix.user_id=cx.instructor_id
 where tlb.academy_thread_access(q.id) and (cid is null or q.class_id=cid) order by q.last_activity desc limit 100)x),'[]');
 end if;
 if p_action='thread' then
 perform tlb.academy_assert(tlb.academy_thread_access(id));
 select to_jsonb(q)||jsonb_build_object('account_name',tlb.academy_display_name(q.user_id),'class_name',cx.name,'instructor',ix.display_name,
 'messages',(select coalesce(jsonb_agg(jsonb_build_object('id',mx.id,'body',mx.body,'mine',mx.sender_id=u,'sender',case when mx.sender_id=q.user_id then tlb.academy_display_name(mx.sender_id) else coalesce((select display_name from tlb.academy_instructors where user_id=mx.sender_id),'Academy Admin') end,'created_at',mx.created_at,
 'media',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'path',p.path)),'[]') from tlb.academy_portal_media p where p.message_id=mx.id and p.uploaded)) order by mx.created_at,mx.id),'[]') from tlb.academy_messages mx where mx.thread_id=q.id and mx.submitted)) into result
 from tlb.academy_message_threads q join tlb.academy_curricula cx on cx.id=q.class_id left join tlb.academy_instructors ix on ix.user_id=cx.instructor_id where q.id=id;
 if coalesce((p_payload->>'mark_read')::boolean,true) then insert into tlb.academy_message_reads(thread_id,user_id,read_at) values(id,u,now_at) on conflict(thread_id,user_id) do update set read_at=greatest(tlb.academy_message_reads.read_at,excluded.read_at);end if;return result;
 end if;
 if p_action in ('start_thread','draft_reply') then
 perform tlb.require(length(btrim(p_payload->>'body')) between 1 and 10000,'Write a message of up to 10,000 characters.');
 if p_action='start_thread' then
 perform tlb.academy_assert(tlb.academy_enrolled(cid));select * into strict c from tlb.academy_curricula where tlb.academy_curricula.id=cid;
 perform tlb.academy_assert(exists(select 1 from tlb.academy_instructors where user_id=c.instructor_id and active));
 insert into tlb.academy_message_threads(user_id,class_id,instructor_id,module_id,recipe_id,subject,type) values(u,cid,c.instructor_id,nullif(p_payload->>'module_id','')::uuid,nullif(p_payload->>'recipe_id','')::uuid,p_payload->>'subject',coalesce(p_payload->>'type','message')) returning * into t;
 else perform tlb.academy_assert(tlb.academy_thread_access(id));select * into strict t from tlb.academy_message_threads where tlb.academy_message_threads.id=id;end if;
 if u=t.user_id then perform tlb.academy_assert(exists(select 1 from tlb.academy_curricula cx join tlb.academy_instructors ix on ix.user_id=cx.instructor_id where cx.id=t.class_id and ix.active));end if;
 insert into tlb.academy_messages(thread_id,sender_id,body) values(t.id,u,p_payload->>'body') returning * into m;
 return jsonb_build_object('thread_id',t.id,'id',m.id,'class_id',t.class_id);end if;
 if p_action='send_message' then
 select * into m from tlb.academy_messages where tlb.academy_messages.id=id for update;perform tlb.academy_assert(m.sender_id=u and tlb.academy_thread_access(m.thread_id));
 select * into strict t from tlb.academy_message_threads where tlb.academy_message_threads.id=m.thread_id;
 if m.submitted then return jsonb_build_object('id',t.id,'sent',true);end if;
 perform 1 from tlb.academy_curricula cx where cx.id=t.class_id for share;
 if u=t.user_id then perform tlb.require(exists(select 1 from tlb.academy_curricula cx join tlb.academy_instructors ix on ix.user_id=cx.instructor_id where cx.id=t.class_id and ix.active),'Your instructor is currently unavailable. Please try again later.');end if;
 perform tlb.require(not exists(select 1 from tlb.academy_portal_media x where x.message_id=id and not x.uploaded),'Finish or remove pending photo uploads before sending.');
 update tlb.academy_messages set submitted=true,created_at=now_at where tlb.academy_messages.id=id;
 update tlb.academy_message_threads set last_activity=now_at,resolved=false where tlb.academy_message_threads.id=t.id;
 if u=t.user_id then perform tlb.academy_notify(u,t.class_id,case t.type when 'question' then 'New question' else 'New message' end,m.body,m.id,exists(select 1 from tlb.academy_portal_media where message_id=m.id));
 else
 insert into tlb.outbox(event_key,event_type,to_email,subject,payload) select 'academy:reply:'||m.id,'academy_notification',email,'New reply from your TLB Academy instructor',jsonb_build_object('event_type','academy_notification','title','Your instructor replied','class_id',t.class_id,'recipient_id',t.user_id,'student_reply',true,'preview','A private reply is waiting in your Academy inbox.','url','https://thelittlebakerkitchen.com/academy/dashboard#thread/'||t.id) from auth.users where auth.users.id=t.user_id;
 end if;return jsonb_build_object('id',t.id,'sent',true);end if;
 if p_action='resolve_thread' then
 perform tlb.academy_assert(exists(select 1 from tlb.academy_message_threads where tlb.academy_message_threads.id=id and (owner or tlb.academy_teaches(class_id))));
 update tlb.academy_message_threads set resolved=coalesce((p_payload->>'resolved')::boolean,true) where tlb.academy_message_threads.id=id;return jsonb_build_object('saved',true);end if;
 if p_action='draft_submission' then
 perform tlb.academy_assert(tlb.academy_enrolled(cid));select * into strict c from tlb.academy_curricula where tlb.academy_curricula.id=cid;
 perform tlb.academy_assert(c.sharing_enabled and (p_payload->>'visibility'='instructor' or c.gallery_enabled));
 perform tlb.require(length(coalesce(p_payload->>'caption',''))<=5000,'Use a caption up to 5,000 characters.');
 insert into tlb.academy_submissions(user_id,class_id,module_id,recipe_id,title,caption,category,visibility,show_name) values(u,cid,nullif(p_payload->>'module_id','')::uuid,nullif(p_payload->>'recipe_id','')::uuid,p_payload->>'title',coalesce(p_payload->>'caption',''),left(coalesce(p_payload->>'category','Other'),80),p_payload->>'visibility',coalesce((p_payload->>'show_name')::boolean,true)) returning * into s;return to_jsonb(s);end if;
 if p_action='submit_work' then
 select * into s from tlb.academy_submissions where tlb.academy_submissions.id=id for update;perform tlb.academy_assert(s.user_id=u and tlb.academy_enrolled(s.class_id));
 select * into strict c from tlb.academy_curricula where tlb.academy_curricula.id=s.class_id for share;perform tlb.academy_assert(c.sharing_enabled and (s.visibility='instructor' or c.gallery_enabled));
 if s.submitted then return to_jsonb(s);end if;
 perform tlb.require(exists(select 1 from tlb.academy_portal_media where submission_id=id and uploaded),'Add at least one photo.');
 perform tlb.require(not exists(select 1 from tlb.academy_portal_media where submission_id=id and not uploaded),'Finish or remove pending photo uploads before sharing.');
 update tlb.academy_submissions set submitted=true,moderation=case when s.visibility='gallery' and not c.require_approval then 'approved' else 'pending' end,published_at=case when s.visibility='gallery' and not c.require_approval then now() end where tlb.academy_submissions.id=id returning * into s;
 perform tlb.academy_notify(u,s.class_id,case s.visibility when 'instructor' then 'Private student submission' else 'Student work for review' end,s.caption,s.id,true);return to_jsonb(s);end if;
 if p_action='reserve_media' then
 id:=gen_random_uuid();
 if p_payload->>'purpose'='submission' then
 select * into s from tlb.academy_submissions where tlb.academy_submissions.id=(p_payload->>'submission_id')::uuid for update;
 perform tlb.academy_assert(s.user_id=u and not s.submitted and tlb.academy_enrolled(s.class_id));cid:=s.class_id;
 perform tlb.require((select count(*) from tlb.academy_portal_media where submission_id=s.id)<8,'Up to eight photos per submission.');
 elsif p_payload->>'purpose'='message' then
 select * into m from tlb.academy_messages where tlb.academy_messages.id=(p_payload->>'message_id')::uuid for update;
 perform tlb.academy_assert(m.sender_id=u and not m.submitted and tlb.academy_thread_access(m.thread_id));select class_id into cid from tlb.academy_message_threads where tlb.academy_message_threads.id=m.thread_id;
 perform tlb.require((select count(*) from tlb.academy_portal_media where message_id=m.id)<8,'Up to eight photos per message.');
 else perform tlb.academy_assert(owner);if p_payload->>'purpose'='module' then select class_id into strict cid from tlb.academy_modules where tlb.academy_modules.id=(p_payload->>'module_id')::uuid;end if;end if;
 insert into tlb.academy_portal_media(id,path,user_id,class_id,submission_id,message_id,announcement_id,upcoming_id,recipe_id,module_id,purpose,size_bytes,width,height)
 values(id,id||'.webp',u,cid,s.id,m.id,nullif(p_payload->>'announcement_id','')::uuid,nullif(p_payload->>'upcoming_id','')::uuid,nullif(p_payload->>'recipe_id','')::uuid,nullif(p_payload->>'module_id','')::uuid,p_payload->>'purpose',(p_payload->>'size_bytes')::int,(p_payload->>'width')::int,(p_payload->>'height')::int) returning * into a;return to_jsonb(a);end if;
 if p_action='cancel_media' then
 select * into a from tlb.academy_portal_media where tlb.academy_portal_media.id=id for update;
 perform tlb.academy_assert(a.user_id=u and not a.uploaded);
 delete from tlb.academy_portal_media where tlb.academy_portal_media.id=id;return jsonb_build_object('removed',true);end if;
 if p_action='media' then
 return coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'path',x.path)) from tlb.academy_portal_media x where x.id in(select value::uuid from jsonb_array_elements_text(coalesce(p_payload->'ids','[]'))) and public.academy_portal_media_readable(x.path)),'[]');end if;

 -- Instructor access is scoped here before any administrative dataset is read.
 if p_action='admin_bootstrap' then
 perform tlb.academy_assert(owner or instructor);
 return jsonb_build_object('owner',owner,'instructor',instructor,'classes',(select coalesce(jsonb_agg(to_jsonb(x) order by x.name),'[]') from tlb.academy_curricula x where owner or tlb.academy_teaches(x.id)),
 'instructors',(select coalesce(jsonb_agg(to_jsonb(i) order by i.display_name),'[]') from tlb.academy_instructors i where owner or i.user_id=u),
 'metrics',jsonb_build_object('active_classes',(select count(*) from tlb.academy_curricula x where x.status='active' and (owner or tlb.academy_teaches(x.id))),
 'archived_classes',(select count(*) from tlb.academy_curricula x where x.status='archived' and (owner or tlb.academy_teaches(x.id))),
 'active_instructors',(select count(*) from tlb.academy_instructors i where i.active and (owner or i.user_id=u)),
 'gallery_posts',(select count(*) from tlb.academy_submissions s where s.submitted and s.visibility='gallery' and s.moderation='approved' and (owner or tlb.academy_teaches(s.class_id))),
 'upcoming_classes',(select count(*) from tlb.academy_upcoming_classes where status='published'),
 'unread_messages',(select count(*) from tlb.academy_messages m join tlb.academy_message_threads t on t.id=m.thread_id where m.submitted and m.sender_id<>u and (owner or tlb.academy_teaches(t.class_id)) and m.created_at>coalesce((select read_at from tlb.academy_message_reads where thread_id=t.id and user_id=u),'-infinity')),
 'active_accounts',(select count(distinct e.user_id) from tlb.academy_enrollments e where e.status='active' and (owner or tlb.academy_teaches(e.class_id))),
 'accounts_with_history',(select count(distinct e.user_id) from tlb.academy_enrollments e where owner or tlb.academy_teaches(e.class_id)),
 'pending_gallery',(select count(*) from tlb.academy_submissions x where x.submitted and x.visibility='gallery' and x.moderation='pending' and (owner or tlb.academy_teaches(x.class_id))),
 'unanswered',(select count(*) from tlb.academy_message_threads q where not q.resolved and (owner or tlb.academy_teaches(q.class_id)) and not exists(select 1 from tlb.academy_messages mm where mm.thread_id=q.id and mm.submitted and mm.sender_id<>q.user_id)),
 'newsletter_subscribers',case when owner then(select count(*) from tlb.academy_newsletter_preferences where academy) else null end));end if;
 if p_action='admin_submissions' then
 perform tlb.academy_assert(owner or instructor);
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from(select q.*,cx.name as class_name,tlb.academy_display_name(q.user_id) as account_name,
 (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'path',p.path)),'[]') from tlb.academy_portal_media p where p.submission_id=q.id and p.uploaded) as media
 from tlb.academy_submissions q join tlb.academy_curricula cx on cx.id=q.class_id where q.submitted and (owner or tlb.academy_teaches(q.class_id)) and (cid is null or q.class_id=cid) and (nullif(p_payload->>'status','') is null or q.moderation=p_payload->>'status') order by q.created_at desc limit 100)x),'[]');end if;
 if p_action='moderate' then
 select * into s from tlb.academy_submissions where tlb.academy_submissions.id=id;perform tlb.academy_assert(s.submitted and (owner or tlb.academy_teaches(s.class_id)));
 perform tlb.require(s.visibility='gallery','Private submissions cannot be published to the gallery.');
 perform tlb.require(p_payload->>'status' in ('approved','hidden','archived','removed'),'Choose a moderation action.');
 update tlb.academy_submissions set moderation=p_payload->>'status',moderated_by=u,moderated_at=now(),published_at=case when p_payload->>'status'='approved' then coalesce(published_at,now()) else published_at end where tlb.academy_submissions.id=id;
 perform tlb.academy_log('gallery_'||(p_payload->>'status'),id);return jsonb_build_object('saved',true);end if;

 perform tlb.academy_assert(owner);
 if p_action='accounts' then
 p_payload:=jsonb_set(p_payload,'{query}',to_jsonb(btrim(coalesce(p_payload->>'query',''))));
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.name,x.email) from(select au.id,au.email,tlb.academy_display_name(au.id) as name,coalesce(nullif(au.raw_user_meta_data->>'phone',''),nullif(to_jsonb(au)->>'phone',''),(select o.data#>>'{buyer,phone}' from tlb.orders o where o.user_id=au.id and nullif(o.data#>>'{buyer,phone}','') is not null order by o.created_at desc limit 1),'') as phone,
 (select count(*) from tlb.academy_enrollments e where e.user_id=au.id and e.status='active') as classes,
 exists(select 1 from tlb.staff st where st.user_id=au.id) as admin_account
 from auth.users au where length(btrim(coalesce(p_payload->>'query','')))>=2 and (au.email ilike '%'||(p_payload->>'query')||'%' or tlb.academy_display_name(au.id) ilike '%'||(p_payload->>'query')||'%' or coalesce(nullif(au.raw_user_meta_data->>'phone',''),nullif(to_jsonb(au)->>'phone',''),(select o.data#>>'{buyer,phone}' from tlb.orders o where o.user_id=au.id and nullif(o.data#>>'{buyer,phone}','') is not null order by o.created_at desc limit 1),'') ilike '%'||(p_payload->>'query')||'%') order by au.created_at desc limit 50)x),'[]');end if;
 if p_action='account' then
 return jsonb_build_object('id',id,'name',tlb.academy_display_name(id),'email',(select email from auth.users where auth.users.id=id),
 'phone',(select coalesce(nullif(au.raw_user_meta_data->>'phone',''),nullif(to_jsonb(au)->>'phone',''),(select o.data#>>'{buyer,phone}' from tlb.orders o where o.user_id=au.id and nullif(o.data#>>'{buyer,phone}','') is not null order by o.created_at desc limit 1),'') from auth.users au where au.id=id),
 'enrollments',(select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('class_name',cx.name,'instructor',ix.display_name) order by e.assigned_at desc),'[]') from tlb.academy_enrollments e join tlb.academy_curricula cx on cx.id=e.class_id left join tlb.academy_instructors ix on ix.user_id=cx.instructor_id where e.user_id=id),
 'academy_newsletter',coalesce((select academy from tlb.academy_newsletter_preferences where user_id=id),false),
 'kitchen_newsletter',(select ns.status from tlb.newsletter_subscribers ns join auth.users au on lower(au.email)=ns.email where au.id=id),
 'submissions',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select q.id,q.title,q.visibility,q.moderation,q.created_at from tlb.academy_submissions q where q.user_id=id order by q.created_at desc limit 100)x),
 'threads',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select q.id,q.subject,q.last_activity from tlb.academy_message_threads q where q.user_id=id order by q.last_activity desc limit 100)x));end if;
 if p_action='assign' then
 perform tlb.require(exists(select 1 from tlb.academy_curricula where tlb.academy_curricula.id=cid and status='active'),'Choose an active class.');
 perform tlb.require(jsonb_array_length(p_payload->'user_ids') between 1 and 200,'Select 1–200 accounts.');
 for rid in select value::uuid from jsonb_array_elements_text(p_payload->'user_ids') loop
 insert into tlb.academy_enrollments(user_id,class_id,assigned_by) values(rid,cid,u) on conflict(user_id,class_id) where status='active' do nothing;
 if found then counted:=counted+1;perform tlb.academy_log('class_assigned',rid,jsonb_build_object('class_id',cid));end if;
 end loop;return jsonb_build_object('assigned',counted);end if;
 if p_action='revoke' then
 update tlb.academy_enrollments set status='revoked',removed_by=u,removed_at=now() where tlb.academy_enrollments.id=id and status='active';
 if found then perform tlb.academy_log('class_revoked',id);end if;return jsonb_build_object('saved',true);end if;
 if p_action='save_instructor' then
 perform tlb.require(exists(select 1 from auth.users where auth.users.id=id),'Choose an existing TLB account.');
 perform tlb.require(nullif(p_payload->>'notification_email','') is null or p_payload->>'notification_email' ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$','Enter a valid notification email.');
 insert into tlb.academy_instructors(user_id,display_name,title,bio,notification_email,active,notifications) values(id,p_payload->>'display_name',coalesce(p_payload->>'title',''),coalesce(p_payload->>'bio',''),nullif(p_payload->>'notification_email',''),coalesce((p_payload->>'active')::boolean,true),coalesce((p_payload->>'notifications')::boolean,true))
 on conflict(user_id) do update set display_name=excluded.display_name,title=excluded.title,bio=excluded.bio,notification_email=excluded.notification_email,active=excluded.active,notifications=excluded.notifications,updated_at=now();
 perform tlb.academy_log('instructor_updated',id);return jsonb_build_object('saved',true);end if;
 if p_action='save_class' then
 if id is null then insert into tlb.academy_curricula(name) values(p_payload->>'name') returning * into c;id:=c.id;
 else select * into strict c from tlb.academy_curricula where tlb.academy_curricula.id=id for update;perform tlb.require(c.revision=(p_payload->>'revision')::bigint,'This class changed. Reload before saving.');end if;
 perform tlb.require(p_payload->>'status'<>'active' or exists(select 1 from tlb.academy_instructors where user_id=(p_payload->>'instructor_id')::uuid and active),'Assign an active instructor first.');
 update tlb.academy_curricula set name=p_payload->>'name',description=coalesce(p_payload->>'description',''),instructor_id=nullif(p_payload->>'instructor_id','')::uuid,
 status=coalesce(p_payload->>'status','draft'),notes=coalesce(p_payload->>'notes',''),products=array(select jsonb_array_elements_text(coalesce(p_payload->'products','[]'))),
 sharing_enabled=coalesce((p_payload->>'sharing_enabled')::boolean,true),gallery_enabled=coalesce((p_payload->>'gallery_enabled')::boolean,true),require_approval=coalesce((p_payload->>'require_approval')::boolean,true),
 revision=revision+1,updated_at=now() where tlb.academy_curricula.id=id returning * into c;
 perform tlb.academy_log('class_saved',id,jsonb_build_object('status',c.status,'instructor_id',c.instructor_id));return to_jsonb(c);end if;
 if p_action='save_module' then
 perform tlb.require(exists(select 1 from tlb.academy_curricula where tlb.academy_curricula.id=cid),'Choose a class.');
 if id is null then insert into tlb.academy_modules(class_id,name) values(cid,p_payload->>'name') returning tlb.academy_modules.id into id;end if;
 update tlb.academy_modules set name=p_payload->>'name',description=coalesce(p_payload->>'description',''),products=array(select jsonb_array_elements_text(coalesce(p_payload->'products','[]'))),notes=coalesce(p_payload->>'notes',''),tips=coalesce(p_payload->>'tips',''),sort_order=coalesce((p_payload->>'sort_order')::int,0) where tlb.academy_modules.id=id and class_id=cid;
 perform tlb.require(found,'Module was not found in this class.');perform tlb.academy_log('module_saved',id);return jsonb_build_object('id',id);end if;
 if p_action='reorder_modules' then
 perform 1 from tlb.academy_curricula cx where cx.id=cid for update;
 perform tlb.require(jsonb_typeof(p_payload->'ids')='array','Choose the modules to reorder.');
 perform tlb.require(jsonb_array_length(p_payload->'ids')=(select count(*) from tlb.academy_modules where class_id=cid) and jsonb_array_length(p_payload->'ids')=(select count(distinct value) from jsonb_array_elements_text(p_payload->'ids')) and not exists(select 1 from jsonb_array_elements_text(p_payload->'ids') x where not exists(select 1 from tlb.academy_modules where class_id=cid and tlb.academy_modules.id=x.value::uuid)),'Reload the class before reordering its modules.');
 for item in select value from jsonb_array_elements(p_payload->'ids') loop update tlb.academy_modules set sort_order=counted where tlb.academy_modules.id=(item#>>'{}')::uuid and class_id=cid;counted:=counted+1;end loop;return jsonb_build_object('saved',true);end if;
 if p_action='admin_recipes' then return coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'title',x.title,'revision',x.revision) order by x.title) from tlb.academy_student_recipes x),'[]');end if;
 if p_action='admin_recipe' then select to_jsonb(x)||jsonb_build_object('versions',(select coalesce(jsonb_agg(to_jsonb(v) order by v.version desc),'[]') from tlb.academy_student_recipe_versions v where v.recipe_id=x.id)) into result from tlb.academy_student_recipes x where x.id=id;return result;end if;
 if p_action='recipe_source_photos' then
 select source_version_id into rid from tlb.academy_student_recipes where tlb.academy_student_recipes.id=id;
 return coalesce((select jsonb_agg(jsonb_build_object('path',f.path,'name',f.filename)) from tlb.recipe_files f where f.uploaded and f.mime_type in ('image/jpeg','image/png','image/webp') and f.id in(
 select (p->>'file_id')::uuid from tlb.recipe_versions v cross join lateral jsonb_array_elements(coalesce(v.document->'photos','[]')||coalesce((select jsonb_agg(p) from jsonb_array_elements(v.document->'variants') x cross join lateral jsonb_array_elements(coalesce(x->'photos','[]')) p),'[]')) p where v.id=rid
 )),'[]');end if;
 if p_action='production_recipes' then
 return coalesce((select jsonb_agg(to_jsonb(x)) from(select v.id as version_id,rp.name,v.number,v.status from tlb.recipe_versions v join tlb.recipes rp on rp.id=v.recipe_id where rp.deleted_at is null and rp.name ilike '%'||coalesce(p_payload->>'query','')||'%' order by rp.name,v.number desc limit 100)x),'[]');end if;
 if p_action in ('save_recipe','import_recipe') then
 if p_action='import_recipe' then
 rid:=(p_payload->>'version_id')::uuid;select document into strict doc from tlb.recipe_versions where tlb.recipe_versions.id=rid;
 insert into tlb.academy_student_recipes(title,document,source_version_id) values(coalesce(nullif(p_payload->>'title',''),doc->>'name'),tlb.academy_import_document(rid),rid) returning * into r;
 else
 doc:=tlb.academy_recipe_document(p_payload->'document');
 if id is null then insert into tlb.academy_student_recipes(title,document) values(p_payload->>'title',doc) returning * into r;
 else update tlb.academy_student_recipes set title=p_payload->>'title',document=doc,revision=revision+1,updated_at=now() where tlb.academy_student_recipes.id=id and revision=(p_payload->>'revision')::bigint returning * into r;perform tlb.require(found,'This recipe changed. Reload before saving.');end if;end if;
 insert into tlb.academy_student_recipe_versions(recipe_id,version,title,document,saved_by) values(r.id,r.revision,r.title,r.document,u);
 perform tlb.academy_log(p_action,r.id);return to_jsonb(r);end if;
 if p_action='assign_recipe' then
 insert into tlb.academy_class_recipes(class_id,recipe_id,module_id) values(cid,(p_payload->>'recipe_id')::uuid,nullif(p_payload->>'module_id','')::uuid) on conflict(class_id,recipe_id) do update set module_id=excluded.module_id;return jsonb_build_object('saved',true);end if;
 if p_action='unlink_recipe' then
 delete from tlb.academy_class_recipes cr where cr.class_id=cid and cr.recipe_id=(p_payload->>'recipe_id')::uuid;return jsonb_build_object('saved',true);end if;
 if p_action in ('admin_announcements','admin_upcoming','admin_broadcasts') then
 if p_action='admin_announcements' then return coalesce((select jsonb_agg(to_jsonb(x) order by x.publish_at desc) from tlb.academy_announcements x),'[]');
 elsif p_action='admin_upcoming' then return coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_at nulls last) from tlb.academy_upcoming_classes x),'[]');
 else return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from(select * from tlb.academy_broadcasts order by created_at desc limit 100)x),'[]');end if;end if;
 if p_action='save_announcement' then
 perform tlb.require(length(btrim(p_payload->>'title')) between 1 and 160,'Enter a title of up to 160 characters.');
 if id is null then insert into tlb.academy_announcements(title) values(p_payload->>'title') returning tlb.academy_announcements.id into id;
 else perform 1 from tlb.academy_announcements x where x.id=id for update;perform tlb.require(exists(select 1 from tlb.academy_announcements x where x.id=id and x.revision=(p_payload->>'revision')::bigint),'Announcement changed. Reload before saving.');end if;
 update tlb.academy_announcements set title=p_payload->>'title',summary=coalesce(p_payload->>'summary',''),content=coalesce(p_payload->>'content',''),cta=coalesce(p_payload->>'cta',''),cta_url=tlb.academy_url(coalesce(p_payload->>'cta_url','')),status=p_payload->>'status',publish_at=coalesce(nullif(p_payload->>'publish_at','')::timestamptz,now()),revision=revision+1 where tlb.academy_announcements.id=id;
 perform tlb.academy_log('announcement_saved',id,jsonb_build_object('status',p_payload->>'status'));return jsonb_build_object('id',id);end if;
 if p_action='save_upcoming' then
 perform tlb.require(length(btrim(p_payload->>'title')) between 1 and 160,'Enter a title of up to 160 characters.');
 if id is null then insert into tlb.academy_upcoming_classes(title) values(p_payload->>'title') returning tlb.academy_upcoming_classes.id into id;
 else perform 1 from tlb.academy_upcoming_classes x where x.id=id for update;perform tlb.require(exists(select 1 from tlb.academy_upcoming_classes x where x.id=id and x.revision=(p_payload->>'revision')::bigint),'Upcoming class changed. Reload before saving.');end if;
 update tlb.academy_upcoming_classes set title=p_payload->>'title',description=coalesce(p_payload->>'description',''),products=array(select jsonb_array_elements_text(coalesce(p_payload->'products','[]'))),schedule=coalesce(p_payload->>'schedule',''),starts_at=nullif(p_payload->>'starts_at','')::timestamptz,cta=coalesce(p_payload->>'cta','Inquire about this class'),inquiry_url=tlb.academy_url(coalesce(p_payload->>'inquiry_url','')),status=p_payload->>'status',revision=revision+1 where tlb.academy_upcoming_classes.id=id;
 perform tlb.academy_log('upcoming_saved',id);return jsonb_build_object('id',id);end if;
 if p_action='attach_media' then
 select * into strict a from tlb.academy_portal_media where tlb.academy_portal_media.id=id and uploaded;
 if a.purpose='class' then update tlb.academy_curricula set thumbnail_id=a.id where tlb.academy_curricula.id=a.class_id;
 elsif a.purpose='module' then update tlb.academy_modules set photo_ids=array_append(array_remove(photo_ids,a.id),a.id) where tlb.academy_modules.id=a.module_id;
 elsif a.purpose='announcement' then update tlb.academy_announcements set thumbnail_id=a.id where tlb.academy_announcements.id=a.announcement_id;
 elsif a.purpose='upcoming' then update tlb.academy_upcoming_classes set thumbnail_id=a.id where tlb.academy_upcoming_classes.id=a.upcoming_id;
 elsif a.purpose='instructor' then update tlb.academy_instructors set photo_id=a.id where user_id=(p_payload->>'instructor_id')::uuid;end if;return jsonb_build_object('saved',true);end if;
 if p_action='invite' then
 perform tlb.require(p_payload->>'email' ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$','Enter a valid email.');
 id:=gen_random_uuid();insert into tlb.outbox(event_key,event_type,to_email,subject,payload) values('academy:invite:'||id,'academy_invitation',lower(btrim(p_payload->>'email')),'You are invited to TLB Academy',jsonb_build_object('event_type','academy_invitation','title','Welcome to TLB Academy','account_name',left(p_payload->>'name',120),'preview','Create your regular TLB account to access Academy updates and your assigned classes.','url','https://thelittlebakerkitchen.com/account.html?mode=signup&next=%2Facademy%2Fdashboard'));
 perform tlb.academy_log('account_invited',id);return jsonb_build_object('queued',true);end if;
 if p_action='analytics' then
 return jsonb_build_object('classes',(select coalesce(jsonb_agg(to_jsonb(x) order by x.active_accounts desc),'[]') from(select cx.id,cx.name,cx.status,ix.display_name as instructor,(select count(*) from tlb.academy_enrollments e where e.class_id=cx.id and e.status='active') as active_accounts,(select count(*) from tlb.academy_enrollments e where e.class_id=cx.id) as historical_assignments from tlb.academy_curricula cx left join tlb.academy_instructors ix on ix.user_id=cx.instructor_id)x),
 'audit',(select coalesce(jsonb_agg(to_jsonb(x) order by x.at desc),'[]') from(select audit_row.*,tlb.academy_display_name(audit_row.actor_id) as actor_name from tlb.academy_audit audit_row order by audit_row.at desc limit 100)x));end if;
 raise exception 'Unknown Academy action.' using errcode='22023';
 end $$;

-- Preserve the existing broadcast and owner API while adding request replay
-- protection. Legacy requests without a key still work; new browser forms send
-- a stable key. Broadcasts require one because they queue external delivery.
alter function public.academy_portal_api(text,jsonb) rename to academy_portal_dispatch;
alter function public.academy_portal_dispatch(text,jsonb) set schema tlb;
revoke all on function tlb.academy_portal_dispatch(text,jsonb) from public,anon,authenticated,service_role;
create function public.academy_portal_api(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); k uuid; hashed text; cached tlb.academy_action_requests; result jsonb; target uuid; stamp timestamptz;
begin
 perform tlb.academy_assert(u is not null and exists(select 1 from auth.users where id=u));
 perform tlb.require(jsonb_typeof(p_payload)='object' and octet_length(p_payload::text)<1000000,'Request is too large.');
 if p_action='thread_status' then
  target:=(p_payload->>'id')::uuid;perform tlb.academy_assert(tlb.academy_thread_access(target));
  return (select jsonb_build_object('last_activity',last_activity) from tlb.academy_message_threads where id=target);
 end if;
 if p_action='read_thread' then
  target:=(p_payload->>'id')::uuid;perform tlb.academy_assert(tlb.academy_thread_access(target));
  select created_at into stamp from tlb.academy_messages where id=(p_payload->>'message_id')::uuid and thread_id=target and submitted;
  if stamp is not null then insert into tlb.academy_message_reads(thread_id,user_id,read_at) values(target,u,stamp) on conflict(thread_id,user_id) do update set read_at=greatest(tlb.academy_message_reads.read_at,excluded.read_at);end if;
  return jsonb_build_object('saved',true);
 end if;
 k:=nullif(p_payload->>'idempotency_key','')::uuid;
 if p_action='broadcast_send' then perform tlb.require(k is not null,'Review the broadcast again before sending.');end if;
 if k is null or p_action not in ('start_thread','draft_reply','draft_submission','save_class','save_module','save_recipe','import_recipe','save_announcement','save_upcoming','save_instructor','broadcast_send','invite') then
  return tlb.academy_portal_dispatch(p_action,p_payload);
 end if;
 -- Re-authorize replay requests; a saved response never restores revoked access.
 if p_action in ('start_thread','draft_submission') then
  target:=(p_payload->>'class_id')::uuid;perform tlb.academy_assert(tlb.academy_enrolled(target));
 elsif p_action='draft_reply' then perform tlb.academy_assert(tlb.academy_thread_access((p_payload->>'id')::uuid));
 else perform tlb.academy_assert(tlb.academy_owner());end if;
 perform pg_advisory_xact_lock(hashtextextended('academy-action:'||u||':'||p_action||':'||k,0));
 hashed:=encode(extensions.digest((p_payload-'idempotency_key')::text,'sha256'),'hex');
 select * into cached from tlb.academy_action_requests where user_id=u and action=p_action and key=k;
 if found then perform tlb.require(cached.request_hash=hashed,'This request changed. Reload before trying again.');return cached.response;end if;
 result:=tlb.academy_portal_dispatch(p_action,p_payload);
 insert into tlb.academy_action_requests(user_id,action,key,request_hash,response) values(u,p_action,k,hashed,result);
 return result;
end $$;
revoke all on function public.academy_portal_api(text,jsonb) from public,anon,service_role;
grant execute on function public.academy_portal_api(text,jsonb) to authenticated;

-- Idempotency entries are retained long enough for interrupted sessions and
-- removed in bounded batches by a private hourly maintenance job.
create or replace function tlb.academy_prune_requests() returns void language sql security invoker set search_path='' as $$
 delete from tlb.academy_action_requests where (user_id,action,key) in (select user_id,action,key from tlb.academy_action_requests where created_at<now()-interval '30 days' order by created_at limit 1000)
$$;
revoke all on function tlb.academy_prune_requests() from public,anon,authenticated,service_role;
do $hook$ begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.schedule('tlb-academy-request-cleanup','13 * * * *','select tlb.academy_prune_requests();');
 end if;
end $hook$;
commit;
