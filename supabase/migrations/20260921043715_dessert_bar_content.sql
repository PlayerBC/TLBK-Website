-- Independent dessert bar content starts empty and shares only validators.
-- Private definer handlers check the verified owner for every administrative
-- action. Public invoker wrappers expose only the deliberately narrow API.
create schema dessert_bar_private;
revoke all on schema dessert_bar_private from public, anon, authenticated;
grant usage on schema dessert_bar_private to anon, authenticated;

create table tlb.dessert_bar_packages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  subtitle text not null default '' check (length(subtitle) <= 200),
  price_cents integer not null check (price_cents between 1 and 100000000),
  badge text not null default '' check (length(badge) <= 32),
  features jsonb not null check (tlb.valid_package_features(features)),
  published boolean not null default true,
  sort_order integer not null default 0 check (sort_order between 0 and 10000),
  revision integer not null default 1,
  last_save uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table tlb.dessert_bar_settings (
  id boolean primary key default true check (id),
  inclusions jsonb not null default '[]' check (inclusions = '[]'::jsonb or tlb.valid_package_features(inclusions)),
  cart_items jsonb not null default '[]' check (tlb.valid_party_cart_items(cart_items)),
  cart_items_revision integer not null default 1,
  cart_items_last_save uuid,
  revision integer not null default 1,
  last_save uuid
);
alter table tlb.dessert_bar_packages enable row level security;
alter table tlb.dessert_bar_settings enable row level security;
revoke all on tlb.dessert_bar_packages, tlb.dessert_bar_settings from public, anon, authenticated;

create table tlb.dessert_bar_gallery (
  id boolean primary key default true check (id),
  items jsonb not null check (tlb.valid_party_cart_photos(items)),
  revision integer not null default 1,
  last_save uuid
);
alter table tlb.dessert_bar_gallery enable row level security;
revoke all on tlb.dessert_bar_gallery from public, anon, authenticated;


insert into tlb.dessert_bar_settings(inclusions,cart_items) values ('[]','[]');
insert into tlb.dessert_bar_gallery(items) values ('[]');
create policy deny_direct_client_access on tlb.dessert_bar_packages for all to anon, authenticated using (false) with check (false);
create policy deny_direct_client_access on tlb.dessert_bar_settings for all to anon, authenticated using (false) with check (false);
create policy deny_direct_client_access on tlb.dessert_bar_gallery for all to anon, authenticated using (false) with check (false);

