begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- These projections reuse the same live membership/teaching checks as the
-- existing portal. They expose no production recipe or broader account data.
create or replace function tlb.academy_class_card(p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',c.id,'name',c.name,'description',c.description,
  'thumbnail_id',c.thumbnail_id,'products',c.products,'instructor',i.display_name,'instructor_title',i.title,
  'module_count',(select count(*) from tlb.academy_modules m where m.class_id=c.id),
  'unread',(select count(*) from tlb.academy_messages m join tlb.academy_message_threads t on t.id=m.thread_id
   where t.class_id=c.id and t.user_id=auth.uid() and m.submitted and m.sender_id<>auth.uid()
   and m.created_at>coalesce((select read_at from tlb.academy_message_reads where thread_id=t.id and user_id=auth.uid()),'-infinity')),
  'recipe_shortcut',(select jsonb_build_object('id',r.id,'title',r.title)
   from tlb.academy_class_recipes cr join tlb.academy_student_recipes r on r.id=cr.recipe_id
   left join tlb.academy_modules m on m.id=cr.module_id and m.class_id=cr.class_id
   where cr.class_id=c.id and tlb.academy_enrolled(c.id)
   order by m.sort_order nulls last,cr.sort_order,r.title,r.id limit 1),
  'reply_thread_id',(select t.id from tlb.academy_message_threads t
   where t.class_id=c.id and t.user_id=auth.uid() and tlb.academy_enrolled(c.id)
   and exists(select 1 from tlb.academy_messages m where m.thread_id=t.id and m.submitted and m.sender_id<>auth.uid()
    and m.created_at>coalesce((select read_at from tlb.academy_message_reads where thread_id=t.id and user_id=auth.uid()),'-infinity'))
   order by t.last_activity desc,t.id limit 1))
 from tlb.academy_curricula c left join tlb.academy_instructors i on i.user_id=c.instructor_id where c.id=p_id
$$;

create function tlb.academy_ux_read(p_action text,p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare u uuid:=auth.uid(); target uuid:=nullif(p_payload->>'id','')::uuid; result jsonb;
begin
 perform tlb.academy_assert(u is not null and exists(select 1 from auth.users where id=u));
 if p_action='navigation' then
  return jsonb_build_object('name',tlb.academy_display_name(u),'admin',tlb.academy_owner(),
   'instructor',exists(select 1 from tlb.academy_instructors where user_id=u and active),
   'classes',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) order by c.name),'[]')
    from tlb.academy_curricula c where tlb.academy_enrolled(c.id)));
 end if;
 if p_action='gallery_post' then
  select jsonb_build_object('id',s.id,'title',s.title,'caption',s.caption,'category',s.category,
   'class_name',c.name,'module_name',m.name,'recipe_title',r.title,
   'display_name',case when s.show_name then tlb.academy_display_name(s.user_id,true) else 'Academy member' end,
   'published_at',s.published_at,'media',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'width',p.width,'height',p.height) order by p.created_at,p.id),'[]')
    from tlb.academy_portal_media p where p.submission_id=s.id and p.uploaded)) into result
  from tlb.academy_submissions s join tlb.academy_curricula c on c.id=s.class_id
  left join tlb.academy_modules m on m.id=s.module_id and m.class_id=s.class_id
  left join tlb.academy_student_recipes r on r.id=s.recipe_id and exists(select 1 from tlb.academy_class_recipes cr where cr.class_id=s.class_id and cr.recipe_id=r.id)
  where s.id=target and s.submitted and s.visibility='gallery' and s.moderation='approved';
  perform tlb.academy_assert(result is not null);return result;
 end if;
 if p_action='threads' then
  perform tlb.require(coalesce(p_payload->>'filter','all') in ('all','needs_reply','resolved'),'Choose a conversation filter.');
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.last_activity desc,x.id) from(
   select t.id,t.class_id,t.subject,t.type,t.resolved,t.last_activity,c.name as class_name,
    i.display_name as instructor,tlb.academy_display_name(t.user_id) as account_name,
    r.title as recipe_title,m.name as module_name,
    (not t.resolved and latest.sender_id=t.user_id) as needs_reply,
    (select count(*) from tlb.academy_messages q where q.thread_id=t.id and q.submitted and q.sender_id<>u
     and q.created_at>coalesce((select read_at from tlb.academy_message_reads rr where rr.thread_id=t.id and rr.user_id=u),'-infinity')) as unread
   from tlb.academy_message_threads t join tlb.academy_curricula c on c.id=t.class_id
   left join tlb.academy_instructors i on i.user_id=c.instructor_id
   join lateral(select q.sender_id from tlb.academy_messages q where q.thread_id=t.id and q.submitted order by q.created_at desc,q.id desc limit 1) latest on true
   left join tlb.academy_modules m on m.id=t.module_id and m.class_id=t.class_id
   left join tlb.academy_student_recipes r on r.id=t.recipe_id and exists(select 1 from tlb.academy_class_recipes cr where cr.class_id=t.class_id and cr.recipe_id=r.id)
   where tlb.academy_thread_access(t.id)
    and (nullif(p_payload->>'class_id','') is null or t.class_id=(p_payload->>'class_id')::uuid)
    and (coalesce(p_payload->>'filter','all')='all'
      or (p_payload->>'filter'='needs_reply' and not t.resolved and latest.sender_id=t.user_id)
      or (p_payload->>'filter'='resolved' and t.resolved))
   order by t.last_activity desc,t.id limit 100)x),'[]');
 end if;
 if p_action='thread_status' then
  perform tlb.academy_assert(tlb.academy_thread_access(target));
  return (select jsonb_build_object('last_activity',t.last_activity,'resolved',t.resolved,
   'last_message_id',(select q.id from tlb.academy_messages q where q.thread_id=t.id and q.submitted order by q.created_at desc,q.id desc limit 1))
   from tlb.academy_message_threads t where t.id=target);
 end if;
 raise exception 'Unknown Academy view.' using errcode='22023';
end $$;
revoke all on function tlb.academy_ux_read(text,jsonb) from public,anon,authenticated,service_role;

-- Keep mutation replay, broadcasts, role checks and read boundaries intact.
do $migration$
declare definition text:=replace(pg_get_functiondef('public.academy_portal_api(text,jsonb)'::regprocedure),E'\r\n',E'\n');
 anchor text:=$anchor$ if p_action='thread_status' then$anchor$;
 hook text:=$hook$ if p_action in ('navigation','gallery_post','threads','thread_status') then
  return tlb.academy_ux_read(p_action,p_payload);
 end if;
 if p_action in ('start_thread','draft_submission') then
  if nullif(p_payload->>'module_id','') is not null then
   perform tlb.academy_assert(exists(select 1 from tlb.academy_modules where id=(p_payload->>'module_id')::uuid and class_id=(p_payload->>'class_id')::uuid));
  end if;
  if nullif(p_payload->>'recipe_id','') is not null then
   perform tlb.academy_assert(exists(select 1 from tlb.academy_class_recipes where recipe_id=(p_payload->>'recipe_id')::uuid and class_id=(p_payload->>'class_id')::uuid));
  end if;
 end if;
$hook$;
begin
 if position(anchor in definition)=0 then raise exception 'Review Academy API before adding UX projections';end if;
 execute replace(definition,anchor,hook||anchor);
end $migration$;
revoke all on function public.academy_portal_api(text,jsonb) from public,anon,service_role;
grant execute on function public.academy_portal_api(text,jsonb) to authenticated;
commit;
