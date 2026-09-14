-- TLB Kitchen draft ordering backend. No demo catalog, owner or banking data seeded.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists tlb;
revoke all on schema tlb from public, anon, authenticated;

create table tlb.secrets (id boolean primary key default true check(id), token_key text not null);
insert into tlb.secrets(token_key) values (encode(extensions.gen_random_bytes(48),'hex'));
create table tlb.settings (id boolean primary key default true check(id), data jsonb not null);
insert into tlb.settings(data) values ('{"shop_name":"The Little Baker Kitchen","paused":true,"pause_message":"Ordering setup is in progress.","pickup_address":"","contact_email":"","contact_phone":"","payment_instructions":"","delivery_window":"9:00 AM – 6:00 PM","production_weekdays":[0,1,2,3,4,5,6],"nonproduction_dates":[],"fulfillment_weekdays":[0,1,2,3,4,5,6],"blocked_dates":[],"cutoff_time":null,"reminder_time":"08:00","reminders_enabled":false,"owner_email":"","site_url":""}');
create table tlb.staff (user_id uuid primary key references auth.users(id), role text not null check(role in ('owner','staff')));
create table tlb.categories (id uuid primary key default gen_random_uuid(), data jsonb not null);
create table tlb.products (id uuid primary key default gen_random_uuid(), data jsonb not null, updated_at timestamptz not null default now());
create table tlb.zones (id uuid primary key default gen_random_uuid(), data jsonb not null);
create table tlb.promos (id uuid primary key default gen_random_uuid(), code text not null unique, data jsonb not null);
create table tlb.inventory (product_id uuid not null references tlb.products(id), date date not null, capacity integer not null check(capacity>=0), available boolean not null default true, primary key(product_id,date));
create table tlb.orders (
 id uuid primary key default gen_random_uuid(), reference text not null unique,
 user_id uuid references auth.users(id), access_digest bytea not null unique, access_encrypted bytea not null,
 created_at timestamptz not null default now(), fulfillment_date date not null, method text not null check(method in ('pickup','delivery')),
 payment_status text not null default 'awaiting_payment' check(payment_status in ('awaiting_payment','under_review','paid','rejected')),
 fulfillment_status text not null default 'pending_confirmation' check(fulfillment_status in ('pending_confirmation','confirmed','preparing','ready_for_pickup','out_for_delivery','completed','cancelled','expired')),
 payment_deadline timestamptz not null default now()+interval '60 minutes', proof_path text, payment_reference text,
 paid_amount_cents integer, refund_label boolean not null default false, revision integer not null default 1,
 data jsonb not null, idempotency_key uuid not null unique, request_hash text not null
);
create index orders_owner on tlb.orders(user_id,created_at desc);
create index orders_due on tlb.orders(fulfillment_date,fulfillment_status);
create table tlb.allocations (order_id uuid not null references tlb.orders(id), product_id uuid not null references tlb.products(id), date date not null, quantity integer not null check(quantity>0), state text not null check(state in ('held','committed','retained')), primary key(order_id,product_id,date));
create index allocations_capacity on tlb.allocations(product_id,date);
create table tlb.promo_usage (order_id uuid primary key references tlb.orders(id), promo_id uuid not null references tlb.promos(id), user_id uuid not null references auth.users(id), state text not null check(state in ('reserved','redeemed')));
create index promo_usage_limits on tlb.promo_usage(promo_id,user_id);
create table tlb.payments (id uuid primary key default gen_random_uuid(), order_id uuid not null unique references tlb.orders(id), amount_cents integer not null check(amount_cents>=0), proof_path text not null, payment_reference text not null, approved_by uuid not null references auth.users(id), approved_at timestamptz not null default now());
create table tlb.history (id bigint generated always as identity primary key, order_id uuid not null references tlb.orders(id), at timestamptz not null default now(), actor text not null, action text not null, reason text, before_data jsonb, after_data jsonb, private boolean not null default false);
create table tlb.action_keys (user_id uuid not null, action text not null, key uuid not null, order_id uuid not null references tlb.orders(id), request_hash text not null, primary key(user_id,action,key));
create table tlb.outbox (
 id uuid primary key default gen_random_uuid(), event_key text not null unique, event_type text not null, order_id uuid not null references tlb.orders(id), target_date date,
 to_email text not null, subject text not null, payload jsonb not null,
 status text not null default 'pending' check(status in ('pending','sending','sent','failed','skipped')),
 attempts integer not null default 0, available_at timestamptz not null default now(), lease_token uuid, leased_until timestamptz,
 created_at timestamptz not null default now(), sent_at timestamptz, provider_id text, last_error text
);
create index outbox_ready on tlb.outbox(status,available_at);

-- Deny direct reads/writes, even if broad default grants are present in a project.
do $$ declare t record; begin
 for t in select tablename from pg_tables where schemaname='tlb' loop
  execute format('alter table tlb.%I enable row level security',t.tablename);
  execute format('revoke all on tlb.%I from public, anon, authenticated',t.tablename);
 end loop;
end $$;

create function tlb.role_for(p_user uuid) returns text language sql stable security definer set search_path='' as $$ select role from tlb.staff where user_id=p_user $$;
create function tlb.is_verified(p_user uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null) $$;
create function tlb.assert_staff(p_user uuid,p_owner boolean default false) returns void language plpgsql security definer set search_path='' as $$
begin
 if coalesce(tlb.role_for(p_user),'') not in ('owner','staff') or (p_owner and coalesce(tlb.role_for(p_user),'')<>'owner') then raise exception 'Authorized % access required',case when p_owner then 'owner' else 'staff' end using errcode='42501'; end if;
end $$;
create function tlb.require(p_ok boolean,p_message text) returns void language plpgsql set search_path='' as $$ begin if p_ok is distinct from true then raise exception '%',p_message using errcode='22023'; end if; end $$;
create function tlb.order_token(p_order tlb.orders) returns text language sql stable security definer set search_path='' as $$ select extensions.pgp_sym_decrypt(p_order.access_encrypted,token_key) from tlb.secrets where id $$;
create function tlb.can_access(p_order tlb.orders,p_user uuid,p_token text) returns boolean language sql stable security definer set search_path='' as $$
 select (p_user is not null and (p_order.user_id=p_user or tlb.role_for(p_user) in ('owner','staff'))) or (length(coalesce(p_token,''))>=40 and extensions.digest(p_token,'sha256')=p_order.access_digest)
$$;
create function tlb.order_json(p_id uuid,p_private boolean default false,p_token boolean default false) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o tlb.orders; h jsonb;
begin
 select * into strict o from tlb.orders where id=p_id;
 select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('at',at,'actor',case when p_private then actor else case when actor='system' then 'System' else 'TLB Kitchen' end end,'action',action,'reason',reason,'before',case when p_private then before_data end,'after',case when p_private then after_data end)) order by id),'[]') into h from tlb.history where order_id=p_id and (p_private or not private);
 return o.data || jsonb_build_object('id',o.id,'reference',o.reference,'created_at',o.created_at,'fulfillment_date',o.fulfillment_date,'method',o.method,'payment_status',o.payment_status,'fulfillment_status',o.fulfillment_status,'payment_deadline',o.payment_deadline,'proof_path',case when p_private then o.proof_path else null end,'proof_submitted',o.proof_path is not null,'payment_reference',o.payment_reference,'paid_amount_cents',o.paid_amount_cents,'refund_label',o.refund_label,'revision',o.revision,'history',h) || case when p_token then jsonb_build_object('access_token',tlb.order_token(o)) else '{}'::jsonb end;
