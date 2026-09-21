-- Reorder the complete catalog in one transaction; never replace product details.
create function tlb.reorder_catalog(p_kind text, p_ids jsonb, p_expected jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  current_items jsonb; current_order jsonb; expected_order jsonb; wanted uuid[];
begin
  perform tlb.require(tlb.is_verified(auth.uid()), 'A verified owner account is required.');
  perform tlb.assert_staff(auth.uid(), true);
  perform pg_advisory_xact_lock(841721950318::bigint);
  perform tlb.require(p_kind in ('products','categories'), 'Choose products or categories.');
  perform tlb.require(jsonb_typeof(p_ids)='array' and jsonb_typeof(p_expected)='array', 'Provide the complete order.');
  perform tlb.require(not exists(select 1 from jsonb_array_elements(p_ids) x where jsonb_typeof(x)<>'string'), 'Invalid item IDs.');
  select coalesce(array_agg(value::uuid order by ord),array[]::uuid[]) into wanted from jsonb_array_elements_text(p_ids) with ordinality x(value,ord);
  perform tlb.require(cardinality(wanted)=(select count(distinct id) from unnest(wanted) id), 'Every item must appear once.');
  if p_kind='products' then
    select coalesce(jsonb_agg(p.data||jsonb_build_object('id',p.id) order by case when c.id is null then 1 else 0 end,coalesce((c.data->>'sort_order')::integer,0),c.data->>'name',c.id,coalesce((p.data->>'sort_order')::integer,0),p.data->>'name',p.id),'[]') into current_items from tlb.products p left join tlb.categories c on c.id::text=p.data->>'category_id';
  else
    select coalesce(jsonb_agg(data||jsonb_build_object('id',id) order by coalesce((data->>'sort_order')::integer,0),data->>'name',id),'[]') into current_items from tlb.categories;
  end if;
  perform tlb.require(cardinality(wanted)=jsonb_array_length(current_items) and not exists(select 1 from jsonb_array_elements(current_items) x where not ((x->>'id')::uuid=any(wanted))), 'The catalog changed. Close this list and refresh before rearranging again.');
  if p_kind='products' then
    perform tlb.require(not exists(select 1 from jsonb_array_elements(current_items) with ordinality x(item,ord) join jsonb_array_elements(current_items) y on y->>'id'=wanted[x.ord]::text where (x.item->>'category_id') is distinct from (y->>'category_id')), 'Arrange products within each category. If categories changed, close this list and refresh first.');
  end if;
  -- A lost response can be retried without overwriting a newer, different order.
  if not exists(select 1 from jsonb_array_elements(current_items) with ordinality x(item,ord) where item->>'id'<>wanted[ord]::text or coalesce((item->>'sort_order')::integer,0)<>ord) then
    return jsonb_build_object('items',current_items);
  end if;
  perform tlb.require(not exists(select 1 from jsonb_array_elements(p_expected) x where jsonb_typeof(x)<>'object' or not (x ? 'id' and x ? 'sort_order') or jsonb_typeof(x->'sort_order')<>'number'), 'Provide the previous order.');
  select coalesce(jsonb_agg(jsonb_build_object('id',x->>'id','sort_order',coalesce((x->>'sort_order')::integer,0)) || case when p_kind='products' then jsonb_build_object('category_id',x->>'category_id') else '{}'::jsonb end order by x->>'id'),'[]') into current_order from jsonb_array_elements(current_items) x;
  select coalesce(jsonb_agg(jsonb_build_object('id',x->>'id','sort_order',(x->>'sort_order')::integer) || case when p_kind='products' then jsonb_build_object('category_id',x->>'category_id') else '{}'::jsonb end order by x->>'id'),'[]') into expected_order from jsonb_array_elements(p_expected) x;
  perform tlb.require(current_order=expected_order, 'The order changed in another session. Close this list and refresh before rearranging again.');
  if p_kind='products' then
    update tlb.products p set data=jsonb_set(p.data,'{sort_order}',to_jsonb(x.ord)),updated_at=now() from unnest(wanted) with ordinality x(id,ord) where p.id=x.id;
    select coalesce(jsonb_agg(data||jsonb_build_object('id',id) order by (data->>'sort_order')::integer),'[]') into current_items from tlb.products;
  else
    update tlb.categories c set data=jsonb_set(c.data,'{sort_order}',to_jsonb(x.ord)) from unnest(wanted) with ordinality x(id,ord) where c.id=x.id;
    select coalesce(jsonb_agg(data||jsonb_build_object('id',id) order by (data->>'sort_order')::integer),'[]') into current_items from tlb.categories;
  end if;
  return jsonb_build_object('items',current_items);
end $$;
revoke all on function tlb.reorder_catalog(text,jsonb,jsonb) from public, anon, authenticated;

-- Keep the existing API authorization and transaction lock. New editors omit
-- manual order fields: preserve existing positions and append newly added items.
do $migration$
declare
  original text:=pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure);
  definition text:=replace(original,E'\r\n',E'\n');
  patch record;
