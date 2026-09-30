begin;

-- Private library. Immutable documents preserve formulas independently of live
-- ingredient prices. Only checked RPCs expose these tables to application users.
create table tlb.recipe_access (
 user_id uuid primary key references tlb.staff(user_id) on delete cascade,
 permission text not null check(permission in ('chef','kitchen')),
 granted_by uuid references auth.users(id) on delete set null, updated_at timestamptz not null default now()
);
create table tlb.recipe_settings (
 id boolean primary key default true check(id), revision bigint not null default 1,
 settings jsonb not null default '{"currency":"PHP","paper":"A4","rounding":"exact","daily_retention":30,"monthly_retention":12}'
);
insert into tlb.recipe_settings(id) values(true);
create table tlb.recipe_categories (
 id uuid primary key default gen_random_uuid(), name text not null check(length(btrim(name)) between 1 and 100),
 parent_id uuid references tlb.recipe_categories(id), sort_order integer not null default 0,
 active boolean not null default true, check(parent_id is distinct from id)
);
create unique index recipe_category_name on tlb.recipe_categories(lower(name),coalesce(parent_id,'00000000-0000-0000-0000-000000000000'::uuid));
insert into tlb.recipe_categories(name,sort_order) select name,ordinality::int from unnest(array['Cakes','Cheesecakes','Cookies','Brownies','Pastries','Entremets','Bread','Fillings','Frostings','Sauces','Jams','Ganache','Decorations','Components']) with ordinality t(name,ordinality);

create table tlb.recipe_resources (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('ingredient','supplier','packaging','equipment')),
 name text not null check(length(btrim(name)) between 1 and 200), data jsonb not null default '{}',
 active boolean not null default true, revision bigint not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id) on delete set null,
 check(jsonb_typeof(data)='object')
);
create index recipe_resource_lookup on tlb.recipe_resources(kind,active,lower(name),id);
create table tlb.recipe_supplier_items (
 resource_id uuid not null references tlb.recipe_resources(id), supplier_id uuid not null references tlb.recipe_resources(id),
 notes text not null default '', primary key(resource_id,supplier_id), check(resource_id<>supplier_id)
);
create index recipe_supplier_items_supplier on tlb.recipe_supplier_items(supplier_id);
create table tlb.recipe_prices (
 id uuid primary key default gen_random_uuid(), resource_id uuid not null references tlb.recipe_resources(id),
 supplier_id uuid references tlb.recipe_resources(id), amount numeric not null check(amount>=0 and amount<=1000000000),
 quantity numeric not null check(quantity>0 and quantity<=1000000000), unit text not null check(length(btrim(unit)) between 1 and 40),
 currency text not null default 'PHP' check(currency ~ '^[A-Z]{3}$'), notes text not null default '',
 created_at timestamptz not null default now(), created_by uuid references auth.users(id) on delete set null
);
create index recipe_price_latest on tlb.recipe_prices(resource_id,created_at desc,id);
create index recipe_price_supplier on tlb.recipe_prices(supplier_id);