end $$;
create function tlb.audit(p_id uuid,p_actor uuid,p_action text,p_reason text default null,p_before jsonb default null,p_after jsonb default null,p_private boolean default false) returns void language sql security definer set search_path='' as $$
 insert into tlb.history(order_id,actor,action,reason,before_data,after_data,private) values(p_id,coalesce(p_actor::text,'system'),p_action,p_reason,p_before,p_after,p_private)
$$;
create function tlb.queue_email(p_id uuid,p_event text,p_key text,p_date date default null,p_old jsonb default null) returns void language plpgsql security definer set search_path='' as $$
declare o tlb.orders; s jsonb; subject text;
begin
 select * into strict o from tlb.orders where id=p_id;
 select data-'owner_email' into s from tlb.settings where id;
 subject := case p_event when 'order_submitted' then 'Order received — payment instructions' when 'payment_approved' then 'Payment approved — order confirmed' when 'payment_rejected' then 'Payment rejected — order cancelled' when 'order_cancelled' then 'Order cancelled' when 'order_expired' then 'Payment deadline expired' when 'fulfillment_reminder' then 'Your order is scheduled for today' when 'ready_for_pickup' then 'Your order is ready for pickup' when 'out_for_delivery' then 'Your order is out for delivery' else 'Order update' end;
 insert into tlb.outbox(event_key,event_type,order_id,target_date,to_email,subject,payload) values(p_key,p_event,p_id,p_date,o.data#>>'{buyer,email}',subject||' · '||o.reference,jsonb_build_object('event_type',p_event,'order',tlb.order_json(p_id,false,true),'settings',s,'old_order',p_old)) on conflict(event_key) do update set status='pending',payload=excluded.payload,to_email=excluded.to_email,available_at=now(),last_error=null where tlb.outbox.status='skipped' and tlb.outbox.event_type='fulfillment_reminder';
end $$;
create function tlb.expire_orders() returns integer language plpgsql security definer set search_path='' as $$
declare o tlb.orders; n integer:=0;
begin
 for o in select * from tlb.orders where payment_status='awaiting_payment' and fulfillment_status='pending_confirmation' and payment_deadline<=clock_timestamp() for update loop
  update tlb.orders set fulfillment_status='expired',revision=revision+1 where id=o.id;
  delete from tlb.allocations where order_id=o.id and state='held';
  delete from tlb.promo_usage where order_id=o.id and state='reserved';
  perform tlb.audit(o.id,null,'expired','No valid payment proof was submitted within 60 minutes.');
  perform tlb.queue_email(o.id,'order_expired','expired:'||o.id);
  n:=n+1;
 end loop;
 return n;
end $$;

create function tlb.is_production(p_date date,p_settings jsonb) returns boolean language sql immutable set search_path='' as $$
 select (p_settings->'production_weekdays') @> to_jsonb(array[extract(dow from p_date)::integer]) and not ((p_settings->'nonproduction_dates') ? p_date::text)
$$;
create function tlb.earliest_lead_date(p_submitted timestamptz,p_days integer,p_settings jsonb) returns date language plpgsql immutable set search_path='' as $$
declare d date:=(p_submitted at time zone 'Asia/Manila')::date+1; needed integer:=p_days; counted integer:=0; i integer;
begin
 if nullif(p_settings->>'cutoff_time','') is not null and (p_submitted at time zone 'Asia/Manila')::time >= (p_settings->>'cutoff_time')::time then needed:=needed+1; end if;
 if needed=0 then return d; end if;
 for i in 1..3660 loop
  if tlb.is_production(d,p_settings) then counted:=counted+1; end if;
  d:=d+1;
  if counted>=needed then return d; end if;
 end loop;
 raise exception 'No usable production schedule is configured.';
end $$;
create function tlb.date_supported(p_date date,p_method text,p_settings jsonb) returns boolean language sql immutable set search_path='' as $$
 select (p_settings->'fulfillment_weekdays') @> to_jsonb(array[extract(dow from p_date)::integer])
 and not ((p_settings->'blocked_dates') ? p_date::text)
 and not (coalesce(p_settings->(case when p_method='pickup' then 'pickup_blocked_dates' else 'delivery_blocked_dates' end),'[]'::jsonb) ? p_date::text)
$$;
create function tlb.capacity_remaining(p_product uuid,p_date date,p_exclude uuid default null) returns integer language sql stable security definer set search_path='' as $$
 select i.capacity-coalesce((select sum(a.quantity)::integer from tlb.allocations a where a.product_id=i.product_id and a.date=i.date and (p_exclude is null or a.order_id<>p_exclude)),0) from tlb.inventory i where i.product_id=p_product and i.date=p_date
$$;
create function tlb.inventory_json() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('product_id',i.product_id,'date',i.date,'capacity',i.capacity,'available',i.available,'reserved',i.capacity-tlb.capacity_remaining(i.product_id,i.date),'remaining',tlb.capacity_remaining(i.product_id,i.date)) order by i.date,i.product_id),'[]') from tlb.inventory i where date >= (now() at time zone 'Asia/Manila')::date-7
$$;
create function tlb.calculate_quote(p_payload jsonb,p_user uuid,p_original uuid default null,p_admin boolean default false,p_submitted timestamptz default clock_timestamp()) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 s jsonb; o tlb.orders; old_data jsonb; old_item jsonb; item jsonb; p jsonb; g jsonb; c jsonb; sels jsonb; group_sels jsonb; labels jsonb; items jsonb:='[]';
 v_product_id uuid; qty integer; base integer; surcharge bigint; unit bigint; subtotal bigint:=0; delivery integer:=0; discount integer:=0; total bigint;
 selected integer; n integer; choice_key text; group_key text; chosen jsonb; sum_count integer; key_count integer;
 ful date; method text; earliest date; item_earliest date; stock integer; requested integer; existing_qty integer; require_item boolean; same_config boolean;
 promo jsonb; v_promo_id uuid; v_code text; usage_count integer; reserved boolean:=false; changed_date boolean; z record;