begin
  for patch in select * from (values
    ($old$ perform tlb.assert_staff(u,false);$old$,
     $new$ perform tlb.assert_staff(u,false);
 if p_action='reorder_catalog' then
  return tlb.reorder_catalog(p_payload->>'kind',p_payload->'ids',p_payload->'expected');
 end if;$new$),
    ($old$  perform tlb.assert_staff(u,true);
  if p_action='save_product' then$old$,
     $new$  perform tlb.assert_staff(u,true);
  if p_action in ('save_product','save_category') and p_payload->'preserve_order'='true'::jsonb then
   field:=case when p_action='save_product' then 'product' else 'category' end;
   rid:=(p_payload->field->>'id')::uuid;
   if field='product' then
    select coalesce((data->>'sort_order')::integer,0) into n from tlb.products where id=rid;
    if not found then select coalesce(max((data->>'sort_order')::integer),0)+1 into n from tlb.products; end if;
   else
    select coalesce((data->>'sort_order')::integer,0) into n from tlb.categories where id=rid;
    if not found then select coalesce(max((data->>'sort_order')::integer),0)+1 into n from tlb.categories; end if;
   end if;
   p_payload:=jsonb_set(p_payload,array[field,'sort_order'],to_jsonb(n));
  end if;
  if p_action='save_product' then$new$),
    ($old$select coalesce(jsonb_agg(data||jsonb_build_object('id',id) order by coalesce((data->>'sort_order')::integer,0),data->>'name'),'[]') into result from tlb.products where coalesce((data->>'active')::boolean,false);$old$,
     $new$select coalesce(jsonb_agg(p.data||jsonb_build_object('id',p.id) order by case when c.id is null then 1 else 0 end,coalesce((c.data->>'sort_order')::integer,0),c.data->>'name',c.id,coalesce((p.data->>'sort_order')::integer,0),p.data->>'name',p.id),'[]') into result from tlb.products p left join tlb.categories c on c.id::text=p.data->>'category_id' where coalesce((p.data->>'active')::boolean,false);$new$),
    ($old$order by coalesce((data->>'sort_order')::integer,0)),'[]') from tlb.categories$old$,
     $new$order by coalesce((data->>'sort_order')::integer,0),data->>'name',id),'[]') from tlb.categories$new$)
  ) patches(old_value,new_value) loop
    patch.old_value:=replace(patch.old_value,E'\r\n',E'\n');
    patch.new_value:=replace(patch.new_value,E'\r\n',E'\n');
    if length(definition)-length(replace(definition,patch.old_value,''))<>length(patch.old_value) then
      raise exception 'Unexpected shop API definition; review catalog ordering migration.';
    end if;
    definition:=replace(definition,patch.old_value,patch.new_value);
  end loop;
  if position(E'\r\n' in original)>0 then definition:=replace(definition,E'\n',E'\r\n'); end if;
  execute definition;
end $migration$;
