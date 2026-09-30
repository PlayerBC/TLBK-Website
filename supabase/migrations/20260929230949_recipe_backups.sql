begin;
create table tlb.recipe_backup_connection (
 id boolean primary key default true check(id), enabled boolean not null default false,
 folder_id text not null default '1rRxDTqAVqliCdx0OTRJK0XuLC4iHQyeg', service_account_email text,
 lease_token uuid, lease_until timestamptz, last_attempt_at timestamptz, last_success_at timestamptz,
 last_daily_at timestamptz,last_monthly_at timestamptz,last_error text,consecutive_failures integer not null default 0,
 current_job_id uuid, manual_requested boolean not null default false
);
insert into tlb.recipe_backup_connection(id) values(true);
create table tlb.recipe_backup_slots (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('daily','monthly','manual')),
 slot integer not null check(slot>0), drive_file_id text not null unique check(drive_file_id ~ '^[A-Za-z0-9_-]{15,150}$'),
 completed_at timestamptz, valid boolean not null default false, sha256 text, size_bytes bigint,
 record_count bigint,file_count bigint, unique(kind,slot),check(slot<=case kind when 'daily' then 30 when 'monthly' then 12 else 2 end)
);
create table tlb.recipe_backup_jobs (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('daily','monthly','manual','download')),
 slot_id uuid references tlb.recipe_backup_slots(id), source_slot_id uuid references tlb.recipe_backup_slots(id),
 status text not null default 'running' check(status in ('running','success','failed','downloaded')),
 started_at timestamptz not null default now(), finished_at timestamptz,error text,record_count bigint not null default 0,file_count bigint not null default 0,
 completed_entries bigint not null default 0, created_by uuid references auth.users(id) on delete set null
);
alter table tlb.recipe_backup_connection add foreign key(current_job_id) references tlb.recipe_backup_jobs(id);
create index recipe_backup_job_recent on tlb.recipe_backup_jobs(started_at desc);
create index recipe_backup_job_slot on tlb.recipe_backup_jobs(slot_id);
create index recipe_backup_job_source on tlb.recipe_backup_jobs(source_slot_id);
create index recipe_backup_job_author on tlb.recipe_backup_jobs(created_by);
create table tlb.recipe_backup_rows (
 sequence bigint generated always as identity primary key, job_id uuid not null references tlb.recipe_backup_jobs(id) on delete cascade,
 table_key text not null, record_id text not null, data jsonb not null
);
create index recipe_backup_row_page on tlb.recipe_backup_rows(job_id,table_key,sequence);
create index recipe_backup_row_lookup on tlb.recipe_backup_rows(job_id,table_key,record_id);

create function tlb.recipe_backup_tables() returns text[] language sql immutable set search_path='' as $$
 select array['recipe_settings','recipe_categories','recipe_resources','recipe_supplier_items','recipe_prices','recipes','recipe_versions',
 'recipe_links','recipe_ingredient_links','recipe_tests','recipe_runs','recipe_files','recipe_file_links','recipe_user_state','recipe_drafts','recipe_audit','recipe_access']
$$;
create function tlb.recipe_backup_status() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('enabled',c.enabled,'folder_id',c.folder_id,'service_account_email',c.service_account_email,
 'last_attempt_at',c.last_attempt_at,'last_success_at',c.last_success_at,'last_daily_at',c.last_daily_at,'last_monthly_at',c.last_monthly_at,
 'last_error',c.last_error,'consecutive_failures',c.consecutive_failures,'busy',coalesce(c.lease_until>now(),false),'manual_requested',c.manual_requested,
 'schedule','Daily at 02:00 Asia/Manila; one monthly copy; checked every five minutes',
 'next_scheduled_at',case when c.last_daily_at is null or (c.last_daily_at at time zone 'Asia/Manila')::date<(now() at time zone 'Asia/Manila')::date
  then greatest(now(),((now() at time zone 'Asia/Manila')::date+time '02:00') at time zone 'Asia/Manila')
  else (((now() at time zone 'Asia/Manila')::date+1)+time '02:00') at time zone 'Asia/Manila' end,
 'slots',(select coalesce(jsonb_agg(to_jsonb(s) order by kind,slot),'[]') from tlb.recipe_backup_slots s),
 'jobs',(select coalesce(jsonb_agg(to_jsonb(j) order by started_at desc),'[]') from(select * from tlb.recipe_backup_jobs order by started_at desc limit 20)j),
 'uploaded_file_bytes',(select coalesce(sum(size_bytes),0) from tlb.recipe_files where uploaded))
 from tlb.recipe_backup_connection c where id
