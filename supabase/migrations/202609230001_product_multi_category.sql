-- A product remains one catalog/stock record but can be displayed in several sections.
update tlb.products p set data=p.data||jsonb_build_object(
  'category_ids',case when p.data->>'category_id' is null then '[]'::jsonb else jsonb_build_array(p.data->>'category_id') end,
  'category_sort_orders',case when p.data->>'category_id' is null then '{}'::jsonb else jsonb_build_object(p.data->>'category_id',coalesce((p.data->>'sort_order')::integer,0)) end
);

create function tlb.normalize_product_categories(p_data jsonb,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 ids jsonb; positions jsonb:='{}'::jsonb; old_positions jsonb; category_text text; item jsonb; next_position integer;
begin
 ids:=case when p_data ? 'category_ids' then p_data->'category_ids'
           when nullif(p_data->>'category_id','') is not null then jsonb_build_array(p_data->>'category_id')
           else '[]'::jsonb end;
 perform tlb.require(jsonb_typeof(ids)='array','Choose valid categories.');
 perform tlb.require(not exists(select 1 from jsonb_array_elements(ids) value where jsonb_typeof(value)<>'string'),'Choose valid categories.');
 perform tlb.require(jsonb_array_length(ids)=(select count(distinct value) from jsonb_array_elements_text(ids) value),'Choose each category once.');
 select coalesce(data->'category_sort_orders','{}'::jsonb) into old_positions from tlb.products where id=p_id;
 for item in select value from jsonb_array_elements(ids) loop
  category_text:=item#>>'{}';
  perform tlb.require(exists(select 1 from tlb.categories where id=category_text::uuid),'Category not found.');
  if old_positions ? category_text then
   positions:=positions||jsonb_build_object(category_text,(old_positions->>category_text)::integer);
  else
   select coalesce(max((data->'category_sort_orders'->>category_text)::integer),0)+1 into next_position
   from tlb.products where data->'category_sort_orders' ? category_text;
   positions:=positions||jsonb_build_object(category_text,next_position);
  end if;
 end loop;
 return p_data||jsonb_build_object(
  'category_ids',ids,
  'category_id',case when jsonb_array_length(ids)>0 then ids->0 else 'null'::jsonb end,
  'category_sort_orders',positions
 );
end $$;
revoke all on function tlb.normalize_product_categories(jsonb,uuid) from public,anon,authenticated;

create function tlb.remove_product_category(p_data jsonb,p_category uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ids jsonb;
begin
 select coalesce(jsonb_agg(value order by ord),'[]'::jsonb) into ids
 from jsonb_array_elements(coalesce(p_data->'category_ids','[]'::jsonb)) with ordinality x(value,ord)
 where value<>to_jsonb(p_category::text);
 return p_data||jsonb_build_object(
  'category_ids',ids,
  'category_id',case when jsonb_array_length(ids)>0 then ids->0 else 'null'::jsonb end,
  'category_sort_orders',coalesce(p_data->'category_sort_orders','{}'::jsonb)-p_category::text
 );
end $$;
revoke all on function tlb.remove_product_category(jsonb,uuid) from public,anon,authenticated;

-- Every category has its own ordering. A complete optimistic snapshot prevents
-- a stale editor from silently overwriting newly assigned categories or order.
create function tlb.reorder_product_categories(p_groups jsonb,p_expected jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 group_row jsonb; category_text text; product_text text; position integer;
 current_snapshot jsonb; wanted_snapshot jsonb; membership text[]; wanted text[]; seen_categories text[]:=array[]::text[];
 result jsonb;
begin
 perform tlb.require(tlb.is_verified(auth.uid()),'A verified owner account is required.');
 perform tlb.assert_staff(auth.uid(),true);
 perform pg_advisory_xact_lock(841721950318::bigint);
 perform tlb.require(jsonb_typeof(p_groups)='array' and jsonb_typeof(p_expected)='array','Provide the complete product order.');
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'category_ids',coalesce(data->'category_ids','[]'::jsonb),
   'sort_order',coalesce((data->>'sort_order')::integer,0),'category_sort_orders',coalesce(data->'category_sort_orders','{}'::jsonb)) order by id),'[]')
 into current_snapshot from tlb.products;
 select coalesce(jsonb_agg(jsonb_build_object('id',value->>'id','category_ids',value->'category_ids',
   'sort_order',(value->>'sort_order')::integer,'category_sort_orders',value->'category_sort_orders') order by value->>'id'),'[]')
 into wanted_snapshot from jsonb_array_elements(p_expected) value;
 perform tlb.require(current_snapshot=wanted_snapshot,'The order changed in another session. Close this list and refresh before rearranging again.');
 for group_row in select value from jsonb_array_elements(p_groups) loop
  perform tlb.require(jsonb_typeof(group_row->'ids')='array','Provide a list of product IDs for every category.');
  category_text:=coalesce(group_row->>'category_id','');
  perform tlb.require(not category_text=any(seen_categories),'Each category must appear once.');
  seen_categories:=array_append(seen_categories,category_text);
  perform tlb.require(category_text='' or exists(select 1 from tlb.categories where id=category_text::uuid),'Category not found.');
  perform tlb.require(not exists(select 1 from jsonb_array_elements(group_row->'ids') value where jsonb_typeof(value)<>'string'),'Invalid product IDs.');
  select coalesce(array_agg(value order by ord),array[]::text[]) into wanted
    from jsonb_array_elements_text(group_row->'ids') with ordinality x(value,ord);
  select coalesce(array_agg(id::text order by id),array[]::text[]) into membership
    from tlb.products where case when category_text='' then jsonb_array_length(coalesce(data->'category_ids','[]'::jsonb))=0
      else coalesce(data->'category_ids','[]'::jsonb) ? category_text end;
  perform tlb.require(cardinality(wanted)=cardinality(membership)
    and cardinality(wanted)=(select count(distinct value) from unnest(wanted) value)
    and wanted <@ membership,'The catalog changed. Close this list and refresh before rearranging again.');
  for product_text,position in select value,ord::integer from jsonb_array_elements_text(group_row->'ids') with ordinality x(value,ord) loop
   if category_text='' then
    update tlb.products set data=jsonb_set(data,'{sort_order}',to_jsonb(position)),updated_at=now() where id=product_text::uuid;
   else
    update tlb.products set data=jsonb_set(data,array['category_sort_orders',category_text],to_jsonb(position),true),updated_at=now() where id=product_text::uuid;
   end if;
  end loop;
 end loop;
 perform tlb.require(not exists(select 1 from tlb.products p where
   not exists(select 1 from unnest(seen_categories) as listed(section_id) where
     case when listed.section_id='' then jsonb_array_length(coalesce(p.data->'category_ids','[]'::jsonb))=0
       else coalesce(p.data->'category_ids','[]'::jsonb) ? listed.section_id end)),
   'The catalog changed. Close this list and refresh before rearranging again.');
 select coalesce(jsonb_agg(data||jsonb_build_object('id',id)),'[]') into result from tlb.products;
 return jsonb_build_object('items',result);