begin
 select data into s from tlb.settings where id;
 if p_original is not null then select * into strict o from tlb.orders where id=p_original; old_data:=o.data; end if;
 ful:=(p_payload->>'fulfillment_date')::date; method:=p_payload->>'method';
 perform tlb.require(ful is not null,'Choose a fulfillment date.');
 perform tlb.require(method in ('pickup','delivery'),'Choose pickup or delivery.');
 perform tlb.require(jsonb_typeof(p_payload->'items')='array' and jsonb_array_length(p_payload->'items') between 1 and 100,'Add between 1 and 100 product configurations to your cart.');
 changed_date:=p_original is null or ful<>o.fulfillment_date or method<>o.method;
 if not p_admin then
  perform tlb.require(not coalesce((s->>'paused')::boolean,true),coalesce(nullif(s->>'pause_message',''),'The shop is temporarily paused for new orders.'));
  perform tlb.require(ful>(p_submitted at time zone 'Asia/Manila')::date,'Same-day fulfillment is not available. Choose a future date.');
 end if;
 if not p_admin or changed_date then perform tlb.require(tlb.date_supported(ful,method,s),'This fulfillment date is closed to new '||method||' bookings. Choose another date.'); end if;
 earliest:=(p_submitted at time zone 'Asia/Manila')::date+1;
 for item in select value from jsonb_array_elements(p_payload->'items') loop
  v_product_id:=(item->>'product_id')::uuid; qty:=(item->>'quantity')::integer; sels:=coalesce(item->'selections','{}');
  perform tlb.require(qty between 1 and 10000 and item->>'quantity'=qty::text,'Product quantities must be whole numbers between 1 and 10000.');
  perform tlb.require(jsonb_typeof(sels)='object','Product selections must be an object.');
  select data into p from tlb.products where id=v_product_id;
  perform tlb.require(p is not null,'A selected product no longer exists.');
  old_item:=null;
  if p_original is not null then select value into old_item from jsonb_array_elements(old_data->'items') where value->>'product_id'=v_product_id::text and coalesce(value->'selections','{}')=sels limit 1; end if;
  same_config:=old_item is not null;
  select coalesce(sum((value->>'quantity')::integer),0)::integer into requested from jsonb_array_elements(p_payload->'items') where value->>'product_id'=v_product_id::text;
  select coalesce(sum(quantity),0)::integer into existing_qty from tlb.allocations where order_id=p_original and tlb.allocations.product_id=v_product_id and date=ful;
  require_item:=not p_admin or not same_config or changed_date or requested>existing_qty;
  if require_item then
   perform tlb.require(coalesce((p->>'active')::boolean,false),'Product unavailable: '||(p->>'name'));
   perform tlb.require(requested>=coalesce((p->>'min_quantity')::integer,1),'Minimum quantity for '||(p->>'name')||' is '||coalesce(p->>'min_quantity','1')||'.');
  end if;
  if p_admin and same_config then
   unit:=(old_item->>'unit_price_cents')::integer; labels:=coalesce(old_item->'selection_labels','[]');
  else
   surcharge:=0; labels:='[]';
   for group_key in select jsonb_object_keys(sels) loop
    perform tlb.require(exists(select 1 from jsonb_array_elements(coalesce(p->'option_groups','[]')) where value->>'id'=group_key),'Unknown product option group.');
   end loop;
   for g in select value from jsonb_array_elements(coalesce(p->'option_groups','[]')) loop
    group_sels:=coalesce(sels->(g->>'id'),'{}'); sum_count:=0;
    perform tlb.require(jsonb_typeof(group_sels)='object','Invalid option choices.');
    for choice_key,chosen in select key,value from jsonb_each(group_sels) loop
     perform tlb.require(jsonb_typeof(chosen)='number' and chosen::text ~ '^[0-9]+$','Flavor quantities must be nonnegative whole numbers.');
     n:=chosen::text::integer;
     select value into c from jsonb_array_elements(g->'choices') where value->>'id'=choice_key;
     perform tlb.require(c is not null,'Unknown option choice.');
     if n>0 then
      perform tlb.require(coalesce((c->>'active')::boolean,true),'Option unavailable: '||(c->>'label'));
      sum_count:=sum_count+n; surcharge:=surcharge+(c->>'surcharge_cents')::integer*n;
      labels:=labels||jsonb_build_array(jsonb_build_object('group',g->>'label','label',c->>'label','quantity',n,'surcharge_cents',(c->>'surcharge_cents')::integer));
     end if;
    end loop;
    perform tlb.require(sum_count=(g->>'required_count')::integer,'Choose exactly '||(g->>'required_count')||' for '||(g->>'label')||' in '||(p->>'name')||'.');
   end loop;
   unit:=(p->>'price_cents')::integer+surcharge;
  end if;
  perform tlb.require(unit between 0 and 100000000,'Product price is outside the supported range.');
  if not p_admin then
   item_earliest:=tlb.earliest_lead_date(p_submitted,coalesce((p->>'lead_days')::integer,0),s); earliest:=greatest(earliest,item_earliest);
   perform tlb.require(ful>=item_earliest,(p->>'name')||' needs full production days. Earliest lead-time date: '||item_earliest::text||'.');
  end if;
  if require_item then
   perform tlb.require(exists(select 1 from tlb.inventory i where i.product_id=v_product_id and date=ful and available),'No available quantity is configured for '||(p->>'name')||' on '||ful::text||'.');
   stock:=tlb.capacity_remaining(v_product_id,ful,p_original);
   perform tlb.require(stock>=requested,'Only '||coalesce(stock,0)::text||' units of '||(p->>'name')||' remain on '||ful::text||'.');
  end if;
  subtotal:=subtotal+unit*qty;
  items:=items||jsonb_build_array(jsonb_build_object('product_id',v_product_id,'name',case when p_admin and same_config then old_item->>'name' else p->>'name' end,'quantity',qty,'selections',sels,'selection_labels',labels,'unit_price_cents',unit,'line_total_cents',unit*qty));
 end loop;
 perform tlb.require(subtotal<=1000000000,'Order subtotal exceeds the supported amount.');
 if method='delivery' then
  perform tlb.require(nullif(trim(p_payload#>>'{address,locality}'),'') is not null,'Select a supported delivery locality.');
  if p_admin and p_original is not null and o.method='delivery' and p_payload#>>'{address,locality}'=o.data#>>'{address,locality}' then
   delivery:=(o.data->>'delivery_cents')::integer;
  else
   select data into z from tlb.zones where coalesce((data->>'active')::boolean,false) and (data->'localities') ? (p_payload#>>'{address,locality}') order by id limit 1;
   perform tlb.require(z.data is not null,'This delivery locality is outside our supported zones.');
   delivery:=(z.data->>'fee_cents')::integer;
  end if;
 end if;
 if p_admin and p_payload ? 'delivery_cents' then delivery:=(p_payload->>'delivery_cents')::integer; perform tlb.require(delivery between 0 and 100000000,'Delivery fee must be a nonnegative PHP amount.'); end if;
 if p_original is not null then
  promo:=old_data->'promo_snapshot';
  if promo='null'::jsonb then promo:=null; end if;
 else
  v_code:=upper(trim(coalesce(p_payload->>'promo_code','')));
  if v_code<>'' then
   perform tlb.require(p_user is not null and tlb.is_verified(p_user),'Sign in with a verified email address to redeem a promo code. Your cart is preserved.');
   select data||jsonb_build_object('id',id) into promo from tlb.promos where tlb.promos.code=v_code;
   perform tlb.require(promo is not null,'Promo code not found.');
   perform tlb.require(coalesce((promo->>'active')::boolean,false),'This promo code is inactive.');
   perform tlb.require((promo->>'expires_at')::timestamptz>p_submitted,'This promo code has expired.');
   perform tlb.require(subtotal>=(promo->>'min_subtotal_cents')::integer,'This promo requires a product subtotal of PHP '||to_char((promo->>'min_subtotal_cents')::numeric/100,'FM999999990.00')||', excluding delivery.');
   promo:=promo||jsonb_build_object('eligible_at',p_submitted);
  end if;
 end if;
 if promo is not null then
  v_promo_id:=(promo->>'id')::uuid;
  if subtotal>=(promo->>'min_subtotal_cents')::integer then
   if promo->>'kind'='fixed' then discount:=least(subtotal,(promo->>'value')::integer); else discount:=round(subtotal*(promo->>'value')::numeric/100)::integer; if promo->>'cap_cents' is not null then discount:=least(discount,(promo->>'cap_cents')::integer); end if; discount:=least(discount,subtotal); end if;
   if p_original is null or not exists(select 1 from tlb.promo_usage where order_id=p_original) then
    select count(*) into usage_count from tlb.promo_usage where tlb.promo_usage.promo_id=v_promo_id;
    perform tlb.require(usage_count<(promo->>'global_limit')::integer,'This promo has reached its total use limit.');
    select count(*) into usage_count from tlb.promo_usage where tlb.promo_usage.promo_id=v_promo_id and user_id=p_user;
    perform tlb.require(usage_count<(promo->>'per_account_limit')::integer,'This account has reached this promo code’s use limit.');
   end if;
  end if;
 end if;
 total:=subtotal-discount+delivery;
 return jsonb_build_object('items',items,'subtotal_cents',subtotal,'discount_cents',discount,'delivery_cents',delivery,'total_cents',total,'promo',promo,'promo_snapshot',promo,'earliest_date',earliest);
end $$;

create function tlb.validate_contact(p jsonb) returns void language plpgsql set search_path='' as $$
begin
 perform tlb.require(length(trim(coalesce(p#>>'{buyer,name}',''))) between 1 and 200,'Enter the buyer name.');
 perform tlb.require(length(trim(coalesce(p#>>'{buyer,phone}',''))) between 5 and 40,'Enter a valid buyer contact number.');
 perform tlb.require(length(coalesce(p#>>'{buyer,email}',''))<=254 and coalesce(p#>>'{buyer,email}','') ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$','Enter a valid buyer email address.');
 if nullif(p#>>'{buyer,social_username}','') is not null then perform tlb.require(p#>>'{buyer,social_platform}' in ('Facebook','Instagram','facebook','instagram'),'Choose Facebook or Instagram for the social username.'); end if;
 if p->>'method'='delivery' then
  perform tlb.require(length(trim(coalesce(p#>>'{recipient,name}',''))) between 1 and 200,'Enter the delivery recipient name separately.');
  perform tlb.require(length(trim(coalesce(p#>>'{recipient,phone}',''))) between 5 and 40,'Enter the delivery recipient contact number.');
  perform tlb.require(length(trim(coalesce(p#>>'{address,line1}',''))) between 5 and 1000,'Enter the complete delivery address.');
 end if;
end $$;
create function tlb.allocate_order(p_id uuid) returns void language sql security definer set search_path='' as $$
 insert into tlb.allocations(order_id,product_id,date,quantity,state)
 select o.id,(v->>'product_id')::uuid,o.fulfillment_date,sum((v->>'quantity')::integer)::integer,case when o.payment_status='paid' then 'committed' else 'held' end
 from tlb.orders o cross join lateral jsonb_array_elements(o.data->'items') v where o.id=p_id group by o.id,(v->>'product_id')::uuid,o.fulfillment_date,o.payment_status
$$;
create function tlb.sync_promo(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare o tlb.orders; promo jsonb;
begin
 select * into strict o from tlb.orders where id=p_id; promo:=o.data->'promo_snapshot';
 if o.payment_status='paid' then
  if promo is not null and promo<>'null'::jsonb and (o.data->>'subtotal_cents')::integer>=(promo->>'min_subtotal_cents')::integer then
   insert into tlb.promo_usage(order_id,promo_id,user_id,state) values(p_id,(promo->>'id')::uuid,o.user_id,'redeemed') on conflict(order_id) do nothing;
  end if;
  return;
 end if;
 if promo is null or promo='null'::jsonb or (o.data->>'subtotal_cents')::integer<(promo->>'min_subtotal_cents')::integer then delete from tlb.promo_usage where order_id=p_id and state='reserved';
 else insert into tlb.promo_usage(order_id,promo_id,user_id,state) values(p_id,(promo->>'id')::uuid,o.user_id,'reserved') on conflict(order_id) do nothing; end if;
end $$;
create function public.shop_api(p_action text,p_payload jsonb default '{}'::jsonb,p_token text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 u uuid:=auth.uid(); role_name text; s jsonb; result jsonb; row_data jsonb; q jsonb; x jsonb; g jsonb; c jsonb; before_order jsonb; merged jsonb; changes jsonb;
 o tlb.orders; oid uuid; rid uuid; token text; v_key uuid; hashed text; existing_action tlb.action_keys; next_status text; reason text; v_email text; target_user uuid;
 submitted_at timestamptz; field text; product uuid; day date; cap integer; taken integer; same_ops boolean; n integer; v_role text;
begin
 -- One transaction-wide lock keeps low-volume bakery capacity, promo and edit operations serializable.
 perform pg_advisory_xact_lock(841721950318::bigint);
 perform tlb.expire_orders();
 submitted_at:=clock_timestamp();
 perform tlb.require(jsonb_typeof(p_payload)='object','Invalid request payload.');
 select data into s from tlb.settings where id;
 role_name:=tlb.role_for(u);
 if p_action='catalog' then
  select coalesce(jsonb_agg(data||jsonb_build_object('id',id) order by coalesce((data->>'sort_order')::integer,0),data->>'name'),'[]') into result from tlb.products where coalesce((data->>'active')::boolean,false);
  return jsonb_build_object('products',result,'categories',(select coalesce(jsonb_agg(data||jsonb_build_object('id',id) order by coalesce((data->>'sort_order')::integer,0)),'[]') from tlb.categories),'settings',s-'owner_email','zones',(select coalesce(jsonb_agg(data||jsonb_build_object('id',id)),'[]') from tlb.zones where coalesce((data->>'active')::boolean,false)),'inventory',tlb.inventory_json());
 elsif p_action='quote' then
  return tlb.calculate_quote(p_payload,u);
 elsif p_action='create_order' then
  v_key:=(p_payload->>'idempotency_key')::uuid; perform tlb.require(v_key is not null,'A unique submission key is required. Refresh checkout and retry.');
  hashed:=encode(extensions.digest((p_payload-'idempotency_key')::text||coalesce(u::text,'guest'),'sha256'),'hex');
  select * into o from tlb.orders where idempotency_key=v_key;
  if found then
   perform tlb.require(o.request_hash=hashed,'This submission key was already used for a different checkout.');
   return tlb.order_json(o.id,false,true);
  end if;
  perform tlb.validate_contact(p_payload);
  q:=tlb.calculate_quote(p_payload,u,null,false,submitted_at);
  if p_payload ? 'expected_quote' then
   perform tlb.require(p_payload->'expected_quote'=jsonb_build_object('items',q->'items','subtotal_cents',q->'subtotal_cents','discount_cents',q->'discount_cents','delivery_cents',q->'delivery_cents','total_cents',q->'total_cents'),'Prices or availability changed since review. Review your order again.');
  end if;
  oid:=gen_random_uuid(); token:=encode(extensions.gen_random_bytes(32),'hex');
  row_data:=jsonb_build_object('buyer',p_payload->'buyer','recipient',p_payload->'recipient','address',p_payload->'address','instructions',left(coalesce(p_payload->>'instructions',''),2000),'items',q->'items','subtotal_cents',q->'subtotal_cents','discount_cents',q->'discount_cents','delivery_cents',q->'delivery_cents','total_cents',q->'total_cents','promo_snapshot',q->'promo_snapshot','payment_instructions',s->>'payment_instructions','pickup_address',s->>'pickup_address','pickup_hours',s->>'pickup_hours','pickup_instructions',s->>'pickup_instructions','delivery_window',s->>'delivery_window','contact_email',s->>'contact_email','contact_phone',s->>'contact_phone');
  insert into tlb.orders(id,reference,user_id,access_digest,access_encrypted,created_at,payment_deadline,fulfillment_date,method,data,idempotency_key,request_hash)
  values(oid,'TLB-'||to_char(now() at time zone 'Asia/Manila','YYMMDD')||'-'||upper(substr(replace(oid::text,'-',''),1,10)),u,extensions.digest(token,'sha256'),extensions.pgp_sym_encrypt(token,(select token_key from tlb.secrets where id)),submitted_at,submitted_at+interval '60 minutes',(p_payload->>'fulfillment_date')::date,p_payload->>'method',row_data,v_key,hashed);
  perform tlb.allocate_order(oid); perform tlb.sync_promo(oid);
  perform tlb.audit(oid,u,'order_submitted'); perform tlb.queue_email(oid,'order_submitted','submitted:'||oid);
  return tlb.order_json(oid,false,true);
 elsif p_action='get_order' then
  select * into o from tlb.orders where id=(p_payload->>'order_id')::uuid;
  if not found or not coalesce(tlb.can_access(o,u,p_token),false) then raise exception 'Order access not authorized.' using errcode='42501'; end if;
  return tlb.order_json(o.id,role_name in ('owner','staff'),false);
 elsif p_action='my_orders' then
  if u is null then raise exception 'Sign in to view your order history.' using errcode='42501'; end if;
  select coalesce(jsonb_agg(tlb.order_json(id,false,false) order by created_at desc),'[]') into result from tlb.orders where user_id=u; return result;
 end if;
 perform tlb.assert_staff(u,false);
 if p_action='admin_bootstrap' then
  return jsonb_build_object('role',role_name,'products',(select coalesce(jsonb_agg(data||jsonb_build_object('id',id)),'[]') from tlb.products),'categories',(select coalesce(jsonb_agg(data||jsonb_build_object('id',id)),'[]') from tlb.categories),'settings',case when role_name='owner' then s else s-'owner_email' end,'zones',(select coalesce(jsonb_agg(data||jsonb_build_object('id',id)),'[]') from tlb.zones),'inventory',tlb.inventory_json(),'promos',case when role_name='owner' then (select coalesce(jsonb_agg(data||jsonb_build_object('id',id)),'[]') from tlb.promos) else '[]'::jsonb end,'orders',(select coalesce(jsonb_agg(tlb.order_json(id,true,false) order by created_at desc),'[]') from tlb.orders),'email_status',(select coalesce(jsonb_agg(to_jsonb(e)),'[]') from (select id,event_type,order_id,status,attempts,last_error,created_at,sent_at from tlb.outbox order by created_at desc limit 100) e));
 elsif p_action='save_inventory' then
  perform tlb.require(jsonb_typeof(p_payload->'rows')='array','Provide inventory rows.');
  for x in select value from jsonb_array_elements(p_payload->'rows') loop
   product:=(x->>'product_id')::uuid; day:=(x->>'date')::date; cap:=(x->>'capacity')::integer;
   perform tlb.require(cap between 0 and 1000000 and day is not null,'Enter a valid date and nonnegative whole-unit capacity.');
   select coalesce(sum(quantity),0)::integer into taken from tlb.allocations where product_id=product and date=day;
   perform tlb.require(cap>=taken,'Capacity cannot be below the '||taken||' units already reserved or committed on '||day||'.');
   insert into tlb.inventory(product_id,date,capacity,available) values(product,day,cap,coalesce((x->>'available')::boolean,true)) on conflict(product_id,date) do update set capacity=excluded.capacity,available=excluded.available;
  end loop;
  return tlb.inventory_json();
 end if;
 if p_action in ('save_product','save_category','delete_category','save_settings','save_zone','save_promo','list_staff','save_staff') then
  perform tlb.assert_staff(u,true);
  if p_action='save_product' then
   row_data:=p_payload->'product'; rid:=coalesce((row_data->>'id')::uuid,gen_random_uuid());
   perform tlb.require(length(trim(row_data->>'name')) between 1 and 200,'Product name is required.');
   perform tlb.require((row_data->>'price_cents')::integer between 0 and 100000000,'Set a valid nonnegative product price.');
   perform tlb.require(coalesce((row_data->>'min_quantity')::integer,1) between 1 and 10000,'Minimum quantity must be a positive whole number.');
   perform tlb.require(coalesce((row_data->>'lead_days')::integer,0) between 0 and 365,'Lead time must be 0–365 full production days.');
   if row_data->>'category_id' is not null then perform tlb.require(exists(select 1 from tlb.categories where id=(row_data->>'category_id')::uuid),'Category not found.'); end if;
   perform tlb.require(jsonb_typeof(coalesce(row_data->'photos','[]'))='array' and jsonb_array_length(coalesce(row_data->'photos','[]'))<=20,'Use at most 20 product photos.');
   perform tlb.require(jsonb_typeof(coalesce(row_data->'option_groups','[]'))='array','Invalid option groups.');
   for g in select value from jsonb_array_elements(coalesce(row_data->'option_groups','[]')) loop
    perform tlb.require(nullif(g->>'id','') is not null and nullif(g->>'label','') is not null and (g->>'required_count')::integer between 1 and 1000,'Option groups need IDs, labels and a positive selection count.');
    select count(*) into n from jsonb_array_elements(row_data->'option_groups') where value->>'id'=g->>'id'; perform tlb.require(n=1,'Option group IDs must be unique.');
    perform tlb.require(jsonb_typeof(g->'choices')='array' and jsonb_array_length(g->'choices')>0,'Add choices to every option group.');
    for c in select value from jsonb_array_elements(g->'choices') loop
     perform tlb.require(nullif(c->>'id','') is not null and nullif(c->>'label','') is not null and (c->>'surcharge_cents')::integer between 0 and 100000000,'Choices need IDs, labels and nonnegative surcharges.');
     select count(*) into n from jsonb_array_elements(g->'choices') where value->>'id'=c->>'id'; perform tlb.require(n=1,'Choice IDs must be unique within a group.');
    end loop;
   end loop;
   row_data:=jsonb_build_object('description','','category_id',null,'min_quantity',1,'lead_days',0,'active',false,'photos','[]'::jsonb,'option_groups','[]'::jsonb,'sort_order',0)||row_data||jsonb_build_object('id',rid);
   insert into tlb.products(id,data) values(rid,row_data) on conflict(id) do update set data=excluded.data,updated_at=now(); return row_data;
  elsif p_action='save_category' then
   row_data:=p_payload->'category'; perform tlb.require(length(trim(row_data->>'name')) between 1 and 100,'Category name is required.'); rid:=coalesce((row_data->>'id')::uuid,gen_random_uuid()); row_data:=row_data||jsonb_build_object('id',rid);
   insert into tlb.categories(id,data) values(rid,row_data) on conflict(id) do update set data=excluded.data; return row_data;
  elsif p_action='delete_category' then
   rid:=(p_payload->>'id')::uuid; update tlb.products set data=jsonb_set(data,'{category_id}','null') where data->>'category_id'=rid::text; delete from tlb.categories where id=rid; return jsonb_build_object('deleted',true);
  elsif p_action='save_settings' then
   row_data:=s||coalesce(p_payload->'settings','{}');
   foreach field in array array['production_weekdays','fulfillment_weekdays'] loop
    perform tlb.require(jsonb_typeof(row_data->field)='array' and jsonb_array_length(row_data->field)>0,'Configure at least one '||field||' entry.');
    for x in select value from jsonb_array_elements(row_data->field) loop perform tlb.require(x::text ~ '^[0-6]$','Weekdays must be integers from 0 (Sunday) to 6 (Saturday).'); end loop;
   end loop;
   foreach field in array array['nonproduction_dates','blocked_dates','pickup_blocked_dates','delivery_blocked_dates'] loop
    if row_data ? field then
     perform tlb.require(jsonb_typeof(row_data->field)='array','Date settings must be arrays.');
     for x in select value from jsonb_array_elements(row_data->field) loop day:=(x#>>'{}')::date; end loop;
    end if;
   end loop;
   if nullif(row_data->>'cutoff_time','') is not null then perform (row_data->>'cutoff_time')::time; end if;
   perform (row_data->>'reminder_time')::time;
   if nullif(row_data->>'site_url','') is not null then perform tlb.require(row_data->>'site_url' ~ '^https?://[^[:space:]]+$','Site URL must begin with https:// (http:// is allowed for local testing).'); end if;
   if not coalesce((row_data->>'paused')::boolean,true) then
    perform tlb.require(nullif(trim(row_data->>'payment_instructions'),'') is not null,'Configure payment instructions before opening orders.');
    perform tlb.require(nullif(trim(row_data->>'pickup_address'),'') is not null,'Configure the pickup address before opening orders.');
    perform tlb.require(nullif(trim(row_data->>'contact_email'),'') is not null or nullif(trim(row_data->>'contact_phone'),'') is not null,'Configure a business contact email or phone before opening orders.');
    perform tlb.require(nullif(trim(row_data->>'site_url'),'') is not null,'Configure the complete test site URL before opening orders so secure email links work.');
   end if;
   update tlb.settings set data=row_data where id; return row_data;
  elsif p_action='save_zone' then
   row_data:=p_payload->'zone'; rid:=coalesce((row_data->>'id')::uuid,gen_random_uuid());
   perform tlb.require(nullif(trim(row_data->>'name'),'') is not null and (row_data->>'fee_cents')::integer between 0 and 100000000,'Delivery zone needs a name and nonnegative fee.');
   perform tlb.require(jsonb_typeof(row_data->'localities')='array' and jsonb_array_length(row_data->'localities')>0,'Add covered localities.');
   if coalesce((row_data->>'active')::boolean,true) then
    perform tlb.require(not exists(select 1 from tlb.zones z cross join lateral jsonb_array_elements_text(z.data->'localities') a where z.id<>rid and coalesce((z.data->>'active')::boolean,false) and (row_data->'localities') ? a),'A locality already belongs to another active delivery zone.');
   end if;
   row_data:=jsonb_build_object('active',true)||row_data||jsonb_build_object('id',rid); insert into tlb.zones(id,data) values(rid,row_data) on conflict(id) do update set data=excluded.data; return row_data;
  elsif p_action='save_promo' then
   row_data:=p_payload->'promo'; rid:=coalesce((row_data->>'id')::uuid,gen_random_uuid()); row_data:=jsonb_build_object('active',true,'min_subtotal_cents',0,'cap_cents',null)||row_data||jsonb_build_object('id',rid,'code',upper(trim(row_data->>'code')));
   perform tlb.require(row_data->>'code' ~ '^[A-Z0-9_-]{1,50}$','Promo code must contain 1–50 letters, digits, underscores or hyphens.');
   perform tlb.require(row_data->>'kind' in ('percent','fixed'),'Choose a percentage or fixed promo.');
   perform tlb.require((row_data->>'value')::integer>0 and ((row_data->>'kind')<>'percent' or (row_data->>'value')::integer<=100),'Enter a positive discount (percentage at most 100).');
   perform tlb.require((row_data->>'min_subtotal_cents')::integer>=0 and (row_data->>'cap_cents' is null or (row_data->>'cap_cents')::integer>=0),'Promo minimum and cap cannot be negative.');
   perform tlb.require((row_data->>'per_account_limit')::integer>0 and (row_data->>'global_limit')::integer>0,'Promo use limits must be positive whole numbers.');
   perform tlb.require(row_data->>'expires_at' is not null,'Promo expiry is required.'); perform (row_data->>'expires_at')::timestamptz;
   insert into tlb.promos(id,code,data) values(rid,row_data->>'code',row_data) on conflict(id) do update set code=excluded.code,data=excluded.data; return row_data;
  elsif p_action='list_staff' then
   select coalesce(jsonb_agg(jsonb_build_object('user_id',t.user_id,'email',a.email,'role',t.role)),'[]') into result from tlb.staff t join auth.users a on a.id=t.user_id; return result;
  elsif p_action='save_staff' then
   v_email:=lower(trim(p_payload->>'email')); v_role:=p_payload->>'role';
   perform tlb.require(v_role in ('owner','staff','none'),'Choose owner, staff, or none.');
   select id into target_user from auth.users where lower(email)=v_email and email_confirmed_at is not null;
   perform tlb.require(target_user is not null,'The staff member must first register and verify their email.');
   if tlb.role_for(target_user)='owner' and v_role<>'owner' then perform tlb.require((select count(*) from tlb.staff where role='owner')>1,'The final owner cannot be removed or demoted.'); end if;
   if v_role='none' then delete from tlb.staff where user_id=target_user; else insert into tlb.staff(user_id,role) values(target_user,v_role) on conflict(user_id) do update set role=excluded.role; end if;
   return jsonb_build_object('user_id',target_user,'email',v_email,'role',v_role);
  end if;
 end if;
 -- Remaining actions operate on one existing order and use a revision plus retry key.
 perform tlb.require(p_action in ('approve_payment','reject_payment','set_fulfillment','cancel_order','set_refund_label','edit_order','preview_edit_order','add_staff_note'),'Unknown ordering action.');
 oid:=(p_payload->>'order_id')::uuid; select * into o from tlb.orders where id=oid for update; perform tlb.require(found,'Order not found.');
 if p_action<>'preview_edit_order' then
  v_key:=(p_payload->>'idempotency_key')::uuid; perform tlb.require(v_key is not null,'A unique action key is required.');
  hashed:=encode(extensions.digest((p_payload-'revision')::text,'sha256'),'hex');
  select * into existing_action from tlb.action_keys where user_id=u and action=p_action and tlb.action_keys.key=v_key;
  if found then perform tlb.require(existing_action.order_id=oid and existing_action.request_hash=hashed,'This action key was already used for a different request.'); return tlb.order_json(oid,true,false); end if;
 end if;
 perform tlb.require((p_payload->>'revision')::integer=o.revision,'This order changed. Refresh it and review the latest version before saving.');
 before_order:=tlb.order_json(oid,true,false)-'history'; reason:=nullif(trim(p_payload->>'reason'),'');
 if p_action='approve_payment' then
  perform tlb.require(o.payment_status='under_review' and o.fulfillment_status='pending_confirmation','Only an active payment under review can be approved.');
  insert into tlb.payments(order_id,amount_cents,proof_path,payment_reference,approved_by) values(oid,(o.data->>'total_cents')::integer,o.proof_path,o.payment_reference,u);
  update tlb.orders set payment_status='paid',fulfillment_status='confirmed',paid_amount_cents=(data->>'total_cents')::integer,revision=revision+1 where id=oid;
  update tlb.allocations set state='committed' where order_id=oid and state='held';
  update tlb.promo_usage set state='redeemed' where order_id=oid and state='reserved';
 elsif p_action='reject_payment' then
  perform tlb.require(reason is not null,'A payment rejection reason is required.');
  perform tlb.require(o.payment_status='under_review' and o.fulfillment_status='pending_confirmation','Only an active payment under review can be rejected.');
  update tlb.orders set payment_status='rejected',fulfillment_status='cancelled',revision=revision+1 where id=oid;
  delete from tlb.allocations where order_id=oid and state='held'; delete from tlb.promo_usage where order_id=oid and state='reserved';
 elsif p_action='set_fulfillment' then
  next_status:=p_payload->>'status';
  perform tlb.require(o.payment_status='paid' and o.fulfillment_status not in ('cancelled','expired','completed'),'Only a paid active order can progress through fulfillment.');
  perform tlb.require(next_status in ('confirmed','preparing','ready_for_pickup','out_for_delivery','completed'),'Choose a supported fulfillment progress status.');
  perform tlb.require(next_status<>'ready_for_pickup' or o.method='pickup','Ready for pickup applies to pickup orders only.');
  perform tlb.require(next_status<>'out_for_delivery' or o.method='delivery','Out for delivery applies to delivery orders only.');
  update tlb.orders set fulfillment_status=next_status,revision=revision+1 where id=oid;
 elsif p_action='cancel_order' then
  perform tlb.require(reason is not null,'A cancellation reason is required.');
  perform tlb.require(o.fulfillment_status not in ('cancelled','expired','completed'),'This order is already closed or completed.');
  if o.payment_status='paid' then perform tlb.require(p_payload ? 'restore_stock','Explicitly decide whether produced/committed units can be restored.'); end if;
  update tlb.orders set fulfillment_status='cancelled',revision=revision+1 where id=oid;
  if o.payment_status<>'paid' or (p_payload->>'restore_stock')::boolean then delete from tlb.allocations where order_id=oid; else update tlb.allocations set state='retained' where order_id=oid; end if;
  delete from tlb.promo_usage where order_id=oid and state='reserved';
 elsif p_action='set_refund_label' then
  perform tlb.require(p_payload ? 'enabled','Choose whether the Refund label is enabled.');
  update tlb.orders set refund_label=(p_payload->>'enabled')::boolean,revision=revision+1 where id=oid;
 elsif p_action='add_staff_note' then
  perform tlb.require(length(trim(coalesce(p_payload->>'note',''))) between 1 and 5000,'Enter a private staff note (maximum 5000 characters).');
  update tlb.orders set revision=revision+1 where id=oid;
  perform tlb.audit(oid,u,'staff_note',p_payload->>'note',null,null,true);
 elsif p_action in ('edit_order','preview_edit_order') then
  if p_action='edit_order' then perform tlb.require(reason is not null,'An amendment reason is required.'); end if;
  changes:=coalesce(p_payload->'changes','{}'); perform tlb.require(jsonb_typeof(changes)='object','Invalid order changes.');
  for field in select jsonb_object_keys(changes) loop perform tlb.require(field in ('items','fulfillment_date','method','buyer','recipient','address','instructions','delivery_cents'),'Unsupported order edit field: '||field); end loop;
  merged:=o.data||jsonb_build_object('fulfillment_date',o.fulfillment_date,'method',o.method)||changes;
  foreach field in array array['buyer','recipient','address'] loop
   if jsonb_typeof(changes->field)='object' then merged:=jsonb_set(merged,array[field],(case when jsonb_typeof(o.data->field)='object' then o.data->field else '{}'::jsonb end)||(changes->field)); end if;
  end loop;
  perform tlb.validate_contact(merged);
  same_ops:=not (changes ?| array['items','fulfillment_date','method','address','delivery_cents']);
  perform tlb.require(same_ops or o.fulfillment_status not in ('cancelled','expired','completed'),'Closed or completed orders allow contact corrections and notes; their products, date, method and amounts cannot be amended.');
  if not same_ops then
   if (changes ? 'method' or changes ? 'address') and not (changes ? 'delivery_cents') then merged:=merged-'delivery_cents'; end if;
   q:=tlb.calculate_quote(merged,o.user_id,oid,true);
   merged:=merged||jsonb_build_object('items',q->'items','subtotal_cents',q->'subtotal_cents','discount_cents',q->'discount_cents','delivery_cents',q->'delivery_cents','total_cents',q->'total_cents','promo_snapshot',q->'promo_snapshot');
  end if;
  if p_action='preview_edit_order' then return before_order||merged||jsonb_build_object('preview',true); end if;
  if p_payload ? 'expected_quote' then
   perform tlb.require(p_payload->'expected_quote'=jsonb_build_object('items',merged->'items','subtotal_cents',merged->'subtotal_cents','discount_cents',merged->'discount_cents','delivery_cents',merged->'delivery_cents','total_cents',merged->'total_cents'),'Prices changed since the amendment preview. Preview the changes again before saving.');
  end if;
  update tlb.orders set data=merged-'fulfillment_date'-'method',fulfillment_date=(merged->>'fulfillment_date')::date,method=merged->>'method',revision=revision+1 where id=oid;
  if not same_ops then delete from tlb.allocations where order_id=oid; perform tlb.allocate_order(oid); perform tlb.sync_promo(oid); end if;
 end if;
 if p_action<>'add_staff_note' then perform tlb.audit(oid,u,p_action,reason,before_order,tlb.order_json(oid,true,false)-'history'); end if;
 insert into tlb.action_keys(user_id,action,key,order_id,request_hash) values(u,p_action,v_key,oid,hashed);
 if p_action='approve_payment' then perform tlb.queue_email(oid,'payment_approved','approved:'||oid);
 elsif p_action='reject_payment' then perform tlb.queue_email(oid,'payment_rejected','rejected:'||oid);
 elsif p_action='cancel_order' then perform tlb.queue_email(oid,'order_cancelled','cancelled:'||oid);
 elsif p_action='set_fulfillment' and next_status in ('ready_for_pickup','out_for_delivery') and next_status<>o.fulfillment_status then perform tlb.queue_email(oid,next_status,next_status||':'||oid||':'||(o.revision+1));
 end if;
 return tlb.order_json(oid,true,false);
end $$;

alter table tlb.outbox add column first_attempt_at timestamptz;
update tlb.settings set data=data||'{"pickup_hours":"","pickup_instructions":"","pickup_blocked_dates":[],"delivery_blocked_dates":[]}'::jsonb where id;

create function public.shop_service(p_action text,p_payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 o tlb.orders; u uuid:=(p_payload->>'user_id')::uuid; oid uuid:=(p_payload->>'order_id')::uuid; token text:=p_payload->>'token';
 e tlb.outbox; row_data jsonb; result jsonb:='[]'; s jsonb; local_now timestamp:=now() at time zone 'Asia/Manila';
 n integer:=0; expired_count integer:=0; v_limit integer; lease uuid; good boolean; v_path text;
begin
 perform pg_advisory_xact_lock(841721950318::bigint);
 expired_count:=tlb.expire_orders();
 select data into s from tlb.settings where id;
 if p_action in ('authorize_upload','commit_proof','authorize_proof_read') then
  if p_action='authorize_upload' and p_payload->>'kind'='product' then perform tlb.assert_staff(u,true); return jsonb_build_object('allowed',true); end if;
  select * into o from tlb.orders where id=oid for update;
  if p_action='authorize_proof_read' then
   perform tlb.assert_staff(u,false); perform tlb.require(o.id is not null and o.proof_path is not null,'No payment proof is available for this order.'); return jsonb_build_object('path',o.proof_path);
  end if;
  if o.id is null or not coalesce(tlb.can_access(o,u,token),false) then raise exception 'Order access not authorized.' using errcode='42501'; end if;
  perform tlb.require(o.payment_status='awaiting_payment' and o.fulfillment_status='pending_confirmation' and clock_timestamp()<o.payment_deadline,'Payment proof is no longer accepted for this order. Place a new order or contact us directly if payment was already sent.');
  if p_action='authorize_upload' then perform tlb.require(p_payload->>'kind'='proof','Choose proof or product upload.'); return jsonb_build_object('allowed',true,'order_id',oid); end if;
  v_path:=p_payload->>'path';
  perform tlb.require(v_path ~ ('^'||oid::text||'/[a-f0-9-]{36}\.(png|jpg|jpeg|webp)$'),'Invalid private proof storage path.');
  perform tlb.require(length(trim(coalesce(p_payload->>'payment_reference',''))) between 1 and 200,'Enter a payment reference (maximum 200 characters).');
  update tlb.orders set proof_path=v_path,payment_reference=trim(p_payload->>'payment_reference'),payment_status='under_review',revision=revision+1 where id=oid;
  perform tlb.audit(oid,u,'proof_submitted','Initial payment proof received before its deadline.');
  return tlb.order_json(oid,false,false);
 elsif p_action='maintenance' then
  if coalesce((s->>'reminders_enabled')::boolean,false) and local_now::time>=(s->>'reminder_time')::time then
   for o in select * from tlb.orders where fulfillment_date=local_now::date and payment_status='paid' and fulfillment_status not in ('cancelled','expired','completed') loop
    perform tlb.queue_email(o.id,'fulfillment_reminder','reminder:'||o.id||':'||o.fulfillment_date,o.fulfillment_date); n:=n+1;
   end loop;
  end if;
  return jsonb_build_object('expired',expired_count,'reminders_considered',n);
 elsif p_action='claim_emails' then
  v_limit:=least(greatest(coalesce((p_payload->>'limit')::integer,3),1),10);
  -- Never retry a delivery with an unknown outcome beyond the provider's 24-hour idempotency window.
  update tlb.outbox set status='failed',last_error='Delivery outcome requires staff review: idempotency window elapsed.',lease_token=null,leased_until=null where status in ('pending','sending') and first_attempt_at<now()-interval '23 hours' and (leased_until is null or leased_until<now());
  for e in select * from tlb.outbox where ((status='pending' and available_at<=now()) or (status='sending' and leased_until<=now())) and attempts<8 order by created_at for update skip locked limit v_limit loop
   if e.event_type='fulfillment_reminder' then
    select * into o from tlb.orders where id=e.order_id;
    good:=coalesce((s->>'reminders_enabled')::boolean,false) and o.payment_status='paid' and o.fulfillment_status not in ('cancelled','expired','completed') and o.fulfillment_date=e.target_date and e.target_date=local_now::date;
    if not good then update tlb.outbox set status='skipped',last_error='Reminder no longer matches an active paid order date.' where id=e.id; continue; end if;
   end if;
   lease:=gen_random_uuid();
   update tlb.outbox set status='sending',attempts=attempts+1,lease_token=lease,leased_until=now()+interval '3 minutes',first_attempt_at=coalesce(first_attempt_at,now()) where id=e.id returning * into e;
   result:=result||jsonb_build_array(jsonb_build_object('id',e.id,'event_key',e.event_key,'to_email',e.to_email,'subject',e.subject,'payload',e.payload,'attempts',e.attempts,'lease_token',e.lease_token,'first_attempt_at',e.first_attempt_at));
  end loop;
  return result;
 elsif p_action in ('prepare_email','email_sent','email_failed') then
  select * into e from tlb.outbox where id=(p_payload->>'id')::uuid and lease_token=(p_payload->>'lease_token')::uuid and status='sending' for update;
  perform tlb.require(found and e.leased_until>now(),'Email claim is stale; another worker owns this message.');
  if p_action='prepare_email' then
   if e.event_type='fulfillment_reminder' then
    select * into o from tlb.orders where id=e.order_id;
    good:=coalesce((s->>'reminders_enabled')::boolean,false) and o.payment_status='paid' and o.fulfillment_status not in ('cancelled','expired','completed') and o.fulfillment_date=e.target_date and e.target_date=local_now::date;
    if not good then update tlb.outbox set status='skipped',last_error='Reminder invalidated by order change.',lease_token=null,leased_until=null where id=e.id; return jsonb_build_object('skip',true); end if;
    update tlb.outbox set payload=jsonb_build_object('event_type',e.event_type,'order',tlb.order_json(e.order_id,false,true),'settings',s-'owner_email'),to_email=o.data#>>'{buyer,email}' where id=e.id returning * into e;
   end if;
   return jsonb_build_object('id',e.id,'event_key',e.event_key,'to_email',e.to_email,'subject',e.subject,'payload',e.payload,'attempts',e.attempts,'lease_token',e.lease_token,'first_attempt_at',e.first_attempt_at);
  elsif p_action='email_sent' then
   update tlb.outbox set status='sent',sent_at=now(),provider_id=p_payload->>'provider_id',lease_token=null,leased_until=null,last_error=null where id=e.id;
   return jsonb_build_object('sent',true);
  else
   update tlb.outbox set status=case when coalesce((p_payload->>'terminal')::boolean,false) or attempts>=8 then 'failed' else 'pending' end,available_at=now()+make_interval(secs=>least(3600,(power(2,attempts)*30)::integer)),last_error=left(coalesce(p_payload->>'error','Email delivery failed.'),2000),lease_token=null,leased_until=null where id=e.id;
   return jsonb_build_object('recorded',true);
  end if;
 end if;
 raise exception 'Unknown service action.' using errcode='22023';
end $$;

-- All implementation helpers and tables are private; only the two dispatch RPCs are exposed.
revoke all on all functions in schema tlb from public, anon, authenticated;
revoke all on function public.shop_api(text,jsonb,text) from public;
grant execute on function public.shop_api(text,jsonb,text) to anon, authenticated;
revoke all on function public.shop_service(text,jsonb) from public, anon, authenticated;
grant execute on function public.shop_service(text,jsonb) to service_role;
alter default privileges in schema tlb revoke all on tables from public, anon, authenticated;
alter default privileges in schema tlb revoke execute on functions from public, anon, authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('payment-proofs','payment-proofs',false,5242880,array['image/png','image/jpeg','image/webp']),
 ('product-images','product-images',true,5242880,array['image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
-- No browser INSERT/UPDATE/SELECT proof policies: Edge Functions use the service role only after SQL authorization.
