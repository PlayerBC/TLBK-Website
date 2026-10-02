begin;
set local lock_timeout='3s';

-- Keep previous latest-working archives and in-flight jobs identifiable. New
-- snapshots include the published Final, even when a newer working draft exists.
alter table tlb.recipe_backup_jobs add column recipe_scope text not null default 'latest' check(recipe_scope in ('latest','final'));
alter table tlb.recipe_backup_slots add column recipe_scope text not null default 'latest' check(recipe_scope in ('latest','final'));

create or replace function tlb.recipe_backup_essential_rows() returns table(table_key text,record_id text,data jsonb)
language sql stable security invoker set search_path='' as $$
 with recursive finals as materialized (
  select r.id recipe_id,v.id from tlb.recipes r join tlb.recipe_versions v on v.id=r.production_version_id and v.recipe_id=r.id
  where r.deleted_at is null and v.status in ('approved','production')
 ), needed(id) as (
  select id from finals
  union select l.target_version_id from tlb.recipe_links l join needed n on l.version_id=n.id where l.kind='component'
 ), versions as materialized (
  select v.* from tlb.recipe_versions v join needed n on n.id=v.id
 ), valid as materialized (
  select tlb.require(not exists(select 1 from versions where status not in ('approved','production')),
   'A Final recipe requires a component that is not Final. Review the published component before backing up.')
 ), chosen as materialized (
  select distinct on (v.recipe_id) v.recipe_id,v.id,v.document,v.created_at,v.created_by
  from versions v left join finals f on f.id=v.id
  order by v.recipe_id,(f.id is not null) desc,v.number desc,v.id
 ), resources as materialized (
  select * from tlb.recipe_resources where kind in ('ingredient','supplier','packaging')
 ), prices as materialized (
  select distinct on (p.resource_id,p.supplier_id) p.* from tlb.recipe_prices p join resources r on r.id=p.resource_id
  where p.supplier_id is null or exists(select 1 from resources s where s.id=p.supplier_id)
  order by p.resource_id,p.supplier_id,p.created_at desc,p.id
 ), files as materialized (
  select f.* from tlb.recipe_files f where f.uploaded and (
   exists(select 1 from tlb.recipe_file_links l join needed n on n.id=l.version_id where l.file_id=f.id and l.test_id is null)
   or exists(select 1 from resources r cross join lateral jsonb_path_query(r.data,'$.**.file_id') value where value#>>'{}'=f.id::text)
  )
 ), core as materialized (
  select 'recipe_settings'::text table_key,t.id::text record_id,to_jsonb(t) data from tlb.recipe_settings t
  union all select 'recipe_categories',t.id::text,to_jsonb(t) from tlb.recipe_categories t
  union all select 'recipe_resources',t.id::text,to_jsonb(t) from resources t
  union all select 'recipe_supplier_items',t.resource_id::text||':'||t.supplier_id::text,to_jsonb(t) from tlb.recipe_supplier_items t
   where exists(select 1 from resources r where r.id=t.resource_id) and exists(select 1 from resources r where r.id=t.supplier_id)
  union all select 'recipe_prices',t.id::text,to_jsonb(t) from prices t
  union all select 'recipes',r.id::text,to_jsonb(r)||jsonb_build_object(
   'current_version_id',c.id,'production_version_id',(select f.id from finals f where f.recipe_id=r.id),
   'name',c.document->>'name','category_id',nullif(c.document->>'category_id','')::uuid,
   'updated_at',c.created_at,'updated_by',c.created_by)
   from tlb.recipes r join chosen c on c.recipe_id=r.id
  union all select 'recipe_versions',v.id::text,(to_jsonb(v)-'search_text'-'kitchen_search')||jsonb_build_object(
   -- A copied variation already contains its complete formula. Exclude only
   -- optional base-comparison provenance if that base is outside Final scope.
   'document',case when v.document ? 'base' and not exists(select 1 from needed n where n.id::text=v.document#>>'{base,version_id}')
    then v.document-'base' else v.document end) from versions v
  union all select 'recipe_links',t.version_id::text||':'||t.link_id,to_jsonb(t) from tlb.recipe_links t
   join needed n on n.id=t.version_id join needed target on target.id=t.target_version_id
  union all select 'recipe_ingredient_links',t.version_id::text||':'||t.row_id,to_jsonb(t) from tlb.recipe_ingredient_links t join needed n on n.id=t.version_id
  union all select 'recipe_files',t.id::text,to_jsonb(t) from files t
  union all select 'recipe_file_links',t.file_id::text||':'||t.version_id::text,to_jsonb(t) from tlb.recipe_file_links t
   join files f on f.id=t.file_id join needed n on n.id=t.version_id where t.test_id is null
 ), all_rows as (
  select * from core
  union all select 'actors',u.id::text,jsonb_build_object('id',u.id,'email',u.email,
   'role',case when exists(select 1 from tlb.staff s where s.user_id=u.id and s.role='owner') then 'owner' end)
  from auth.users u where exists(select 1 from tlb.staff s where s.user_id=u.id and s.role='owner') or exists(
   select 1 from core c where u.id::text in (c.data->>'created_by',c.data->>'updated_by')
  )
 ) select r.* from all_rows r cross join valid
$$;
revoke all on function tlb.recipe_backup_essential_rows() from public,anon,authenticated,service_role;

-- Preserve worker authorization, leases, atomic capture, Drive verification and
-- retention. Monthly copies inherit the scope of their verified source archive.
do $$ declare source text;hook text;begin
 source:=pg_get_functiondef('public.recipe_backup_service(text,jsonb)'::regprocedure);
 hook:='update tlb.recipe_backup_jobs set record_count=snapshot_records,file_count=snapshot_files,scope=case when kind_name=''monthly'' then source_slot.scope else ''essentials'' end where id=jid;';
 perform tlb.require(strpos(source,hook)>0,'Missing essential backup job scope hook.');
 source:=replace(source,hook,'update tlb.recipe_backup_jobs set record_count=snapshot_records,file_count=snapshot_files,scope=case when kind_name=''monthly'' then source_slot.scope else ''essentials'' end,recipe_scope=case when kind_name=''monthly'' then source_slot.recipe_scope else ''final'' end where id=jid;');
 hook:='''scope'',case when kind_name=''monthly'' then source_slot.scope else ''essentials'' end,''record_count'',snapshot_records';
 perform tlb.require(strpos(source,hook)>0,'Missing essential backup response scope hook.');
 source:=replace(source,hook,'''scope'',case when kind_name=''monthly'' then source_slot.scope else ''essentials'' end,''recipe_scope'',case when kind_name=''monthly'' then source_slot.recipe_scope else ''final'' end,''record_count'',snapshot_records');
 hook:='record_count=j.record_count,file_count=j.file_count,scope=j.scope where id=j.slot_id;';
 perform tlb.require(strpos(source,hook)>0,'Missing verified backup slot scope hook.');
 source:=replace(source,hook,'record_count=j.record_count,file_count=j.file_count,scope=j.scope,recipe_scope=j.recipe_scope where id=j.slot_id;');
 execute source;
 source:=pg_get_functiondef('tlb.recipe_backup_status()'::regprocedure);
 hook:='''scope'',''essentials'',''schedule''';
 perform tlb.require(strpos(source,hook)>0,'Missing essential backup status scope hook.');
 execute replace(source,hook,'''scope'',''essentials'',''recipe_scope'',''final'',''schedule''');
end $$;
commit;