$$;
create function public.recipe_backup_api(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform tlb.recipe_assert(true,true);
 if p_action='status' then return tlb.recipe_backup_status();end if;
 if p_action='request' then
  perform tlb.require(exists(select 1 from tlb.recipe_backup_connection where id and enabled),'Connect the Drive backup before starting it.');
  update tlb.recipe_backup_connection set manual_requested=true where id;return tlb.recipe_backup_status();
 end if;
 if p_action='pause' then update tlb.recipe_backup_connection set enabled=false where id;return tlb.recipe_backup_status();end if;
 raise exception 'Unknown recipe backup action.';
end $$;
revoke all on function public.recipe_backup_api(text,jsonb) from public,anon;
grant execute on function public.recipe_backup_api(text,jsonb) to authenticated;

create function public.recipe_backup_service(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare c tlb.recipe_backup_connection;s tlb.recipe_backup_slots;source_slot tlb.recipe_backup_slots;j tlb.recipe_backup_jobs;
 token uuid;jid uuid;kind_name text;table_name text;statement text:='';expression text;snapshot_records bigint;snapshot_files bigint;slot_record jsonb;
begin
 if p_action='owner_access' then
  perform tlb.require(tlb.recipe_role((p_payload->>'user_id')::uuid)='owner','Recipe owner access required.');
  return jsonb_build_object('allowed',true,'connection',tlb.recipe_backup_status());
 end if;
 if p_action='identify' then
  perform tlb.require(p_payload->>'email' ~ '^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.gserviceaccount\.com$','Invalid service account identifier.');
  update tlb.recipe_backup_connection set service_account_email=p_payload->>'email' where id;return jsonb_build_object('saved',true);
 end if;
 if p_action='connect' then
  select * into c from tlb.recipe_backup_connection where id for update;
  perform tlb.require(c.lease_until is null or c.lease_until<now(),'A backup is running. Wait before changing its connection.');
  perform tlb.require(p_payload->>'folder_id'='1rRxDTqAVqliCdx0OTRJK0XuLC4iHQyeg','Use the dedicated recipe backup folder.');
  for slot_record in select value from jsonb_array_elements(p_payload->'slots') loop
   perform tlb.require(not exists(select 1 from tlb.recipe_backup_slots where kind=slot_record->>'kind' and slot=(slot_record->>'slot')::int and drive_file_id<>slot_record->>'drive_file_id'),'An existing backup slot points to another archive. Preserve or migrate it explicitly before reconnecting.');
   insert into tlb.recipe_backup_slots(kind,slot,drive_file_id) values(slot_record->>'kind',(slot_record->>'slot')::int,slot_record->>'drive_file_id')
   on conflict(kind,slot) do update set drive_file_id=excluded.drive_file_id where tlb.recipe_backup_slots.drive_file_id=excluded.drive_file_id;
  end loop;
  perform tlb.require((select count(*) from tlb.recipe_backup_slots where kind='daily')>=30 and (select count(*) from tlb.recipe_backup_slots where kind='monthly')>=12
   and (select count(*) from tlb.recipe_backup_slots where kind='manual')>=2,'Provision 30 daily, 12 monthly and two manual archive files first.');
  update tlb.recipe_backup_connection set enabled=true,folder_id=p_payload->>'folder_id' where id;return tlb.recipe_backup_status();
 end if;
 if p_action='begin' then
  select * into c from tlb.recipe_backup_connection where id for update;
  if c.lease_until>now() then return jsonb_build_object('skipped','busy');end if;
  if c.current_job_id is not null then
   update tlb.recipe_backup_slots set valid=false where id in(select slot_id from tlb.recipe_backup_jobs where id=c.current_job_id and status='running');
   update tlb.recipe_backup_jobs set status='failed',error='interrupted',finished_at=now() where id=c.current_job_id and status='running';
   delete from tlb.recipe_backup_rows where job_id=c.current_job_id;
  end if;
  kind_name:=p_payload->>'kind';
  if kind_name='download' then
   perform tlb.require(tlb.recipe_role((p_payload->>'user_id')::uuid)='owner','Owner access required.');
  else
   if not c.enabled then return jsonb_build_object('skipped','disconnected');end if;
   if kind_name='manual' or c.manual_requested then kind_name:='manual';
   elsif c.last_daily_at is null or ((c.last_daily_at at time zone 'Asia/Manila')::date<(now() at time zone 'Asia/Manila')::date and (now() at time zone 'Asia/Manila')::time>=time '02:00') then kind_name:='daily';
   elsif c.last_monthly_at is null or date_trunc('month',c.last_monthly_at at time zone 'Asia/Manila')<date_trunc('month',now() at time zone 'Asia/Manila') then kind_name:='monthly';
   else return jsonb_build_object('skipped','not_due');end if;
   select * into s from tlb.recipe_backup_slots where kind=kind_name order by completed_at nulls first,slot limit 1 for update;
   perform tlb.require(s.id is not null,'No backup archive slot is available.');
   if kind_name='monthly' then
    select * into source_slot from tlb.recipe_backup_slots where kind='daily' and valid order by completed_at desc limit 1;
    perform tlb.require(source_slot.id is not null,'A verified daily backup is required before the monthly copy.');
   end if;
  end if;
  token:=gen_random_uuid();jid:=gen_random_uuid();
  insert into tlb.recipe_backup_jobs(id,kind,slot_id,source_slot_id,created_by) values(jid,kind_name,s.id,source_slot.id,nullif(p_payload->>'user_id','')::uuid);
  update tlb.recipe_backup_connection set lease_token=token,lease_until=now()+interval '10 minutes',last_attempt_at=now(),current_job_id=jid,
   manual_requested=case when kind_name='manual' then false else manual_requested end where id;
  if kind_name<>'monthly' then
   -- All records are captured by ONE INSERT/SELECT statement, using one MVCC
   -- snapshot. Paging the staged rows cannot mix different formula versions.
   foreach table_name in array tlb.recipe_backup_tables() loop
    expression:=case when table_name='recipe_versions' then 'to_jsonb(t)-''search_text''-''kitchen_search''' else 'to_jsonb(t)' end;
    statement:=statement||case when statement='' then '' else ' union all ' end||format(
     'select %L::uuid,%L,coalesce(to_jsonb(t)->>''id'',to_jsonb(t)->>''user_id'',''''),%s from tlb.%I t',jid,table_name,expression,table_name);
   end loop;
   statement:=statement||format($actors$ union all select %L::uuid,'actors',u.id::text,jsonb_build_object('id',u.id,'email',u.email,'role',(select role from tlb.staff where user_id=u.id)) from auth.users u where u.id in(
    select user_id from tlb.staff where role='owner' union select user_id from tlb.recipe_access union select granted_by from tlb.recipe_access
    union select created_by from tlb.recipes union select updated_by from tlb.recipes union select created_by from tlb.recipe_versions
    union select updated_by from tlb.recipe_resources union select created_by from tlb.recipe_prices union select created_by from tlb.recipe_tests
    union select updated_by from tlb.recipe_tests union select created_by from tlb.recipe_runs union select created_by from tlb.recipe_files union select user_id from tlb.recipe_user_state
    union select user_id from tlb.recipe_drafts union select actor from tlb.recipe_audit
   )$actors$,jid);
   execute 'insert into tlb.recipe_backup_rows(job_id,table_key,record_id,data) '||statement;
   select count(*),count(*) filter(where table_key='recipe_files' and (data->>'uploaded')::boolean) into snapshot_records,snapshot_files from tlb.recipe_backup_rows where job_id=jid;
  else snapshot_records:=source_slot.record_count;snapshot_files:=source_slot.file_count;end if;
  update tlb.recipe_backup_jobs set record_count=snapshot_records,file_count=snapshot_files where id=jid;
  return jsonb_build_object('job_id',jid,'lease_token',token,'kind',kind_name,'drive_file_id',s.drive_file_id,'source_file_id',source_slot.drive_file_id,
   'source_sha256',source_slot.sha256,'source_bytes',source_slot.size_bytes,'generated_at',now(),'record_count',snapshot_records,'file_count',snapshot_files,'tables',to_jsonb(tlb.recipe_backup_tables())||jsonb_build_array('actors'));
 end if;
 select * into c from tlb.recipe_backup_connection where id for update;
 perform tlb.require(c.current_job_id=(p_payload->>'job_id')::uuid and c.lease_token=(p_payload->>'lease_token')::uuid and c.lease_until>now(),'Recipe backup worker lease expired.');
 select * into j from tlb.recipe_backup_jobs where id=c.current_job_id;
 if p_action='page' then
  perform tlb.require(p_payload->>'table'=any(tlb.recipe_backup_tables()) or p_payload->>'table'='actors','Unknown backup table.');
  return (select jsonb_build_object('rows',coalesce(jsonb_agg(jsonb_build_object('sequence',sequence,'data',data) order by sequence),'[]')) from (
   select sequence,data from tlb.recipe_backup_rows where job_id=j.id and table_key=p_payload->>'table' and sequence>coalesce((p_payload->>'after')::bigint,0)
   order by sequence limit least(20,greatest(1,coalesce((p_payload->>'limit')::int,10)))
  ) rows);
 elsif p_action='progress' then
  update tlb.recipe_backup_jobs set completed_entries=greatest(completed_entries,coalesce((p_payload->>'entries')::bigint,0)) where id=j.id;
  return jsonb_build_object('saved',true);
 elsif p_action='finish' then
  if nullif(p_payload->>'error','') is not null then
   update tlb.recipe_backup_jobs set status='failed',finished_at=now(),error=case when p_payload->>'error' in ('access','quota','network','checksum','file_missing','configuration','too_large','interrupted') then p_payload->>'error' else 'network' end where id=j.id;
   update tlb.recipe_backup_slots set valid=false where id=j.slot_id;
   update tlb.recipe_backup_connection set last_error=(select error from tlb.recipe_backup_jobs where id=j.id),consecutive_failures=consecutive_failures+1,manual_requested=manual_requested or j.kind='manual' where id;
  else
   perform tlb.require(p_payload->>'sha256' ~ '^[a-f0-9]{64}$' and (p_payload->>'size_bytes')::bigint>22,'Confirm the complete archive checksum and size.');
   if j.kind='download' then update tlb.recipe_backup_jobs set status='downloaded',finished_at=now() where id=j.id;
   else
    perform tlb.require(coalesce((p_payload->>'drive_verified')::boolean,false),'Google Drive must confirm the uploaded archive.');
    update tlb.recipe_backup_slots set valid=true,completed_at=now(),sha256=p_payload->>'sha256',size_bytes=(p_payload->>'size_bytes')::bigint,
     record_count=j.record_count,file_count=j.file_count where id=j.slot_id;
    update tlb.recipe_backup_jobs set status='success',finished_at=now() where id=j.id;
    update tlb.recipe_backup_connection set last_success_at=now(),last_error=null,consecutive_failures=0,
     last_daily_at=case when j.kind='daily' then now() else last_daily_at end,last_monthly_at=case when j.kind='monthly' then now() else last_monthly_at end where id;
   end if;
  end if;
  delete from tlb.recipe_backup_rows where job_id=j.id;
  update tlb.recipe_backup_connection set lease_token=null,lease_until=null,current_job_id=null where id;
  return tlb.recipe_backup_status();
 end if;
 raise exception 'Unknown recipe backup worker action.';
end $$;
revoke all on function public.recipe_backup_service(text,jsonb) from public,anon,authenticated;
grant execute on function public.recipe_backup_service(text,jsonb) to service_role;
do $$ declare t text;begin
 foreach t in array array['recipe_backup_connection','recipe_backup_slots','recipe_backup_jobs','recipe_backup_rows'] loop
  execute format('alter table tlb.%I enable row level security',t);execute format('revoke all on tlb.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
revoke all on function tlb.recipe_backup_tables(),tlb.recipe_backup_status() from public,anon,authenticated,service_role;

do $hosted$ begin
 if to_regnamespace('vault') is null then return;end if;
 execute $install$
do $$ begin
 if not exists(select 1 from vault.secrets where name='tlb_recipe_backup_worker_token') then
  perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'tlb_recipe_backup_worker_token','TLB private recipe backup worker only');
 end if;
end $$;
create function public.tlb_recipe_backup_worker_authorized(p_token text) returns boolean
language sql security definer set search_path='' as $$
 select coalesce(length(p_token)=64 and exists(select 1 from vault.decrypted_secrets where name='tlb_recipe_backup_worker_token'
  and extensions.digest(p_token,'sha256')=extensions.digest(decrypted_secret,'sha256')),false)
$$;
revoke all on function public.tlb_recipe_backup_worker_authorized(text) from public,anon,authenticated;
grant execute on function public.tlb_recipe_backup_worker_authorized(text) to service_role;
create function tlb.invoke_recipe_backup_worker(p_force boolean default false) returns bigint language sql security invoker set search_path='' as $$
 select net.http_post(url:='https://aulhqofjjckwwjmdvqgi.supabase.co/functions/v1/recipe-backup',
  headers:=jsonb_build_object('Content-Type','application/json','x-worker-token',(select decrypted_secret from vault.decrypted_secrets where name='tlb_recipe_backup_worker_token')),
  body:='{}'::jsonb,timeout_milliseconds:=10000)
 where p_force or exists(select 1 from tlb.recipe_backup_connection where id and enabled and (lease_until is null or lease_until<now())
  and (manual_requested or last_daily_at is null or last_monthly_at is null or last_error is not null
   or ((last_daily_at at time zone 'Asia/Manila')::date<(now() at time zone 'Asia/Manila')::date and (now() at time zone 'Asia/Manila')::time>=time '02:00')
   or date_trunc('month',last_monthly_at at time zone 'Asia/Manila')<date_trunc('month',now() at time zone 'Asia/Manila')))
$$;
revoke all on function tlb.invoke_recipe_backup_worker(boolean) from public,anon,authenticated,service_role;
select cron.schedule('tlb-recipe-backup','*/5 * * * *','select tlb.invoke_recipe_backup_worker();');
 $install$;
end $hosted$;
commit;
