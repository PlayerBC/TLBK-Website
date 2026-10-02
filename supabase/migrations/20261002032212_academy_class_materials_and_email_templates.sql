begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create table tlb.academy_class_materials (
 id uuid primary key, class_id uuid not null references tlb.academy_curricula(id),
 title text not null check(length(btrim(title)) between 1 and 160),
 description text not null default '' check(length(description)<=2000),
 file_name text not null check(length(file_name) between 1 and 180 and file_name !~ '[[:cntrl:]/\\]'),
 extension text not null check(extension in ('pdf','doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp','csv','txt','zip','png','jpg','jpeg','webp','heic','svg')),
 size_bytes bigint not null check(size_bytes between 1 and 26214400),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 path text not null unique check(path=id::text||'.'||extension),
 uploaded boolean not null default false, removed_at timestamptz,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 check(lower(right(file_name,length(extension)+1))='.'||extension)
);
create index academy_class_materials_class on tlb.academy_class_materials(class_id,created_at,id);
create index academy_class_materials_creator on tlb.academy_class_materials(created_by);
alter table tlb.academy_class_materials enable row level security;
revoke all on tlb.academy_class_materials from public,anon,authenticated,service_role;
create policy academy_material_metadata_api_only on tlb.academy_class_materials for select to authenticated using(false);

-- All files are served as attachments. No documents or SVGs are rendered as
-- trusted HTML, and no public or bearer signed URLs are issued by the client.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('academy-class-materials','academy-class-materials',false,26214400,array['application/octet-stream']);
create function tlb.academy_material_storage_access(p_path text,p_write boolean default false,p_delete boolean default false)
 returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from tlb.academy_class_materials m where m.path=p_path and
  case when p_delete then tlb.academy_owner() when p_write then tlb.academy_owner() and m.created_by=auth.uid() and not m.uploaded and m.removed_at is null
  else tlb.academy_owner() or (m.uploaded and m.removed_at is null and tlb.academy_class_access(m.class_id)) end)
$$;
revoke all on function tlb.academy_material_storage_access(text,boolean,boolean) from public,anon,service_role;
grant execute on function tlb.academy_material_storage_access(text,boolean,boolean) to authenticated;
create policy academy_material_read on storage.objects for select to authenticated
 using(bucket_id='academy-class-materials' and tlb.academy_material_storage_access(name));
create policy academy_material_insert on storage.objects for insert to authenticated
 with check(bucket_id='academy-class-materials' and tlb.academy_material_storage_access(name,true));
create policy academy_material_delete on storage.objects for delete to authenticated
 using(bucket_id='academy-class-materials' and tlb.academy_material_storage_access(name,false,true));

create table tlb.academy_email_templates (
 id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('marketing','operational')),
 name text not null check(length(btrim(name)) between 1 and 80),
 subject text not null check(length(btrim(subject)) between 1 and 160),
 body text not null check(length(btrim(body)) between 1 and 10000),
 revision integer not null default 1,created_by uuid not null references auth.users(id),updated_at timestamptz not null default now()
);
create index academy_email_templates_creator on tlb.academy_email_templates(created_by);
alter table tlb.academy_email_templates enable row level security;
revoke all on tlb.academy_email_templates from public,anon,authenticated,service_role;
create policy academy_email_template_api_only on tlb.academy_email_templates for select to authenticated using(false);

