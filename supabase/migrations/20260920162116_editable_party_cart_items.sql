-- Keep the editable customization list alongside existing party-page settings.
-- Its own revision prevents unrelated shared-inclusion edits from conflicting.
create function tlb.valid_party_cart_items(items jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(items) = 'array' then jsonb_array_length(items) <= 100
    and not exists(select 1 from jsonb_array_elements(items) item
      where jsonb_typeof(item) is distinct from 'string'
        or length(btrim(item #>> '{}')) not between 1 and 200)
    else false end;
$$;
revoke all on function tlb.valid_party_cart_items(jsonb) from public, anon, authenticated;
alter table tlb.party_package_settings
  add column cart_items jsonb not null default '[
    "Cookie A La Mode",
    "Custom Character Marshmallows (For Cookie A La Mode Topping)",
    "Nori Chips Cups",
    "Gourmet Cookie Nibblers",
    "French Macarons (Plain or Character Design)",
    "Cream Puffs (Vanilla / Ube)",
    "Brownies / Cheesecake Brownie Bites",
    "Coconut Macaroons",
    "Cheese Custaroons",
    "Tiramisu Cups",
    "Cheesecake Bites",
    "Panna Cotta Cups"
  ]'::jsonb check (tlb.valid_party_cart_items(cart_items)),
  add column cart_items_revision integer not null default 1,
  add column cart_items_last_save uuid;

create function public.party_cart_items_api(p_action text, p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  cfg tlb.party_package_settings;
  operation uuid;
begin
  if p_action is distinct from 'browse' then
    perform tlb.require(tlb.is_verified(auth.uid()), 'Sign in with a verified owner account.');
    perform tlb.assert_staff(auth.uid(), true);
  end if;
  if p_action in ('browse','admin_get') then
    select * into cfg from tlb.party_package_settings where id;
    return jsonb_build_object('items',cfg.cart_items) || case when p_action = 'admin_get'
      then jsonb_build_object('revision',cfg.cart_items_revision) else '{}'::jsonb end;
  elsif p_action = 'save' then
    perform tlb.require(tlb.valid_party_cart_items(p_payload->'items'), 'Use up to 100 items, with a name of 1 to 200 characters each.');
    operation := (p_payload->>'operation_id')::uuid;
    perform tlb.require(operation is not null, 'Reload the editor before saving.');
    select * into cfg from tlb.party_package_settings where id for update;
    if cfg.cart_items_last_save is distinct from operation then
      perform tlb.require(cfg.cart_items_revision = (p_payload->>'revision')::integer,
        'Cart items changed in another window. Copy your edits, then close the editor and refresh.');
      update tlb.party_package_settings set cart_items=p_payload->'items',cart_items_revision=cart_items_revision+1,cart_items_last_save=operation
        where id returning * into cfg;
    end if;
    return jsonb_build_object('items',cfg.cart_items,'revision',cfg.cart_items_revision);
  end if;
  raise exception using errcode='22023', message='Unknown cart items action.';
end;
$$;
revoke all on function public.party_cart_items_api(text,jsonb) from public, anon, authenticated;
grant execute on function public.party_cart_items_api(text,jsonb) to anon, authenticated;
notify pgrst, 'reload schema';
