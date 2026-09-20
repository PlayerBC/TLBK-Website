-- Managed slideshow photos are separate from packages, products and orders.
create function tlb.valid_party_cart_photos(items jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(items) = 'array' then
    jsonb_array_length(items) <= 500
    and (select count(distinct lower(item->>'id')) from jsonb_array_elements(items) item) = jsonb_array_length(items)
    and not exists(select 1 from jsonb_array_elements(items) item
      where jsonb_typeof(item) is distinct from 'object'
        or jsonb_typeof(item->'id') is distinct from 'string'
        or (item->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or jsonb_typeof(item->'photo_url') is distinct from 'string'
        or not ((item->>'photo_url') ~ '^assets/(partycart/[A-Za-z0-9_-]+\.jpg|img/products-webp/[A-Za-z0-9_-]+\.webp)$'
          or (item->>'photo_url') ~ '^https://aulhqofjjckwwjmdvqgi\.supabase\.co/storage/v1/object/public/product-images/[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$')
        or jsonb_typeof(item->'caption') is distinct from 'string'
        or length(item->>'caption') > 200
        or jsonb_typeof(item->'published') is distinct from 'boolean'
        or (item - 'id' - 'photo_url' - 'caption' - 'published') <> '{}'::jsonb)
    else false end;
$$;
revoke all on function tlb.valid_party_cart_photos(jsonb) from public, anon, authenticated;

create table tlb.party_cart_gallery (
  id boolean primary key default true check (id),
  items jsonb not null check (tlb.valid_party_cart_photos(items)),
  revision integer not null default 1,
  last_save uuid
);
alter table tlb.party_cart_gallery enable row level security;
revoke all on tlb.party_cart_gallery from public, anon, authenticated;

insert into tlb.party_cart_gallery(items) values ('[{"id": "7caa6da6-8950-4416-b764-a8884f323d2e", "photo_url": "assets/img/products-webp/Party_Cart_1-1600w.webp", "caption": "Our cart at your celebration", "published": true}, {"id": "7e3056c8-8429-4101-9e89-75e597e42cea", "photo_url": "assets/partycart/cart16.jpg", "caption": "A scoop of celebration", "published": true}, {"id": "d172c2f8-b2b2-4930-b92c-1a3167faa9f6", "photo_url": "assets/img/products-webp/cart4-1600w.webp", "caption": "Nori chips, party ready", "published": true}, {"id": "09d2913e-f286-47bb-9d9a-96433c7683bc", "photo_url": "assets/partycart/cart9.jpg", "caption": "The Little Baker Kitchen cart", "published": true}, {"id": "33b18fda-4fe8-46d1-bf4e-9aafcdce5f70", "photo_url": "assets/img/products-webp/cart6-1600w.webp", "caption": "Freshly baked treats", "published": true}, {"id": "7aaf5d48-b5dc-4e07-bae1-04378c6571b4", "photo_url": "assets/partycart/Nibblers_Sample.jpg", "caption": "Gourmet cookie nibblers", "published": true}, {"id": "f1b8dbbd-81dd-43d9-a59d-485662565ea1", "photo_url": "assets/partycart/cart10.jpg", "caption": "Custom character marshmallows", "published": true}, {"id": "22601851-81fd-4483-80eb-864ecaa2d180", "photo_url": "assets/img/products-webp/cart8-1600w.webp", "caption": "Build your perfect cup", "published": true}, {"id": "e8b0e56e-7146-450b-a816-0249960499b0", "photo_url": "assets/partycart/cart14.jpg", "caption": "Cookies & s’more bites", "published": true}, {"id": "d39adc81-9f1a-4929-8eaa-e4c80a4f56bb", "photo_url": "assets/partycart/cart12.jpg", "caption": "Cookie A La Mode", "published": true}, {"id": "29582cd4-f15d-4a5d-9d6a-0e8f2255e9f6", "photo_url": "assets/partycart/cart11.jpg", "caption": "Toppings for every taste", "published": true}, {"id": "e7665117-e25c-4eca-8ceb-276bbefafda4", "photo_url": "assets/img/products-webp/cart5-1600w.webp", "caption": "Sweet moments at the cart", "published": true}, {"id": "220956e0-95d2-416b-9a08-190d8606cd92", "photo_url": "assets/img/products-webp/cart7-1600w.webp", "caption": "Something for everyone", "published": true}, {"id": "3617ee07-e5ec-4a30-b01e-34451a0b8f1c", "photo_url": "assets/partycart/cart13.jpg", "caption": "A treat for every guest", "published": true}, {"id": "fdf9b6a9-d850-47a8-b5b0-d9cd4f7d57fc", "photo_url": "assets/partycart/cart15.jpg", "caption": "Pick your favorites", "published": true}, {"id": "3e7cbc9c-3d56-420a-a0e4-648b1ca54505", "photo_url": "assets/img/products-webp/cart2-1600w.webp", "caption": "Made just for you", "published": true}, {"id": "c74b2f25-d47c-4270-950e-87aac94c4850", "photo_url": "assets/img/products-webp/cart3-1600w.webp", "caption": "Little moments, big smiles", "published": true}]'::jsonb);

create function public.party_cart_photos_api(p_action text, p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  cfg tlb.party_cart_gallery;
  operation uuid;
  visible_items jsonb;
begin
  if p_action is distinct from 'browse' then
    perform tlb.require(tlb.is_verified(auth.uid()), 'Sign in with a verified owner account.');
    perform tlb.assert_staff(auth.uid(), true);
  end if;
  if p_action = 'browse' then
    select coalesce(jsonb_agg(jsonb_build_object('id',p.item->'id','photo_url',p.item->'photo_url','caption',p.item->'caption') order by p.position),'[]'::jsonb)
      into visible_items from tlb.party_cart_gallery g, jsonb_array_elements(g.items) with ordinality p(item,position)
      where g.id and (p.item->>'published')::boolean;
    return jsonb_build_object('items',visible_items);
  elsif p_action = 'admin_get' then
    select * into cfg from tlb.party_cart_gallery where id;
    return jsonb_build_object('items',cfg.items,'revision',cfg.revision);
  elsif p_action = 'save' then
    perform tlb.require(tlb.valid_party_cart_photos(p_payload->'items'), 'Use up to 500 unique photos with valid image links, captions up to 200 characters, and visibility settings.');
    operation := (p_payload->>'operation_id')::uuid;
    perform tlb.require(operation is not null, 'Refresh photos before saving.');
    select * into cfg from tlb.party_cart_gallery where id for update;
    perform tlb.require(found, 'Photo settings are unavailable. Refresh photos and try again.');
    if cfg.last_save is distinct from operation then
      perform tlb.require(cfg.revision = (p_payload->>'revision')::integer,
        'Photos changed in another window. Copy your captions, then refresh photos and review the latest order.');
      update tlb.party_cart_gallery set items=p_payload->'items',revision=revision+1,last_save=operation
        where id returning * into cfg;
    end if;
    return jsonb_build_object('items',cfg.items,'revision',cfg.revision);
  end if;
  raise exception using errcode='22023', message='Unknown party cart photo action.';
end;
$$;
revoke all on function public.party_cart_photos_api(text,jsonb) from public, anon, authenticated;
grant execute on function public.party_cart_photos_api(text,jsonb) to anon, authenticated;
notify pgrst, 'reload schema';