end $$;
revoke all on function tlb.reorder_product_categories(jsonb,jsonb) from public,anon,authenticated;

-- Keep the previous single-category ordering RPC compatible with older clients.
create function tlb.reorder_catalog_legacy(p_kind text,p_ids jsonb,p_expected jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare response jsonb;
begin
 response:=tlb.reorder_catalog(p_kind,p_ids,p_expected);
 if p_kind='products' then
  update tlb.products set data=jsonb_set(data,array['category_sort_orders',data->>'category_id'],to_jsonb((data->>'sort_order')::integer),true)
  where data->>'category_id' is not null and jsonb_array_length(coalesce(data->'category_ids','[]'::jsonb))=1;
  select jsonb_build_object('items',coalesce(jsonb_agg(data||jsonb_build_object('id',id) order by (data->>'sort_order')::integer),'[]'))
   into response from tlb.products;
 end if;
 return response;
end $$;
revoke all on function tlb.reorder_catalog_legacy(text,jsonb,jsonb) from public,anon,authenticated;

do $migration$
declare original text:=pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure);
 definition text:=replace(original,E'\r\n',E'\n'); patch record;
begin
 for patch in select * from (values
  ($old$ if p_action='reorder_catalog' then
  return tlb.reorder_catalog(p_payload->>'kind',p_payload->'ids',p_payload->'expected');
 end if;$old$,
   $new$ if p_action='reorder_catalog' then
  return tlb.reorder_catalog_legacy(p_payload->>'kind',p_payload->'ids',p_payload->'expected');
 end if;
 if p_action='reorder_product_categories' then
  return tlb.reorder_product_categories(p_payload->'groups',p_payload->'expected');
 end if;$new$),
  ($old$if row_data->>'category_id' is not null then perform tlb.require(exists(select 1 from tlb.categories where id=(row_data->>'category_id')::uuid),'Category not found.'); end if;$old$,
   $new$row_data:=tlb.normalize_product_categories(row_data,rid);$new$),
  ($old$update tlb.products set data=jsonb_set(data,'{category_id}','null') where data->>'category_id'=rid::text;$old$,
   $new$update tlb.products set data=tlb.remove_product_category(data,rid)
    where coalesce(data->'category_ids','[]'::jsonb) ? rid::text;$new$)
 ) patches(old_value,new_value) loop
  patch.old_value:=replace(patch.old_value,E'\r\n',E'\n');
  patch.new_value:=replace(patch.new_value,E'\r\n',E'\n');
  if length(definition)-length(replace(definition,patch.old_value,''))<>length(patch.old_value) then
   raise exception 'Unexpected shop API definition; review multi-category migration.';
  end if;
  definition:=replace(definition,patch.old_value,patch.new_value);
 end loop;
 if position(E'\r\n' in original)>0 then definition:=replace(definition,E'\n',E'\r\n'); end if;
 execute definition;
end $migration$;