create table tlb.recipes (
 id uuid primary key default gen_random_uuid(), code text not null unique,
 name text not null check(length(btrim(name)) between 1 and 200), category_id uuid references tlb.recipe_categories(id),
 current_version_id uuid, production_version_id uuid, revision bigint not null default 1,
 deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null,
 check(code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$')
);
create index recipe_library_name on tlb.recipes(lower(name),id) where deleted_at is null;
create index recipe_library_category on tlb.recipes(category_id,updated_at desc) where deleted_at is null;
create index recipe_library_author on tlb.recipes(created_by);
create table tlb.recipe_versions (
 id uuid primary key default gen_random_uuid(), recipe_id uuid not null references tlb.recipes(id), number integer not null check(number>0),
 status text not null check(status in ('draft','testing','approved','production','archived')),
 document jsonb not null check(jsonb_typeof(document)='object'), cost_snapshot jsonb not null default '{}',
 reason text not null default '', created_at timestamptz not null default now(), created_by uuid references auth.users(id) on delete set null,
 search_text tsvector generated always as (to_tsvector('simple'::regconfig,document::text)) stored,
 unique(recipe_id,number), unique(recipe_id,id)
);
alter table tlb.recipes add constraint recipe_current_belongs foreign key(id,current_version_id) references tlb.recipe_versions(recipe_id,id) deferrable initially deferred;
alter table tlb.recipes add constraint recipe_production_belongs foreign key(id,production_version_id) references tlb.recipe_versions(recipe_id,id) deferrable initially deferred;
create index recipe_version_search on tlb.recipe_versions using gin(search_text);
create index recipe_version_actor on tlb.recipe_versions(created_by);
create table tlb.recipe_links (
 version_id uuid not null references tlb.recipe_versions(id), target_version_id uuid not null references tlb.recipe_versions(id),
 link_id text not null, kind text not null check(kind in ('component','variation')),
 mode text not null default 'pinned' check(mode in ('pinned','latest')),
 quantity text not null default '1', primary key(version_id,link_id), check(version_id<>target_version_id)
);
create index recipe_link_target on tlb.recipe_links(target_version_id);
create table tlb.recipe_ingredient_links (
 version_id uuid not null references tlb.recipe_versions(id), resource_id uuid not null references tlb.recipe_resources(id),
 row_id text not null, primary key(version_id,row_id)
);
create index recipe_ingredient_resource on tlb.recipe_ingredient_links(resource_id);
create table tlb.recipe_tests (
 id uuid primary key default gen_random_uuid(), recipe_id uuid not null references tlb.recipes(id),
 version_id uuid not null, number integer not null check(number>0), revision bigint not null default 1,
 data jsonb not null check(jsonb_typeof(data)='object'), proposed_document jsonb,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null,
 promoted_version_id uuid references tlb.recipe_versions(id), unique(recipe_id,number),
 foreign key(recipe_id,version_id) references tlb.recipe_versions(recipe_id,id)
);
create index recipe_test_version on tlb.recipe_tests(version_id);
create table tlb.recipe_runs (
 id uuid primary key default gen_random_uuid(), recipe_id uuid not null references tlb.recipes(id), version_id uuid not null,
 variant_id text not null, multiplier text not null, scaling_mode text not null default 'multiplier', planned_yield numeric not null check(planned_yield>0),
 actual_yield numeric not null check(actual_yield>=0), yield_unit text not null, produced_on date not null,
 notes text not null default '', created_at timestamptz not null default now(), created_by uuid references auth.users(id) on delete set null,
 foreign key(recipe_id,version_id) references tlb.recipe_versions(recipe_id,id)
);
create index recipe_run_recipe on tlb.recipe_runs(recipe_id,produced_on desc);
create index recipe_run_version on tlb.recipe_runs(version_id);
create table tlb.recipe_files (
 id uuid primary key default gen_random_uuid(), path text not null unique, filename text not null,
 mime_type text not null, size_bytes bigint not null check(size_bytes between 1 and 26214400),
 sha256 text not null, uploaded boolean not null default false,
 created_at timestamptz not null default now(), created_by uuid references auth.users(id) on delete set null,
 check(sha256 is null or sha256 ~ '^[a-f0-9]{64}$')
);
create table tlb.recipe_file_links (
 file_id uuid not null references tlb.recipe_files(id), version_id uuid references tlb.recipe_versions(id),
 test_id uuid references tlb.recipe_tests(id), visibility text not null check(visibility in ('kitchen','private')),
 check(num_nonnulls(version_id,test_id)=1)
);
create unique index recipe_file_version on tlb.recipe_file_links(file_id,version_id) where version_id is not null;
create unique index recipe_file_test on tlb.recipe_file_links(file_id,test_id) where test_id is not null;
create index recipe_file_version_access on tlb.recipe_file_links(version_id);
create index recipe_file_test_access on tlb.recipe_file_links(test_id);
create table tlb.recipe_user_state (
 user_id uuid not null references auth.users(id) on delete cascade, recipe_id uuid not null references tlb.recipes(id),
 favorite boolean not null default false, pinned boolean not null default false, last_viewed_at timestamptz,
 primary key(user_id,recipe_id)
);
create index recipe_user_state_recipe on tlb.recipe_user_state(recipe_id);
create table tlb.recipe_drafts (
 user_id uuid not null references auth.users(id) on delete cascade, draft_id uuid not null,
 recipe_id uuid references tlb.recipes(id), base_revision bigint, document jsonb not null,
 updated_at timestamptz not null default now(), primary key(user_id,draft_id)
);
create index recipe_draft_recipe on tlb.recipe_drafts(recipe_id);
create table tlb.recipe_audit (
 id bigint generated always as identity primary key, recipe_id uuid references tlb.recipes(id),
 actor uuid references auth.users(id) on delete set null, action text not null, details jsonb not null default '{}',
 created_at timestamptz not null default now()
);
create index recipe_audit_recipe on tlb.recipe_audit(recipe_id,id desc);
create index recipe_access_granter on tlb.recipe_access(granted_by);
create index recipe_category_parent on tlb.recipe_categories(parent_id);
create index recipe_resource_editor on tlb.recipe_resources(updated_by);
create index recipe_price_author on tlb.recipe_prices(created_by);
create index recipe_editor on tlb.recipes(updated_by);
create index recipe_current_version on tlb.recipes(current_version_id,id);
create index recipe_production_version on tlb.recipes(production_version_id,id);
create index recipe_test_author on tlb.recipe_tests(created_by);
create index recipe_test_editor on tlb.recipe_tests(updated_by);
create index recipe_test_promoted on tlb.recipe_tests(promoted_version_id);
create index recipe_run_author on tlb.recipe_runs(created_by);
create index recipe_file_author on tlb.recipe_files(created_by);
create index recipe_audit_actor on tlb.recipe_audit(actor);

create function tlb.recipe_role(p_user uuid) returns text language sql stable security invoker set search_path='' as $$
 select case when not tlb.is_verified(p_user) then null when tlb.role_for(p_user)='owner' then 'owner'
 else (select permission from tlb.recipe_access where user_id=p_user) end
$$;
create function tlb.recipe_assert(p_edit boolean default false,p_owner boolean default false) returns text
language plpgsql stable security invoker set search_path='' as $$
declare r text:=tlb.recipe_role(auth.uid());
begin
 if r is null or (p_edit and r not in ('owner','chef')) or (p_owner and r<>'owner') then
  raise exception 'Authorized recipe % access required.',case when p_owner then 'owner' when p_edit then 'editor' else 'viewer' end using errcode='42501';
 end if;return r;
end $$;
create function tlb.recipe_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 -- Account removal may clear attribution through an FK, never formula/history data.
 if tg_op='UPDATE' and pg_trigger_depth()>1 and
  (to_jsonb(new)-array['created_by','actor','search_text','kitchen_search'])=(to_jsonb(old)-array['created_by','actor','search_text','kitchen_search'])
  and coalesce(to_jsonb(new)->>'created_by',to_jsonb(new)->>'actor') is null then return new;end if;
 raise exception 'History is immutable. Create a new version instead.';
end $$;
create trigger recipe_version_immutable before update or delete on tlb.recipe_versions for each row execute function tlb.recipe_immutable();
create trigger recipe_price_immutable before update or delete on tlb.recipe_prices for each row execute function tlb.recipe_immutable();
create trigger recipe_audit_immutable before update or delete on tlb.recipe_audit for each row execute function tlb.recipe_immutable();
create trigger recipe_run_immutable before update or delete on tlb.recipe_runs for each row execute function tlb.recipe_immutable();

-- Accept original fractions and preserve their source strings in version data.
create function tlb.recipe_quantity(p_text text) returns numeric language plpgsql immutable set search_path='' as $$
declare t text:=btrim(p_text); term text; a text[]; n numeric:=0; i integer;
 chars text[]:=array['¼','½','¾','⅓','⅔','⅕','⅖','⅗','⅘','⅙','⅚','⅛','⅜','⅝','⅞','⅐','⅑','⅒'];
 vals text[]:=array['1/4','1/2','3/4','1/3','2/3','1/5','2/5','3/5','4/5','1/6','5/6','1/8','3/8','5/8','7/8','1/7','1/9','1/10'];
begin
 perform tlb.require(length(t) between 1 and 120,'Enter a valid ingredient quantity.');
 for i in 1..array_length(chars,1) loop t:=replace(t,chars[i],' '||vals[i]);end loop;
 foreach term in array string_to_array(t,'+') loop
  term:=btrim(term);a:=regexp_match(term,'^(\d+)\s+(\d+)\s*/\s*(\d+)$');
  if a is not null then perform tlb.require(a[3]::numeric>0,'A fraction denominator must be positive.');n:=n+a[1]::numeric+a[2]::numeric/a[3]::numeric;
  else a:=regexp_match(term,'^(\d+)\s*/\s*(\d+)$');
   if a is not null then perform tlb.require(a[2]::numeric>0,'A fraction denominator must be positive.');n:=n+a[1]::numeric/a[2]::numeric;
   else perform tlb.require(term ~ '^(\d+(\.\d+)?|\.\d+)$','Enter a nonnegative number or fraction.');n:=n+term::numeric;end if;
  end if;
 end loop;
 perform tlb.require(n<=1000000000000,'Quantity is too large.');return n;
end $$;
create function tlb.recipe_validate(p_doc jsonb) returns void language plpgsql stable security invoker set search_path='' as $$
declare v jsonb;g jsonb;r jsonb;s jsonb; k text;ids text[]:=array[]::text[];
begin
 perform tlb.require(jsonb_typeof(p_doc)='object' and octet_length(p_doc::text)<=2097152,'Recipe must be a structured document under 2 MB.');
 perform tlb.require(length(btrim(p_doc->>'name')) between 1 and 200,'Add a recipe name.');
 perform tlb.require(jsonb_typeof(p_doc->'variants')='array' and jsonb_array_length(p_doc->'variants') between 1 and 50,'Add at least one size variant.');
 for v in select value from jsonb_array_elements(p_doc->'variants') loop
  perform tlb.require(length(v->>'id') between 1 and 100 and not(v->>'id'=any(ids)),'Every size needs a unique ID.');ids:=array_append(ids,v->>'id');
  perform tlb.require(length(btrim(v->>'name')) between 1 and 150,'Name each size variant.');
  perform tlb.require(tlb.recipe_quantity(v#>>'{yield,quantity}')>0,'Base yield must be greater than zero.');
  perform tlb.require(length(btrim(v#>>'{yield,unit}')) between 1 and 60,'Add a yield unit.');
  foreach k in array array['portions','portion_weight','batch_weight','finished_weight','pans','loss_percent'] loop
   if nullif(v#>>array['yield',k],'') is not null then
    perform tlb.require(tlb.recipe_quantity(v#>>array['yield',k])>=0,'Yield values cannot be negative.');
    if k='loss_percent' then perform tlb.require(tlb.recipe_quantity(v#>>array['yield',k])<=100,'Expected loss cannot exceed 100%.');end if;
   end if;
  end loop;
  perform tlb.require(jsonb_typeof(v->'groups')='array' and jsonb_array_length(v->'groups')<=100,'Ingredient groups must be an array.');
  for g in select value from jsonb_array_elements(v->'groups') loop
   perform tlb.require(jsonb_typeof(g->'ingredients')='array' and jsonb_array_length(g->'ingredients')<=500,'Ingredient rows must be an array.');
   for r in select value from jsonb_array_elements(g->'ingredients') loop
    perform tlb.require(length(r->>'id') between 1 and 100 and not(r->>'id'=any(ids)),'Ingredient rows need unique IDs across all sizes.');ids:=array_append(ids,r->>'id');
    perform tlb.require(length(btrim(r->>'name')) between 1 and 200,'Name each ingredient.');
    perform tlb.recipe_quantity(r->>'quantity');perform tlb.require(length(btrim(r->>'unit')) between 1 and 40,'Choose each ingredient unit.');
    if nullif(r->>'percentage','') is not null then perform tlb.recipe_quantity(r->>'percentage');end if;
    if nullif(r->>'ingredient_id','') is not null then perform tlb.require(exists(select 1 from tlb.recipe_resources where id=(r->>'ingredient_id')::uuid and kind='ingredient'),'An ingredient reference is missing.');end if;
   end loop;
  end loop;
  perform tlb.require(jsonb_typeof(coalesce(v->'methods','[]'))='array','Method sections must be an array.');
  for g in select value from jsonb_array_elements(coalesce(v->'methods','[]')) loop
   perform tlb.require(jsonb_typeof(g->'steps')='array','Method steps must be an array.');
   for s in select value from jsonb_array_elements(g->'steps') loop
    perform tlb.require(length(btrim(s->>'instruction')) between 1 and 20000,'Write each method step or remove the empty row.');
    if nullif(s->>'timer_minutes','') is not null then perform tlb.recipe_quantity(s->>'timer_minutes');end if;
   end loop;
  end loop;
  for r in select value from jsonb_array_elements(coalesce(v->'additional_costs','[]')) loop perform tlb.recipe_quantity(r->>'amount');end loop;
 end loop;
end $$;

create function tlb.recipe_pick(p_value jsonb,p_keys text[]) returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(coalesce(p_value,'{}')) where key=any(p_keys)
$$;
create function tlb.recipe_pick_array(p_value jsonb,p_keys text[]) returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(case when jsonb_typeof(value)='object' then tlb.recipe_pick(value,p_keys) else value end order by n),'[]')
 from jsonb_array_elements(coalesce(p_value,'[]')) with ordinality t(value,n)
$$;
-- Whitelist the kitchen payload on the server. Hiding UI panels is insufficient.
create function tlb.recipe_kitchen_document(p_doc jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare d jsonb;v jsonb;g jsonb;r jsonb;variants jsonb:='[]';groups jsonb;rows jsonb;methods jsonb;
begin
 d:=tlb.recipe_pick(p_doc,array['name','description','tags','flavor','product_line','photos','allergens','detected_allergens','allergen_override','critical_notes']);
 for v in select value from jsonb_array_elements(p_doc->'variants') loop
  groups:='[]';
  for g in select value from jsonb_array_elements(v->'groups') loop
   rows:='[]';for r in select value from jsonb_array_elements(g->'ingredients') loop
    rows:=rows||jsonb_build_array(tlb.recipe_pick(r,array['id','ingredient_id','name','quantity','unit','percentage','notes','brand','allergens']));
   end loop;groups:=groups||jsonb_build_array(tlb.recipe_pick(g,array['id','name'])||jsonb_build_object('ingredients',rows));
  end loop;
  methods:='[]';for g in select value from jsonb_array_elements(coalesce(v->'methods','[]')) loop
   methods:=methods||jsonb_build_array(tlb.recipe_pick(g,array['id','name'])||jsonb_build_object('steps',tlb.recipe_pick_array(g->'steps',array['id','instruction','timer_minutes','temperature','equipment','image_id','warning','note'])));
  end loop;
  variants:=variants||jsonb_build_array(tlb.recipe_pick(v,array['id','name','production_notes'])||jsonb_build_object('groups',groups,'methods',methods,
   'yield',tlb.recipe_pick(v->'yield',array['quantity','unit','portions','portion_weight','batch_weight','finished_weight','pan_size','pans','loss_percent']),
   'packaging',tlb.recipe_pick(v->'packaging',array['description','dimensions','box','board','notes','photos']),
   'baking',tlb.recipe_pick_array(v->'baking',array['id','name','top','bottom','actual_bottom','temperature','fan','minutes','core','ingredient_temperature','batter_temperature','resting_temperature','cooling_minutes','freezing_minutes','notes']),
   'equipment',tlb.recipe_pick_array(v->'equipment',array['id','name','notes']),
   'components',tlb.recipe_pick_array(v->'components',array['id','version_id','variant_id','quantity','unit','mode','notes']),
   'photos',tlb.recipe_pick_array(v->'photos',array['id','file_id','caption','purpose'])));
 end loop;
 return d||jsonb_build_object('variants',variants,'photos',tlb.recipe_pick_array(p_doc->'photos',array['id','file_id','caption','purpose']));
end $$;
alter table tlb.recipe_versions add column kitchen_search tsvector generated always as (to_tsvector('simple'::regconfig,tlb.recipe_kitchen_document(document)::text)) stored;
create index recipe_kitchen_search on tlb.recipe_versions using gin(kitchen_search);

create function tlb.recipe_readable_versions() returns table(id uuid) language sql stable security invoker set search_path='' as $$
 with recursive published(id) as (
  select production_version_id from tlb.recipes where deleted_at is null and production_version_id is not null
  union select l.target_version_id from tlb.recipe_links l join published p on p.id=l.version_id where l.kind='component'
 ) select id from published
$$;
create function public.recipe_file_access(p_path text,p_write boolean default false) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare role_name text:=tlb.recipe_role(auth.uid());
begin
 if role_name in ('owner','chef') then
  return exists(select 1 from tlb.recipe_files f where f.path=p_path and (not p_write or (not f.uploaded and f.created_by=auth.uid())));
 end if;
 if role_name='kitchen' and not p_write then
  return exists(select 1 from tlb.recipe_files f join tlb.recipe_file_links l on l.file_id=f.id
   where f.path=p_path and f.uploaded and l.visibility='kitchen' and l.version_id in(select id from tlb.recipe_readable_versions()));
 end if;return false;
end $$;
revoke all on function public.recipe_file_access(text,boolean) from public,anon;
grant execute on function public.recipe_file_access(text,boolean) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values(
 'recipe-files','recipe-files',false,26214400,array['image/jpeg','image/png','image/webp','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain']);
create policy recipe_file_read on storage.objects for select to authenticated using(bucket_id='recipe-files' and public.recipe_file_access(name,false));
create policy recipe_file_insert on storage.objects for insert to authenticated with check(bucket_id='recipe-files' and public.recipe_file_access(name,true));
-- Deliberately no client UPDATE or DELETE policy: historical assets are immutable.

create function tlb.recipe_unit(p_unit text) returns jsonb language sql immutable set search_path='' as $$
 select case lower(btrim(p_unit))
 when 'g' then '["mass",1]'::jsonb when 'gram' then '["mass",1]'::jsonb when 'grams' then '["mass",1]'::jsonb
 when 'kg' then '["mass",1000]'::jsonb when 'mg' then '["mass",0.001]'::jsonb
 when 'ml' then '["volume",1]'::jsonb when 'l' then '["volume",1000]'::jsonb when 'litre' then '["volume",1000]'::jsonb when 'liter' then '["volume",1000]'::jsonb
 when 'pc' then '["count",1]'::jsonb when 'pcs' then '["count",1]'::jsonb when 'piece' then '["count",1]'::jsonb when 'pieces' then '["count",1]'::jsonb
 else jsonb_build_array('custom:'||lower(btrim(p_unit)),1) end
$$;
create function tlb.recipe_capture_costs(p_doc jsonb) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v jsonb;g jsonb;r jsonb;price jsonb;variants jsonb:='[]';groups jsonb;rows jsonb;line_cost numeric;total numeric;
 totals jsonb:='[]';lines jsonb;missing jsonb;u jsonb;pu jsonb;currency text:=coalesce(p_doc->>'currency','PHP');extra jsonb;qty numeric;
 component jsonb;child tlb.recipe_versions;size jsonb;child_cost jsonb;allergens jsonb:='[]';detected jsonb;ratio numeric;extras jsonb;
begin
 for v in select value from jsonb_array_elements(p_doc->'variants') loop
  groups:='[]';lines:='[]';missing:='[]';total:=0;
  for g in select value from jsonb_array_elements(v->'groups') loop
   rows:='[]';for r in select value from jsonb_array_elements(g->'ingredients') loop
    price:=r->'cost_snapshot';
    if nullif(r->>'ingredient_id','') is not null then
     select coalesce(data->'allergens','[]') into detected from tlb.recipe_resources where id=(r->>'ingredient_id')::uuid;
     allergens:=allergens||coalesce(detected,'[]');
     select jsonb_build_object('price_id',id,'amount',amount::text,'quantity',quantity::text,'unit',unit,'currency',p.currency,'recorded_at',created_at,'supplier_id',supplier_id)
     into price from tlb.recipe_prices p where resource_id=(r->>'ingredient_id')::uuid order by created_at desc,id limit 1;
    end if;
    if price is not null and price<>'null'::jsonb then
     perform tlb.recipe_quantity(price->>'amount');perform tlb.require(tlb.recipe_quantity(price->>'quantity')>0,'Purchase quantity must be positive.');
     perform tlb.require(length(btrim(price->>'unit')) between 1 and 40,'Choose a purchase unit.');
     u:=tlb.recipe_unit(r->>'unit');pu:=tlb.recipe_unit(price->>'unit');
     if u->>0=pu->>0 and coalesce(price->>'currency','PHP')=currency then
      line_cost:=tlb.recipe_quantity(r->>'quantity')*(u->>1)::numeric/(pu->>1)::numeric/tlb.recipe_quantity(price->>'quantity')*tlb.recipe_quantity(price->>'amount');
      total:=total+line_cost;lines:=lines||jsonb_build_array(jsonb_build_object('row_id',r->>'id','name',r->>'name','amount',line_cost::text,'price',price));
     else missing:=missing||jsonb_build_array(jsonb_build_object('row_id',r->>'id','name',r->>'name','reason','Unit or currency conversion required'));end if;
     r:=r||jsonb_build_object('cost_snapshot',price);
    else
     r:=r-'cost_snapshot';missing:=missing||jsonb_build_array(jsonb_build_object('row_id',r->>'id','name',r->>'name','reason','Price not entered'));
    end if;
    rows:=rows||jsonb_build_array(r);
   end loop;groups:=groups||jsonb_build_array(g||jsonb_build_object('ingredients',rows));
  end loop;
  for component in select value from jsonb_array_elements(coalesce(v->'components','[]')) loop
   select * into child from tlb.recipe_versions where id=(component->>'version_id')::uuid;
   perform tlb.require(child.id is not null,'A component version no longer exists.');
   select value into size from jsonb_array_elements(child.document->'variants') where nullif(component->>'variant_id','') is null or value->>'id'=component->>'variant_id' limit 1;
   perform tlb.require(size is not null,'A component size no longer exists.');
   perform tlb.require(nullif(component->>'unit','') is null or lower(component->>'unit')=lower(size#>>'{yield,unit}'),'Component quantity must use its saved yield unit.');
   ratio:=tlb.recipe_quantity(component->>'quantity')/tlb.recipe_quantity(size#>>'{yield,quantity}');
   select value into child_cost from jsonb_array_elements(child.cost_snapshot->'variants') where value->>'variant_id'=size->>'id';
   if child_cost is null or child.cost_snapshot->>'currency' is distinct from currency then
    missing:=missing||jsonb_build_array(jsonb_build_object('name',child.document->>'name','reason','Component cost or currency unavailable'));
   else
    line_cost:=(child_cost->>'total')::numeric*ratio;total:=total+line_cost;
    lines:=lines||jsonb_build_array(jsonb_build_object('name',child.document->>'name','component_version_id',child.id,'amount',line_cost::text,'multiplier',ratio::text));
    if not coalesce((child_cost->>'complete')::boolean,false) then missing:=missing||jsonb_build_array(jsonb_build_object('name',child.document->>'name','reason','Component has incomplete costs'));end if;
   end if;
   allergens:=allergens||coalesce(child.document->'allergens','[]')||coalesce(child.document->'detected_allergens','[]');
  end loop;
  extras:='[]';
  for extra in select value from jsonb_array_elements(coalesce(v->'additional_costs','[]')) loop
   line_cost:=tlb.recipe_quantity(extra->>'amount');
   if nullif(extra->>'resource_id','') is not null then
    perform tlb.require(exists(select 1 from tlb.recipe_resources where id=(extra->>'resource_id')::uuid and kind='packaging'),'Packaging reference no longer exists.');
    select to_jsonb(p) into price from tlb.recipe_prices p where resource_id=(extra->>'resource_id')::uuid order by created_at desc,id limit 1;
    u:=tlb.recipe_unit(extra->>'unit');pu:=tlb.recipe_unit(price->>'unit');
    if price is null or u->>0 is distinct from pu->>0 or price->>'currency' is distinct from currency then
     missing:=missing||jsonb_build_array(jsonb_build_object('name',extra->>'resource_name','reason','Packaging price or unit conversion missing'));line_cost:=0;
    else line_cost:=tlb.recipe_quantity(extra->>'quantity')*(u->>1)::numeric/(pu->>1)::numeric/(price->>'quantity')::numeric*(price->>'amount')::numeric;end if;
    extra:=extra||jsonb_build_object('cost_snapshot',price,'amount',line_cost::text);
   end if;
   total:=total+line_cost;extras:=extras||jsonb_build_array(extra);
   lines:=lines||jsonb_build_array(jsonb_build_object('name',coalesce(extra->>'resource_name',extra->>'name'),'amount',line_cost::text,'additional',true));
  end loop;
  qty:=case when nullif(v#>>'{yield,portions}','') is not null then tlb.recipe_quantity(v#>>'{yield,portions}') else 0 end;
  totals:=totals||jsonb_build_array(jsonb_build_object('variant_id',v->>'id','lines',lines,'total',total::text,'per_yield',(total/tlb.recipe_quantity(v#>>'{yield,quantity}'))::text,'per_portion',case when qty>0 then (total/qty)::text else null end,'complete',jsonb_array_length(missing)=0,'missing',missing));
  variants:=variants||jsonb_build_array(v||jsonb_build_object('groups',groups,'additional_costs',extras));
 end loop;
 select coalesce(jsonb_agg(value order by value),'[]') into allergens from (select distinct value from jsonb_array_elements_text(allergens)) a;
 return jsonb_build_object('document',p_doc||jsonb_build_object('variants',variants,'detected_allergens',allergens),
  'snapshot',jsonb_build_object('format_version',1,'currency',currency,'calculated_at',now(),'variants',totals));
end $$;

create function tlb.recipe_save_version(p_id uuid,p_revision bigint,p_doc jsonb,p_status text,p_reason text default '',p_cost jsonb default '{}') returns uuid
language plpgsql security invoker set search_path='' as $$
declare recipe tlb.recipes; vid uuid:=gen_random_uuid(); num integer;v jsonb;g jsonb;r jsonb;link jsonb;target tlb.recipe_versions;
 fid uuid; role_name text:=tlb.recipe_assert(true); doc jsonb:=p_doc; cat uuid; costing jsonb;cost jsonb:=p_cost;
begin
 perform tlb.recipe_validate(doc);
 perform tlb.require(p_status in ('draft','testing','approved','production','archived'),'Choose a valid recipe status.');
 if p_status in ('approved','production','archived') then perform tlb.recipe_assert(true,true);end if;
 if p_status in ('approved','production') then
  for v in select value from jsonb_array_elements(doc->'variants') loop
   perform tlb.require(exists(select 1 from jsonb_array_elements(v->'groups') grp cross join lateral jsonb_array_elements(grp.value->'ingredients')) or jsonb_array_length(coalesce(v->'components','[]'))>0,'Add ingredients or a linked component before approving each size.');
  end loop;
 end if;
 if p_status in ('approved','production') and doc ? 'import_review' then
  perform tlb.require(coalesce((doc#>>'{import_review,reviewed}')::boolean,false),'Review imported quantities and yield before approving this recipe.');
 end if;
 select * into recipe from tlb.recipes where id=p_id for update;
 perform tlb.require(recipe.id is not null and recipe.deleted_at is null,'Recipe was removed or does not exist.');
 perform tlb.require(recipe.revision=p_revision,'This recipe changed in another window. Reload before saving.');
 cat:=nullif(doc->>'category_id','')::uuid;
 if cat is not null then perform tlb.require(exists(select 1 from tlb.recipe_categories where id=cat),'Recipe category no longer exists.');end if;
 if cost='{}'::jsonb then costing:=tlb.recipe_capture_costs(doc);doc:=costing->'document';cost:=costing->'snapshot';end if;
 select coalesce(max(number),0)+1 into num from tlb.recipe_versions where recipe_id=p_id;
 insert into tlb.recipe_versions(id,recipe_id,number,status,document,cost_snapshot,reason,created_by)
 values(vid,p_id,num,p_status,doc,cost,coalesce(p_reason,''),auth.uid());
 for v in select value from jsonb_array_elements(doc->'variants') loop
  for g in select value from jsonb_array_elements(v->'groups') loop
   for r in select value from jsonb_array_elements(g->'ingredients') loop
    if nullif(r->>'ingredient_id','') is not null then
     insert into tlb.recipe_ingredient_links(version_id,resource_id,row_id) values(vid,(r->>'ingredient_id')::uuid,r->>'id');
    end if;
   end loop;
  end loop;
  for link in select value from jsonb_array_elements(coalesce(v->'components','[]')) loop
   select * into target from tlb.recipe_versions where id=(link->>'version_id')::uuid;
   perform tlb.require(target.id is not null,'A component version no longer exists.');
   perform tlb.require(target.recipe_id<>p_id,'A recipe cannot use itself as a component.');
   perform tlb.require(exists(select 1 from tlb.recipes where id=target.recipe_id and deleted_at is null),'A component recipe was removed.');
   if p_status in ('approved','production') then perform tlb.require(target.status in ('approved','production'),'Approve linked components before publishing this recipe.');end if;
   perform tlb.require(not exists(with recursive chain(id) as (
    select target.id union select l.target_version_id from tlb.recipe_links l join chain c on c.id=l.version_id
   ) select 1 from chain c join tlb.recipe_versions t on t.id=c.id where t.recipe_id=p_id),'Component links cannot form a cycle.');
   perform tlb.require(tlb.recipe_quantity(link->>'quantity')>0,'Component quantity must be positive.');
   perform tlb.require(length(link->>'id') between 1 and 100,'A component needs an ID.');
   insert into tlb.recipe_links(version_id,target_version_id,link_id,kind,mode,quantity)
   values(vid,target.id,(v->>'id')||':'||(link->>'id'),'component',coalesce(link->>'mode','pinned'),link->>'quantity');
  end loop;
 end loop;
 if nullif(doc#>>'{base,version_id}','') is not null then
  select * into target from tlb.recipe_versions where id=(doc#>>'{base,version_id}')::uuid;
  perform tlb.require(target.id is not null and target.recipe_id<>p_id,'Choose a different recipe as the variation base.');
  perform tlb.require(not exists(with recursive chain(id) as (
   select target.id union select l.target_version_id from tlb.recipe_links l join chain c on c.id=l.version_id
  ) select 1 from chain c join tlb.recipe_versions t on t.id=c.id where t.recipe_id=p_id),'Variation links cannot form a cycle.');
  insert into tlb.recipe_links(version_id,target_version_id,link_id,kind,mode) values(vid,target.id,'variation-base','variation','pinned');
 end if;
 for r in select value from jsonb_array_elements(coalesce(doc->'files','[]')) loop
  fid:=(r->>'id')::uuid;
  perform tlb.require(exists(select 1 from tlb.recipe_files where id=fid and uploaded),'Finish uploading recipe files before saving.');
  insert into tlb.recipe_file_links(file_id,version_id,visibility) values(fid,vid,coalesce(r->>'visibility','private'));
 end loop;
 update tlb.recipes set name=doc->>'name',category_id=cat,current_version_id=vid,
  production_version_id=case when p_status='production' then vid when p_status='archived' then null else production_version_id end,
  revision=revision+1,updated_at=now(),updated_by=auth.uid() where id=p_id;
 insert into tlb.recipe_audit(recipe_id,actor,action,details) values(p_id,auth.uid(),'version_created',
  jsonb_build_object('previous_version_id',recipe.current_version_id,'version_id',vid,'number',num,'status',p_status,'reason',p_reason));
 return vid;
end $$;

create function tlb.recipe_detail(p_id uuid,p_version uuid default null,p_kitchen boolean default false) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare role_name text:=tlb.recipe_assert();r tlb.recipes;v tlb.recipe_versions;links jsonb;files jsonb;
begin
 if p_kitchen then role_name:='kitchen';end if;
 select * into r from tlb.recipes where id=p_id;
 perform tlb.require(r.id is not null,'Recipe not found.');
 select * into v from tlb.recipe_versions where recipe_id=p_id and id=coalesce(p_version,case when role_name='kitchen' then r.production_version_id else r.current_version_id end);
 perform tlb.require(v.id is not null,'Recipe version not found.');
 if role_name='kitchen' then
  perform tlb.require(r.deleted_at is null and v.id in(select id from tlb.recipe_readable_versions()),'This recipe is not available for kitchen viewing.');
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',l.link_id,'kind',l.kind,'mode',l.mode,'version_id',t.id,'recipe_id',t.recipe_id,
  'name',t.document->>'name','number',t.number,'quantity',l.quantity,'update_available',l.mode='latest' and rr.production_version_id is distinct from t.id)), '[]') into links
 from tlb.recipe_links l join tlb.recipe_versions t on t.id=l.target_version_id join tlb.recipes rr on rr.id=t.recipe_id where l.version_id=v.id and (role_name<>'kitchen' or l.kind='component');
 select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'filename',f.filename,'mime_type',f.mime_type,'path',f.path,'size_bytes',f.size_bytes,'visibility',l.visibility)), '[]') into files
 from tlb.recipe_file_links l join tlb.recipe_files f on f.id=l.file_id where l.version_id=v.id and (role_name<>'kitchen' or l.visibility='kitchen');
 return jsonb_build_object('id',r.id,'code',r.code,'revision',r.revision,'version_id',v.id,'version',v.number,'status',v.status,
  'production_version_id',r.production_version_id,'deleted_at',r.deleted_at,'created_at',r.created_at,'updated_at',v.created_at,
  'document',case when role_name='kitchen' then tlb.recipe_kitchen_document(v.document) else v.document end,
  'cost_snapshot',case when role_name='kitchen' then null else v.cost_snapshot end,'links',links,'files',files,
  'created_by',case when role_name='kitchen' then null else v.created_by end,'reason',case when role_name='kitchen' then null else v.reason end);
end $$;

create function public.recipe_api(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare role_name text:=tlb.recipe_assert();uid uuid:=auth.uid();rid uuid;vid uuid;fid uuid;resource tlb.recipe_resources;
 recipe tlb.recipes;ver tlb.recipe_versions;test_record tlb.recipe_tests;result jsonb;data jsonb;doc jsonb;
 n integer;lim integer:=least(100,greatest(1,coalesce((p_payload->>'limit')::int,30)));
 off integer:=greatest(0,coalesce((p_payload->>'offset')::int,0));q text:=left(btrim(coalesce(p_payload->>'query','')),200);resource_kind text;
begin
 if p_action='list' and coalesce((p_payload->>'kitchen')::boolean,false) then role_name:='kitchen';end if;
 if p_action='bootstrap' then
  return jsonb_build_object('role',role_name,'categories',(select coalesce(jsonb_agg(to_jsonb(c) order by sort_order,lower(name)),'[]') from tlb.recipe_categories c),
   'authors',case when role_name='kitchen' then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.email) order by u.email),'[]') from auth.users u where exists(select 1 from tlb.recipe_versions v where v.created_by=u.id)) end,
   'settings',(select case when role_name='owner' then settings else tlb.recipe_pick(settings,array['paper','rounding','kitchen_font_size']) end from tlb.recipe_settings where id));
 elsif p_action='list' then
  select jsonb_build_object('total',count(*),'rows',coalesce((select jsonb_agg(item order by sort_name,id) from (
   select jsonb_build_object('id',r.id,'code',r.code,'name',v.document->>'name','category_id',v.document->>'category_id','status',v.status,
    'version',v.number,'updated_at',v.created_at,'revision',r.revision,'deleted_at',r.deleted_at,'favorite',coalesce(u.favorite,false),
    'pinned',coalesce(u.pinned,false),'last_viewed_at',u.last_viewed_at,'tags',coalesce(v.document->'tags','[]')) item,lower(v.document->>'name') sort_name,r.id
   from tlb.recipes r join tlb.recipe_versions v on v.id=case when role_name='kitchen' then r.production_version_id else r.current_version_id end
   left join tlb.recipe_user_state u on u.recipe_id=r.id and u.user_id=uid
   where (case when coalesce((p_payload->>'deleted')::boolean,false) and role_name='owner' then r.deleted_at is not null else r.deleted_at is null end)
    and (q='' or (case when role_name='kitchen' then v.kitchen_search else v.search_text end)@@plainto_tsquery('simple',q) or v.document->>'name' ilike '%'||q||'%')
    and (nullif(p_payload->>'category_id','') is null or v.document->>'category_id'=p_payload->>'category_id')
    and (nullif(p_payload->>'status','') is null or v.status=p_payload->>'status')
    and (nullif(p_payload->>'tag','') is null or v.document->'tags' ? (p_payload->>'tag'))
    and (nullif(p_payload->>'author','') is null or v.created_by::text=p_payload->>'author')
    and (nullif(p_payload->>'version','') is null or v.number=(p_payload->>'version')::int)
    and (nullif(p_payload->>'updated_after','') is null or v.created_at>=(p_payload->>'updated_after')::timestamptz)
    and (nullif(p_payload->>'flavor','') is null or v.document->>'flavor'=p_payload->>'flavor')
    and (nullif(p_payload->>'product_line','') is null or v.document->>'product_line'=p_payload->>'product_line')
    and (not coalesce((p_payload->>'favorites')::boolean,false) or u.favorite)
    and (not coalesce((p_payload->>'pinned')::boolean,false) or u.pinned)
    and (not coalesce((p_payload->>'recent')::boolean,false) or u.last_viewed_at>now()-interval '30 days')
   order by lower(v.document->>'name'),r.id limit lim offset off
  ) rows),'[]')) into result
  from tlb.recipes r join tlb.recipe_versions v on v.id=case when role_name='kitchen' then r.production_version_id else r.current_version_id end
  left join tlb.recipe_user_state u on u.recipe_id=r.id and u.user_id=uid
  where (case when coalesce((p_payload->>'deleted')::boolean,false) and role_name='owner' then r.deleted_at is not null else r.deleted_at is null end)
   and (q='' or (case when role_name='kitchen' then v.kitchen_search else v.search_text end)@@plainto_tsquery('simple',q) or v.document->>'name' ilike '%'||q||'%')
   and (nullif(p_payload->>'category_id','') is null or v.document->>'category_id'=p_payload->>'category_id')
   and (nullif(p_payload->>'status','') is null or v.status=p_payload->>'status')
   and (nullif(p_payload->>'tag','') is null or v.document->'tags' ? (p_payload->>'tag'))
   and (nullif(p_payload->>'author','') is null or v.created_by::text=p_payload->>'author')
   and (nullif(p_payload->>'version','') is null or v.number=(p_payload->>'version')::int)
   and (nullif(p_payload->>'updated_after','') is null or v.created_at>=(p_payload->>'updated_after')::timestamptz)
   and (nullif(p_payload->>'flavor','') is null or v.document->>'flavor'=p_payload->>'flavor')
   and (nullif(p_payload->>'product_line','') is null or v.document->>'product_line'=p_payload->>'product_line')
   and (not coalesce((p_payload->>'favorites')::boolean,false) or u.favorite)
    and (not coalesce((p_payload->>'pinned')::boolean,false) or u.pinned)
   and (not coalesce((p_payload->>'recent')::boolean,false) or u.last_viewed_at>now()-interval '30 days');
  return result;
 elsif p_action='get' then
  rid:=(p_payload->>'id')::uuid;result:=tlb.recipe_detail(rid,nullif(p_payload->>'version_id','')::uuid,coalesce((p_payload->>'kitchen')::boolean,false));
  insert into tlb.recipe_user_state(user_id,recipe_id,last_viewed_at) values(uid,rid,now()) on conflict(user_id,recipe_id) do update set last_viewed_at=now();return result;
 elsif p_action='favorite' then
  rid:=(p_payload->>'id')::uuid;perform tlb.recipe_detail(rid);
  insert into tlb.recipe_user_state(user_id,recipe_id,favorite,pinned) values(uid,rid,coalesce((p_payload->>'favorite')::boolean,false),coalesce((p_payload->>'pinned')::boolean,false))
  on conflict(user_id,recipe_id) do update set favorite=excluded.favorite,pinned=excluded.pinned;return jsonb_build_object('saved',true);
 end if;
 perform tlb.recipe_assert(true);
 if p_action='cost_preview' then perform tlb.recipe_validate(p_payload->'document');return tlb.recipe_capture_costs(p_payload->'document');end if;
 if p_action='runs' then return (select coalesce(jsonb_agg(to_jsonb(batch) order by produced_on desc,created_at desc),'[]') from (select * from tlb.recipe_runs where recipe_id=(p_payload->>'id')::uuid order by produced_on desc,created_at desc limit lim offset off) batch);end if;
 if p_action='record_run' then
  select * into ver from tlb.recipe_versions where id=(p_payload->>'version_id')::uuid;
  perform tlb.require(ver.id is not null and ver.status in ('approved','production'),'Choose an approved recipe version for production.');
  select value into data from jsonb_array_elements(ver.document->'variants') where value->>'id'=p_payload->>'variant_id';
  perform tlb.require(data is not null,'Production size not found.');
  perform tlb.require(tlb.recipe_quantity(p_payload->>'multiplier')>0,'Production multiplier must be positive.');
  insert into tlb.recipe_runs(recipe_id,version_id,variant_id,multiplier,scaling_mode,planned_yield,actual_yield,yield_unit,produced_on,notes,created_by)
  values(ver.recipe_id,ver.id,data->>'id',p_payload->>'multiplier',coalesce(p_payload->>'scaling_mode','multiplier'),tlb.recipe_quantity(data#>>'{yield,quantity}')*case when p_payload->>'scaling_mode'='portion' and tlb.recipe_unit(data#>>'{yield,unit}')->>0 not in ('mass','volume') then 1 else tlb.recipe_quantity(p_payload->>'multiplier') end,
   tlb.recipe_quantity(p_payload->>'actual_yield'),data#>>'{yield,unit}',(p_payload->>'produced_on')::date,left(coalesce(p_payload->>'notes',''),20000),uid) returning to_jsonb(tlb.recipe_runs.*) into result;
  insert into tlb.recipe_audit(recipe_id,actor,action,details) values(ver.recipe_id,uid,'production_recorded',result);return result;
 end if;
 if p_action in ('create','save','duplicate','restore_version','promote_test') then
  doc:=p_payload->'document';
  if p_action in ('restore_version','duplicate') then
   select * into ver from tlb.recipe_versions where id=(p_payload->>'version_id')::uuid;
   perform tlb.require(ver.id is not null,'Source version not found.');doc:=ver.document;
  elsif p_action='promote_test' then
   perform tlb.recipe_assert(true,true);
   select * into test_record from tlb.recipe_tests where id=(p_payload->>'test_id')::uuid for update;
   perform tlb.require(test_record.id is not null and test_record.proposed_document is not null,'Save the tested formula before promoting this test.');
   perform tlb.require(test_record.promoted_version_id is null,'This test has already been promoted.');doc:=test_record.proposed_document;
  end if;
  if p_action in ('create','duplicate') then
   rid:=gen_random_uuid();
   if p_action='duplicate' then
    doc:=jsonb_set(doc,'{name}',to_jsonb(coalesce(nullif(btrim(p_payload->>'name'),''),(doc->>'name')||' — copy')));
    if p_payload->>'mode'='variation' then doc:=doc||jsonb_build_object('base',jsonb_build_object('version_id',ver.id,'name',ver.document->>'name','overrides','[]'::jsonb));end if;
   end if;
   perform tlb.recipe_validate(doc);
   insert into tlb.recipes(id,code,name,created_by,updated_by) values(rid,coalesce(nullif(p_payload->>'code',''),'R-'||upper(substr(replace(rid::text,'-',''),1,12))),doc->>'name',uid,uid);
   vid:=tlb.recipe_save_version(rid,1,doc,case when p_action='duplicate' then case when p_payload->>'mode'='test' then 'testing' else 'draft' end else coalesce(p_payload->>'status','draft') end,p_payload->>'reason');
  else
   rid:=case when p_action='restore_version' then ver.recipe_id when p_action='promote_test' then test_record.recipe_id else (p_payload->>'id')::uuid end;
   vid:=tlb.recipe_save_version(rid,(p_payload->>'revision')::bigint,doc,coalesce(p_payload->>'status','draft'),p_payload->>'reason',case when p_action='restore_version' then ver.cost_snapshot else '{}' end);
   if p_action='promote_test' then update tlb.recipe_tests set promoted_version_id=vid,revision=revision+1,updated_at=now(),updated_by=uid where id=test_record.id;end if;
  end if;return tlb.recipe_detail(rid,vid);
 elsif p_action='versions' then
  return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'number',number,'status',status,'created_at',created_at,'created_by',created_by,'author',coalesce((select email from auth.users where id=versions.created_by),'Former account'),'reason',reason) order by number desc),'[]') from (
   select * from tlb.recipe_versions where recipe_id=(p_payload->>'id')::uuid order by number desc limit lim offset off
  ) versions);
 elsif p_action='audit' then return (select coalesce(jsonb_agg(to_jsonb(a) order by id desc),'[]') from (select * from tlb.recipe_audit where recipe_id=(p_payload->>'id')::uuid order by id desc limit lim offset off) a);
 elsif p_action='autosave' then
  perform tlb.require(jsonb_typeof(p_payload->'document')='object' and octet_length((p_payload->'document')::text)<=2097152,'Draft is too large.');
  insert into tlb.recipe_drafts(user_id,draft_id,recipe_id,base_revision,document) values(uid,(p_payload->>'draft_id')::uuid,nullif(p_payload->>'id','')::uuid,(p_payload->>'revision')::bigint,p_payload->'document')
  on conflict(user_id,draft_id) do update set document=excluded.document,base_revision=excluded.base_revision,updated_at=now();return jsonb_build_object('saved_at',now());
 elsif p_action='drafts' then return (select coalesce(jsonb_agg(to_jsonb(d) order by updated_at desc),'[]') from(select * from tlb.recipe_drafts where user_id=uid order by updated_at desc limit lim offset off)d);
 elsif p_action='remove_draft' then delete from tlb.recipe_drafts where user_id=uid and draft_id=(p_payload->>'draft_id')::uuid;return jsonb_build_object('removed',true);
 elsif p_action='tests' then return (select coalesce(jsonb_agg(to_jsonb(t) order by number desc),'[]') from(select * from tlb.recipe_tests where recipe_id=(p_payload->>'id')::uuid order by number desc limit lim offset off)t);
 elsif p_action='save_test' then
  rid:=(p_payload->>'recipe_id')::uuid;select * into recipe from tlb.recipes where id=rid for update;
  perform tlb.require(recipe.id is not null and recipe.deleted_at is null,'Recipe not found.');
  data:=p_payload->'data';perform tlb.require(jsonb_typeof(data)='object' and octet_length(data::text)<=524288,'Enter a valid testing log.');
  if nullif(data->>'rating','') is not null then perform tlb.require((data->>'rating')::numeric between 0 and 5,'Rating must be between zero and five.');end if;
  if p_payload->'proposed_document' is not null and p_payload->'proposed_document'<>'null'::jsonb then perform tlb.recipe_validate(p_payload->'proposed_document');end if;
  if nullif(p_payload->>'id','') is null then
   select coalesce(max(number),0)+1 into n from tlb.recipe_tests where recipe_id=rid;
   insert into tlb.recipe_tests(recipe_id,version_id,number,data,proposed_document,created_by,updated_by)
   values(rid,(p_payload->>'version_id')::uuid,n,data,nullif(p_payload->'proposed_document','null'::jsonb),uid,uid) returning * into test_record;
  else
   select * into test_record from tlb.recipe_tests where id=(p_payload->>'id')::uuid and recipe_id=rid for update;
   perform tlb.require(test_record.id is not null and test_record.revision=(p_payload->>'revision')::bigint,'The testing log changed. Reload before saving.');
   perform tlb.require(test_record.promoted_version_id is null,'A promoted test is preserved; create a new test for further changes.');
   insert into tlb.recipe_audit(recipe_id,actor,action,details) values(rid,uid,'test_updated',jsonb_build_object('test_id',test_record.id,'previous',to_jsonb(test_record),'new_data',data));
   update tlb.recipe_tests set data=p_payload->'data',proposed_document=nullif(p_payload->'proposed_document','null'::jsonb),revision=revision+1,updated_at=now(),updated_by=uid where id=test_record.id returning * into test_record;
  end if;
  for result in select value from jsonb_array_elements(coalesce(data->'photos','[]')) loop
   fid:=(result->>'id')::uuid;
   perform tlb.require(exists(select 1 from tlb.recipe_files where id=fid and uploaded),'Finish uploading test photos before saving.');
   insert into tlb.recipe_file_links(file_id,test_id,visibility) values(fid,test_record.id,'private') on conflict(file_id,test_id) where test_id is not null do nothing;
  end loop;
  return to_jsonb(test_record);
 elsif p_action='resources' then
  perform tlb.require(p_payload->>'kind' in ('ingredient','supplier','packaging','equipment'),'Choose a resource type.');
  return (select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('price',(select to_jsonb(p) from tlb.recipe_prices p where resource_id=r.id order by created_at desc,id limit 1)) order by lower(name),id),'[]'))
   from(select * from tlb.recipe_resources where kind=p_payload->>'kind' and (q='' or name ilike '%'||q||'%') and (coalesce((p_payload->>'include_inactive')::boolean,false) or active) order by lower(name),id limit lim offset off)r);
 elsif p_action='save_resource' then
  resource_kind:=p_payload->>'kind';perform tlb.require(resource_kind in ('ingredient','supplier','packaging','equipment'),'Choose a resource type.');
  data:=coalesce(p_payload->'data','{}');perform tlb.require(jsonb_typeof(data)='object' and octet_length(data::text)<=524288,'Resource details are invalid.');
  if nullif(p_payload->>'id','') is null then
   insert into tlb.recipe_resources(kind,name,data,updated_by) values(resource_kind,btrim(p_payload->>'name'),data,uid) returning * into resource;
  else
   select * into resource from tlb.recipe_resources where id=(p_payload->>'id')::uuid for update;
   perform tlb.require(resource.id is not null and resource.kind=resource_kind and resource.revision=(p_payload->>'revision')::bigint,'This resource changed. Reload before saving.');
   insert into tlb.recipe_audit(actor,action,details) values(uid,'resource_updated',jsonb_build_object('previous',to_jsonb(resource),'new_data',data,'new_name',p_payload->>'name'));
   update tlb.recipe_resources set name=btrim(p_payload->>'name'),data=p_payload->'data',active=coalesce((p_payload->>'active')::boolean,true),revision=revision+1,updated_at=now(),updated_by=uid where id=resource.id returning * into resource;
  end if;
  if p_payload->'price' is not null and p_payload->'price'<>'null'::jsonb then
   perform tlb.require(resource_kind in ('ingredient','packaging'),'Only ingredients and packaging have purchase prices.');
   fid:=nullif(p_payload#>>'{price,supplier_id}','')::uuid;
   if fid is not null then
    perform tlb.require(exists(select 1 from tlb.recipe_resources where id=fid and kind='supplier'),'Supplier not found.');
    insert into tlb.recipe_supplier_items(resource_id,supplier_id) values(resource.id,fid) on conflict do nothing;
   end if;
   insert into tlb.recipe_prices(resource_id,supplier_id,amount,quantity,unit,currency,notes,created_by)
   values(resource.id,fid,tlb.recipe_quantity(p_payload#>>'{price,amount}'),tlb.recipe_quantity(p_payload#>>'{price,quantity}'),p_payload#>>'{price,unit}',coalesce(p_payload#>>'{price,currency}','PHP'),coalesce(p_payload#>>'{price,notes}',''),uid);
  end if;return to_jsonb(resource);
 elsif p_action='prices' then return (select coalesce(jsonb_agg(to_jsonb(p) order by created_at desc,id),'[]') from(select * from tlb.recipe_prices where resource_id=(p_payload->>'id')::uuid order by created_at desc,id limit lim offset off)p);
 elsif p_action='reserve_file' then
  fid:=gen_random_uuid();perform tlb.require(p_payload->>'mime_type'=any(array['image/jpeg','image/png','image/webp','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain']),'Unsupported recipe file type.');
  insert into tlb.recipe_files(id,path,filename,mime_type,size_bytes,sha256,created_by)
  values(fid,uid::text||'/'||fid::text,left(p_payload->>'filename',250),p_payload->>'mime_type',(p_payload->>'size_bytes')::bigint,p_payload->>'sha256',uid) returning to_jsonb(tlb.recipe_files.*) into result;return result;
 elsif p_action='confirm_file' then
  fid:=(p_payload->>'id')::uuid;
  perform tlb.require(exists(select 1 from tlb.recipe_files f join storage.objects o on o.name=f.path and o.bucket_id='recipe-files' where f.id=fid and f.created_by=uid and (o.metadata->>'size')::bigint=f.size_bytes and o.metadata->>'mimetype'=f.mime_type),'The upload has not finished or its size/type does not match.');
  update tlb.recipe_files set uploaded=true where id=fid and created_by=uid;return jsonb_build_object('uploaded',true);
 end if;
 perform tlb.recipe_assert(true,true);
 if p_action='access' then return (select coalesce(jsonb_agg(jsonb_build_object('user_id',s.user_id,'email',u.email,'role',s.role,'recipe_permission',a.permission) order by u.email),'[]') from tlb.staff s join auth.users u on u.id=s.user_id left join tlb.recipe_access a on a.user_id=s.user_id);
 elsif p_action='save_access' then
  fid:=(p_payload->>'user_id')::uuid;
  if nullif(p_payload->>'permission','') is null then delete from tlb.recipe_access where user_id=fid;
  else insert into tlb.recipe_access(user_id,permission,granted_by) values(fid,p_payload->>'permission',uid) on conflict(user_id) do update set permission=excluded.permission,granted_by=uid,updated_at=now();end if;
  insert into tlb.recipe_audit(actor,action,details) values(uid,'access_changed',jsonb_build_object('user_id',fid,'permission',p_payload->>'permission'));return jsonb_build_object('saved',true);
 elsif p_action in ('delete','undelete') then
  rid:=(p_payload->>'id')::uuid;select * into recipe from tlb.recipes where id=rid for update;
  perform tlb.require(recipe.id is not null and recipe.revision=(p_payload->>'revision')::bigint,'This recipe changed. Reload before removing it.');
  if p_action='delete' then
   perform tlb.require(not exists(select 1 from tlb.recipe_links l join tlb.recipe_versions v on v.id=l.target_version_id join tlb.recipes parent on parent.current_version_id=l.version_id or parent.production_version_id=l.version_id where v.recipe_id=rid and parent.deleted_at is null),'Other recipes use this component. Remove those links before deleting it.');
  end if;
  update tlb.recipes set deleted_at=case when p_action='delete' then now() else null end,revision=revision+1,updated_at=now(),updated_by=uid where id=rid;
  insert into tlb.recipe_audit(recipe_id,actor,action) values(rid,uid,p_action);return jsonb_build_object('saved',true);
 elsif p_action='save_category' then
  fid:=coalesce(nullif(p_payload->>'id','')::uuid,gen_random_uuid());rid:=nullif(p_payload->>'parent_id','')::uuid;
  perform tlb.require(not exists(with recursive parents(id,parent_id) as (select id,parent_id from tlb.recipe_categories where id=rid union select c.id,c.parent_id from tlb.recipe_categories c join parents p on c.id=p.parent_id) select 1 from parents where id=fid),'Categories cannot contain themselves.');
  insert into tlb.recipe_categories(id,name,parent_id,sort_order,active) values(fid,btrim(p_payload->>'name'),rid,coalesce((p_payload->>'sort_order')::int,0),coalesce((p_payload->>'active')::boolean,true))
  on conflict(id) do update set name=excluded.name,parent_id=excluded.parent_id,sort_order=excluded.sort_order,active=excluded.active;return jsonb_build_object('id',fid);
 elsif p_action='save_settings' then
  perform tlb.require(jsonb_typeof(p_payload->'settings')='object','Settings must be an object.');
  update tlb.recipe_settings set settings=settings||tlb.recipe_pick(p_payload->'settings',array['currency','paper','rounding','kitchen_font_size','export_defaults','daily_retention','monthly_retention']),revision=revision+1 where id;
  return jsonb_build_object('saved',true);
 end if;
 raise exception 'Unknown recipe action.';
end $$;
revoke all on function public.recipe_api(text,jsonb) from public,anon;
grant execute on function public.recipe_api(text,jsonb) to authenticated;

do $$ declare t record;f record;begin
 for t in select tablename from pg_tables where schemaname='tlb' and (tablename like 'recipe\_%' escape '\' or tablename='recipes') loop
  execute format('alter table tlb.%I enable row level security',t.tablename);
  execute format('revoke all on tlb.%I from public,anon,authenticated,service_role',t.tablename);
 end loop;
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='tlb' and p.proname like 'recipe\_%' escape '\' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end $$;
commit;