create function dessert_bar_private.packages_api(p_action text, p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  package tlb.dessert_bar_packages;
  settings tlb.dessert_bar_settings;
  entry jsonb := p_payload->'package';
  items jsonb;
  package_id uuid;
  operation uuid;
begin
  if p_action is distinct from 'browse' then
    perform tlb.require(tlb.is_verified(auth.uid()), 'Sign in with a verified owner account.');
    perform tlb.assert_staff(auth.uid(), true);
  end if;
  if p_action in ('browse','admin_list') then
    select * into settings from tlb.dessert_bar_settings where id;
    select coalesce(jsonb_agg(
      case when p_action = 'admin_list' then to_jsonb(p) - 'last_save'
      else jsonb_build_object('id',p.id,'name',p.name,'subtitle',p.subtitle,'price_cents',p.price_cents,'badge',p.badge,'features',p.features) end
      order by p.sort_order, p.created_at, p.id), '[]'::jsonb) into items
      from tlb.dessert_bar_packages p where p_action = 'admin_list' or p.published;
    return jsonb_build_object('items',items,'settings',case when p_action = 'admin_list'
      then jsonb_build_object('inclusions',settings.inclusions,'revision',settings.revision)
      else jsonb_build_object('inclusions',settings.inclusions) end);
  elsif p_action = 'save' then
    perform tlb.require(jsonb_typeof(entry) = 'object', 'Enter package details.');
    perform tlb.require(jsonb_typeof(entry->'name') = 'string' and length(btrim(entry->>'name')) between 1 and 120, 'Enter a package name (up to 120 characters).');
    perform tlb.require(jsonb_typeof(entry->'subtitle') = 'string' and length(entry->>'subtitle') <= 200, 'Subtitle must be 200 characters or fewer.');
    perform tlb.require(jsonb_typeof(entry->'badge') = 'string' and length(entry->>'badge') <= 32, 'Badge must be 32 characters or fewer.');
    perform tlb.require(jsonb_typeof(entry->'price_cents') = 'number' and (entry->>'price_cents') ~ '^[0-9]{1,9}$', 'Enter a valid price with at most two decimal places.');
    perform tlb.require((entry->>'price_cents')::integer between 1 and 100000000, 'Price must be between PHP 0.01 and PHP 1,000,000.');
    perform tlb.require(jsonb_typeof(entry->'sort_order') = 'number' and (entry->>'sort_order') ~ '^[0-9]{1,5}$', 'Enter a whole display order from 0 to 10000.');
    perform tlb.require((entry->>'sort_order')::integer <= 10000, 'Enter a whole display order from 0 to 10000.');
    perform tlb.require(jsonb_typeof(entry->'published') = 'boolean', 'Choose whether to show the package.');
    perform tlb.require(tlb.valid_package_features(entry->'features'), 'Add 1 to 30 inclusions, each with a label (up to 200 characters) and optional details (up to 1600 characters).');
    package_id := (entry->>'id')::uuid;
    operation := (p_payload->>'operation_id')::uuid;
    perform tlb.require(package_id is not null and operation is not null, 'Reload the editor before saving.');
    if (entry->>'revision')::integer = 0 then
      insert into tlb.dessert_bar_packages(id,name,subtitle,price_cents,badge,features,published,sort_order,last_save)
        values(package_id,btrim(entry->>'name'),btrim(entry->>'subtitle'),(entry->>'price_cents')::integer,btrim(entry->>'badge'),entry->'features',(entry->>'published')::boolean,(entry->>'sort_order')::integer,operation)
        on conflict (id) do nothing;
    end if;
    select * into package from tlb.dessert_bar_packages where id = package_id for update;
    perform tlb.require(found, 'Package was not found. Close the editor and refresh.');
    -- Retrying a request whose response was lost does not create duplicates.
    if package.last_save = operation then return to_jsonb(package) - 'last_save'; end if;
    perform tlb.require(package.revision = (entry->>'revision')::integer, 'Package changed in another window. Copy your edits, then close the editor and refresh.');
    update tlb.dessert_bar_packages set name=btrim(entry->>'name'),subtitle=btrim(entry->>'subtitle'),price_cents=(entry->>'price_cents')::integer,
      badge=btrim(entry->>'badge'),features=entry->'features',published=(entry->>'published')::boolean,sort_order=(entry->>'sort_order')::integer,
      revision=revision+1,last_save=operation,updated_at=now() where id=package_id returning * into package;
    return to_jsonb(package) - 'last_save';
  elsif p_action = 'delete' then
    package_id := (p_payload->>'id')::uuid;
    perform tlb.require(package_id is not null, 'Choose a package to delete.');
    perform tlb.require(jsonb_typeof(p_payload->'revision') = 'number'
      and (p_payload->>'revision') ~ '^[1-9][0-9]{0,9}$', 'Refresh before deleting this package.');
    select * into package from tlb.dessert_bar_packages where id = package_id for update;
    -- A lost response can be retried safely; an absent package is already deleted.
    if not found then return jsonb_build_object('id',package_id,'deleted',true); end if;
    perform tlb.require(package.revision::bigint = (p_payload->>'revision')::bigint,
      'Package changed in another window. Refresh and review it before deleting.');
    delete from tlb.dessert_bar_packages where id = package_id;
    return jsonb_build_object('id',package_id,'deleted',true);
  elsif p_action = 'save_settings' then
    perform tlb.require((p_payload->'inclusions' = '[]'::jsonb or tlb.valid_package_features(p_payload->'inclusions')), 'Use up to 30 shared inclusions with labels and optional details.');
    operation := (p_payload->>'operation_id')::uuid;
    perform tlb.require(operation is not null, 'Reload before saving.');
    select * into settings from tlb.dessert_bar_settings where id for update;
    if settings.last_save is distinct from operation then
      perform tlb.require(settings.revision = (p_payload->>'revision')::integer, 'Shared inclusions changed in another window. Copy your edits, then close the editor and refresh.');
      update tlb.dessert_bar_settings set inclusions=p_payload->'inclusions',revision=revision+1,last_save=operation where id returning * into settings;
    end if;
    return jsonb_build_object('inclusions',settings.inclusions,'revision',settings.revision);
  end if;
  raise exception using errcode='22023', message='Unknown dessert bar package action.';
end;
$$;
create function dessert_bar_private.items_api(p_action text, p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  cfg tlb.dessert_bar_settings;
  operation uuid;
begin
  if p_action is distinct from 'browse' then
    perform tlb.require(tlb.is_verified(auth.uid()), 'Sign in with a verified owner account.');
    perform tlb.assert_staff(auth.uid(), true);
  end if;
  if p_action in ('browse','admin_get') then
    select * into cfg from tlb.dessert_bar_settings where id;
    return jsonb_build_object('items',cfg.cart_items) || case when p_action = 'admin_get'
      then jsonb_build_object('revision',cfg.cart_items_revision) else '{}'::jsonb end;
  elsif p_action = 'save' then
    perform tlb.require(tlb.valid_party_cart_items(p_payload->'items'), 'Use up to 100 items, with a name of 1 to 200 characters each.');
    operation := (p_payload->>'operation_id')::uuid;
    perform tlb.require(operation is not null, 'Reload the editor before saving.');
    select * into cfg from tlb.dessert_bar_settings where id for update;
    if cfg.cart_items_last_save is distinct from operation then
      perform tlb.require(cfg.cart_items_revision = (p_payload->>'revision')::integer,
        'Dessert bar items changed in another window. Copy your edits, then close the editor and refresh.');
      update tlb.dessert_bar_settings set cart_items=p_payload->'items',cart_items_revision=cart_items_revision+1,cart_items_last_save=operation
        where id returning * into cfg;
    end if;
    return jsonb_build_object('items',cfg.cart_items,'revision',cfg.cart_items_revision);
  end if;
  raise exception using errcode='22023', message='Unknown cart items action.';
end;
$$;
create function dessert_bar_private.photos_api(p_action text, p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  cfg tlb.dessert_bar_gallery;
  operation uuid;
  visible_items jsonb;
begin
  if p_action is distinct from 'browse' then
    perform tlb.require(tlb.is_verified(auth.uid()), 'Sign in with a verified owner account.');
    perform tlb.assert_staff(auth.uid(), true);
  end if;
  if p_action = 'browse' then
    select coalesce(jsonb_agg(jsonb_build_object('id',p.item->'id','photo_url',p.item->'photo_url','caption',p.item->'caption') order by p.position),'[]'::jsonb)
      into visible_items from tlb.dessert_bar_gallery g, jsonb_array_elements(g.items) with ordinality p(item,position)
      where g.id and (p.item->>'published')::boolean;
    return jsonb_build_object('items',visible_items);
  elsif p_action = 'admin_get' then
    select * into cfg from tlb.dessert_bar_gallery where id;
    return jsonb_build_object('items',cfg.items,'revision',cfg.revision);
  elsif p_action = 'save' then
    perform tlb.require(tlb.valid_party_cart_photos(p_payload->'items'), 'Use up to 500 unique photos with valid image links, captions up to 200 characters, and visibility settings.');
    operation := (p_payload->>'operation_id')::uuid;
    perform tlb.require(operation is not null, 'Refresh photos before saving.');
    select * into cfg from tlb.dessert_bar_gallery where id for update;
    perform tlb.require(found, 'Photo settings are unavailable. Refresh photos and try again.');
    if cfg.last_save is distinct from operation then
      perform tlb.require(cfg.revision = (p_payload->>'revision')::integer,
        'Photos changed in another window. Copy your captions, then refresh photos and review the latest order.');
      update tlb.dessert_bar_gallery set items=p_payload->'items',revision=revision+1,last_save=operation
        where id returning * into cfg;
    end if;
    return jsonb_build_object('items',cfg.items,'revision',cfg.revision);
  end if;
  raise exception using errcode='22023', message='Unknown dessert bar photo action.';
end;
$$;

revoke all on function dessert_bar_private.packages_api(text,jsonb) from public, anon, authenticated;
grant execute on function dessert_bar_private.packages_api(text,jsonb) to anon, authenticated;
create function public.dessert_bar_packages_api(p_action text, p_payload jsonb default '{}') returns jsonb
language sql security invoker set search_path = '' as $$
  select dessert_bar_private.packages_api(p_action,p_payload);
$$;
revoke all on function public.dessert_bar_packages_api(text,jsonb) from public, anon, authenticated;
grant execute on function public.dessert_bar_packages_api(text,jsonb) to anon, authenticated;

revoke all on function dessert_bar_private.items_api(text,jsonb) from public, anon, authenticated;
grant execute on function dessert_bar_private.items_api(text,jsonb) to anon, authenticated;
create function public.dessert_bar_items_api(p_action text, p_payload jsonb default '{}') returns jsonb
language sql security invoker set search_path = '' as $$
  select dessert_bar_private.items_api(p_action,p_payload);
$$;
revoke all on function public.dessert_bar_items_api(text,jsonb) from public, anon, authenticated;
grant execute on function public.dessert_bar_items_api(text,jsonb) to anon, authenticated;

revoke all on function dessert_bar_private.photos_api(text,jsonb) from public, anon, authenticated;
grant execute on function dessert_bar_private.photos_api(text,jsonb) to anon, authenticated;
create function public.dessert_bar_photos_api(p_action text, p_payload jsonb default '{}') returns jsonb
language sql security invoker set search_path = '' as $$
  select dessert_bar_private.photos_api(p_action,p_payload);
$$;
revoke all on function public.dessert_bar_photos_api(text,jsonb) from public, anon, authenticated;
grant execute on function public.dessert_bar_photos_api(text,jsonb) to anon, authenticated;
notify pgrst, 'reload schema';