create function tlb.academy_resources_api(p_action text,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare u uuid:=auth.uid();target uuid:=nullif(p_payload->>'id','')::uuid;cid uuid:=nullif(p_payload->>'class_id','')::uuid;
 m tlb.academy_class_materials;t tlb.academy_email_templates;result jsonb;ext text;
begin
 perform tlb.academy_assert(u is not null and exists(select 1 from auth.users where id=u));
 perform tlb.require(jsonb_typeof(p_payload)='object' and octet_length(p_payload::text)<100000,'Request is too large.');
 if p_action='materials' then
  perform tlb.academy_assert(tlb.academy_class_access(cid));
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from(select id,title,description,file_name,size_bytes,created_at from tlb.academy_class_materials where class_id=cid and uploaded and removed_at is null)x),'[]');
 end if;
 if p_action='material' then
  select * into m from tlb.academy_class_materials where id=target;
  perform tlb.academy_assert(m.uploaded and m.removed_at is null and tlb.academy_class_access(m.class_id));
  return jsonb_build_object('id',m.id,'title',m.title,'file_name',m.file_name,'size_bytes',m.size_bytes,'path',m.path);
 end if;
 perform tlb.academy_assert(tlb.academy_owner());
 if p_action='reserve_material' then
  perform tlb.require(exists(select 1 from tlb.academy_curricula where id=cid),'Choose a class.');
  ext:=lower(substring(p_payload->>'file_name' from '\.([^.]+)$'));
  select * into m from tlb.academy_class_materials where id=target;
  if found then
   perform tlb.academy_assert(m.created_by=u and m.class_id=cid and m.removed_at is null);
   perform tlb.require(m.file_name=p_payload->>'file_name' and m.size_bytes=(p_payload->>'size_bytes')::bigint and m.sha256=p_payload->>'sha256','This upload is reserved for a different file.');
   return jsonb_build_object('id',m.id,'path',m.path,'uploaded',m.uploaded);
  end if;
  insert into tlb.academy_class_materials(id,class_id,title,description,file_name,extension,size_bytes,sha256,path,created_by)
   values(target,cid,btrim(p_payload->>'title'),coalesce(p_payload->>'description',''),p_payload->>'file_name',ext,(p_payload->>'size_bytes')::bigint,p_payload->>'sha256',target::text||'.'||ext,u) returning * into m;
  return jsonb_build_object('id',m.id,'path',m.path,'uploaded',false);
 end if;
 if p_action in ('publish_material','save_material','remove_material') then
  select * into m from tlb.academy_class_materials where id=target for update;
  perform tlb.academy_assert(m.id is not null);
  if p_action='remove_material' then
   update tlb.academy_class_materials set removed_at=coalesce(removed_at,now()) where id=target;
   perform tlb.academy_log('material_removed',target);return jsonb_build_object('id',m.id,'path',m.path);
  end if;
  perform tlb.academy_assert(m.removed_at is null);
  if p_action='publish_material' then
   perform tlb.require(exists(select 1 from storage.objects where bucket_id='academy-class-materials' and name=m.path and (metadata->>'size')::bigint=m.size_bytes and metadata->>'mimetype'='application/octet-stream'),'The file upload is incomplete. Please retry.');
   if not m.uploaded then update tlb.academy_class_materials set uploaded=true where id=target;perform tlb.academy_log('material_uploaded',target,jsonb_build_object('class_id',m.class_id));end if;
  else
   update tlb.academy_class_materials set title=btrim(p_payload->>'title'),description=coalesce(p_payload->>'description','') where id=target;
  end if;
  return jsonb_build_object('id',m.id,'uploaded',true);
 end if;
 if p_action='email_templates' then
  perform tlb.require(p_payload->>'kind' in ('marketing','operational'),'Choose an email type.');
  return jsonb_build_object('templates',coalesce((select jsonb_agg(to_jsonb(x) order by x.name,x.id) from tlb.academy_email_templates x where kind=p_payload->>'kind'),'[]'),'address',(select data->>'pickup_address' from tlb.settings where id));
 end if;
 if p_action='save_email_template' then
  if target is null then
   select * into t from tlb.academy_email_templates where id=nullif(p_payload->>'request_key','')::uuid;
   if found then
    perform tlb.require(t.created_by=u and t.kind=p_payload->>'kind' and t.name=btrim(p_payload->>'name') and t.subject=btrim(p_payload->>'subject') and t.body=btrim(p_payload->>'body'),'This save request has different template content. Close and save it again.');
    return to_jsonb(t);
   end if;
   insert into tlb.academy_email_templates(id,kind,name,subject,body,created_by) values(coalesce(nullif(p_payload->>'request_key','')::uuid,gen_random_uuid()),p_payload->>'kind',btrim(p_payload->>'name'),btrim(p_payload->>'subject'),btrim(p_payload->>'body'),u) returning * into t;
  else
   select * into t from tlb.academy_email_templates where id=target for update;
   perform tlb.academy_assert(t.id is not null);
   perform tlb.require(t.revision=(p_payload->>'revision')::integer,'This template was changed elsewhere. Reopen it before saving.');
   update tlb.academy_email_templates set name=btrim(p_payload->>'name'),subject=btrim(p_payload->>'subject'),body=btrim(p_payload->>'body'),revision=revision+1,updated_at=now() where id=target returning * into t;
  end if;
  perform tlb.academy_log('email_template_saved',t.id);return to_jsonb(t);
 end if;
 if p_action='delete_email_template' then
  delete from tlb.academy_email_templates where id=target;
  perform tlb.academy_log('email_template_deleted',target);return jsonb_build_object('deleted',true);
 end if;
 raise exception 'Unknown Academy resource action.' using errcode='22023';
end $$;
revoke all on function tlb.academy_resources_api(text,jsonb) from public,anon,authenticated,service_role;

do $migration$
declare definition text:=replace(pg_get_functiondef('public.academy_portal_api(text,jsonb)'::regprocedure),E'\r\n',E'\n');
 anchor text:=$anchor$ if p_action in ('navigation','gallery_post','threads','thread_status') then$anchor$;
 hook text:=$hook$ if p_action in ('materials','material','reserve_material','publish_material','save_material','remove_material','email_templates','save_email_template','delete_email_template') then
  return tlb.academy_resources_api(p_action,p_payload);
 end if;
$hook$;
begin
 if position(anchor in definition)=0 then raise exception 'Review Academy API before adding class resources';end if;
 execute replace(definition,anchor,hook||anchor);
end $migration$;
revoke all on function public.academy_portal_api(text,jsonb) from public,anon,service_role;
grant execute on function public.academy_portal_api(text,jsonb) to authenticated;
-- Include new records in the existing metadata-only Academy backups.
do $migration$
declare definition text:=pg_get_functiondef('tlb.academy_backup_tables()'::regprocedure);
 anchor text:=$anchor$'academy_broadcasts']$anchor$;
begin
 if position(anchor in definition)=0 then raise exception 'Review Academy backup table list before adding resources';end if;
 execute replace(definition,anchor,$replacement$'academy_broadcasts','academy_class_materials','academy_email_templates']$replacement$);
end $migration$;
revoke all on function tlb.academy_backup_tables() from public,anon,authenticated,service_role;
commit;
