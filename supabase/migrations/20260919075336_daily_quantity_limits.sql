-- Blank/missing daily limits mean unlimited. Keep all saved numeric limits,
-- availability flags, orders and allocations. Existing checkout locking and
-- staff authorization in shop_api continue to cover the entire batch.
begin;

alter table tlb.inventory alter column capacity drop not null;

create or replace function tlb.inventory_json() returns jsonb
language sql stable security definer set search_path='' as $$
 with reserved as (
  select product_id,date,sum(quantity)::integer as quantity
  from tlb.allocations
  where date >= (now() at time zone 'Asia/Manila')::date-7
  group by product_id,date
 ), quantities as (
  select coalesce(i.product_id,a.product_id) as product_id,
   coalesce(i.date,a.date) as date,i.capacity,coalesce(i.available,true) as available,
   coalesce(a.quantity,0) as reserved
  from tlb.inventory i full join reserved a using(product_id,date)
  where coalesce(i.date,a.date) >= (now() at time zone 'Asia/Manila')::date-7
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'product_id',product_id,'date',date,'capacity',capacity,'available',available,
  'reserved',reserved,'remaining',capacity-reserved,'unlimited',capacity is null
 ) order by date,product_id),'[]'::jsonb) from quantities
$$;

-- Private helper; only the existing authorized API branch calls it.
create or replace function tlb.save_daily_quantities(p_payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare x jsonb; product uuid; day date; cap integer; taken integer;
begin
 perform tlb.require(jsonb_typeof(p_payload->'rows')='array','Provide inventory rows.');
 perform tlb.require(jsonb_array_length(p_payload->'rows') between 1 and 20000,'Save between 1 and 20,000 product/date quantities at a time.');
 for x in select value from jsonb_array_elements(p_payload->'rows') loop
  perform tlb.require(jsonb_typeof(x)='object' and x ? 'capacity','Provide a quantity or null for no limit.');
  perform tlb.require(x->'capacity'='null'::jsonb or (jsonb_typeof(x->'capacity')='number' and x->>'capacity' ~ '^[0-9]+$'),'Enter a nonnegative whole quantity or null for no limit.');
  product:=(x->>'product_id')::uuid; day:=(x->>'date')::date; cap:=(x->>'capacity')::integer;
  perform tlb.require(product is not null and day is not null and (cap is null or cap between 0 and 1000000),'Enter a valid product, date and whole quantity up to 1,000,000.');
  perform tlb.require(not (x ? 'available') or jsonb_typeof(x->'available')='boolean','Availability must be true or false.');
  select coalesce(sum(quantity),0)::integer into taken from tlb.allocations where product_id=product and date=day;
  perform tlb.require(cap is null or cap>=taken,'Quantity cannot be below the '||taken||' units already ordered on '||day||'.');
  insert into tlb.inventory(product_id,date,capacity,available)
   values(product,day,cap,coalesce((x->>'available')::boolean,true))
   on conflict(product_id,date) do update set capacity=excluded.capacity,available=excluded.available;
 end loop;
 return tlb.inventory_json();
end $$;
revoke all on function tlb.save_daily_quantities(jsonb) from public,anon,authenticated;

-- Guarded patches retain subsequent order, promo, payment and email changes.
do $migration$
declare signature text; definition text; patch record; keep_crlf boolean;
begin
 foreach signature in array array[
  'tlb.calculate_quote(jsonb,uuid,uuid,boolean,timestamp with time zone)',
  'public.shop_api(text,jsonb,text)'
 ] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  keep_crlf:=position(chr(13)||chr(10) in definition)>0;
  definition:=replace(definition,chr(13)||chr(10),chr(10));
  if position('TLB_DAILY_LIMITS_V1' in definition)=0 then
   for patch in select * from (values
    ('tlb.calculate_quote(jsonb,uuid,uuid,boolean,timestamp with time zone)',
     $old$   perform tlb.require(exists(select 1 from tlb.inventory i where i.product_id=v_product_id and date=ful and available),'No available quantity is configured for '||(p->>'name')||' on '||ful::text||'.');
   stock:=tlb.capacity_remaining(v_product_id,ful,p_original);
   perform tlb.require(stock>=requested,'Only '||coalesce(stock,0)::text||' units of '||(p->>'name')||' remain on '||ful::text||'.');$old$,
     $new$   -- TLB_DAILY_LIMITS_V1: absence/null is unlimited; explicit closures still apply.
   perform tlb.require(not exists(select 1 from tlb.inventory i where i.product_id=v_product_id and date=ful and not available),(p->>'name')||' is unavailable on '||ful::text||'.');
   stock:=tlb.capacity_remaining(v_product_id,ful,p_original);
   perform tlb.require(stock is null or stock>=requested,'Only '||coalesce(stock,0)::text||' units of '||(p->>'name')||' remain on '||ful::text||'.');$new$),
    ('public.shop_api(text,jsonb,text)',
     $old$  perform tlb.require(jsonb_typeof(p_payload->'rows')='array','Provide inventory rows.');
  for x in select value from jsonb_array_elements(p_payload->'rows') loop
   product:=(x->>'product_id')::uuid; day:=(x->>'date')::date; cap:=(x->>'capacity')::integer;
   perform tlb.require(cap between 0 and 1000000 and day is not null,'Enter a valid date and nonnegative whole-unit capacity.');
   select coalesce(sum(quantity),0)::integer into taken from tlb.allocations where product_id=product and date=day;
   perform tlb.require(cap>=taken,'Capacity cannot be below the '||taken||' units already reserved or committed on '||day||'.');
   insert into tlb.inventory(product_id,date,capacity,available) values(product,day,cap,coalesce((x->>'available')::boolean,true)) on conflict(product_id,date) do update set capacity=excluded.capacity,available=excluded.available;
  end loop;
  return tlb.inventory_json();$old$,
     $new$  -- TLB_DAILY_LIMITS_V1: staff authorization and transaction lock above apply.
  return tlb.save_daily_quantities(p_payload);$new$)
   ) as patches(function_signature,old_value,new_value) where function_signature=signature loop
    patch.old_value:=replace(patch.old_value,chr(13)||chr(10),chr(10));
    patch.new_value:=replace(patch.new_value,chr(13)||chr(10),chr(10));
    if length(definition)-length(replace(definition,patch.old_value,''))<>length(patch.old_value) then
     raise exception 'Unexpected function definition in % daily limits migration; review before applying.',signature;
    end if;
    definition:=replace(definition,patch.old_value,patch.new_value);
   end loop;
   if keep_crlf then definition:=replace(definition,chr(10),chr(13)||chr(10)); end if;
   execute definition;
  end if;
 end loop;
end $migration$;

commit;
