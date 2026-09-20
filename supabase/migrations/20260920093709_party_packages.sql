-- Party cart content is separate from shop products, stock and checkout.
create function tlb.valid_package_features(features jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(features) = 'array' then
    jsonb_array_length(features) between 1 and 30 and not exists (
      select 1 from jsonb_array_elements(features) item
      where jsonb_typeof(item) is distinct from 'object'
        or jsonb_typeof(item->'label') is distinct from 'string'
        or length(btrim(item->>'label')) not between 1 and 200
        or jsonb_typeof(item->'detail') is distinct from 'string'
        or length(item->>'detail') > 1600
        or (item - 'label' - 'detail') <> '{}'::jsonb
    ) else false end;
$$;
create table tlb.party_packages (
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
create table tlb.party_package_settings (
  id boolean primary key default true check (id),
  inclusions jsonb not null check (tlb.valid_package_features(inclusions)),
  revision integer not null default 1,
  last_save uuid
);
alter table tlb.party_packages enable row level security;
alter table tlb.party_package_settings enable row level security;
revoke all on tlb.party_packages, tlb.party_package_settings from public, anon, authenticated;
revoke all on function tlb.valid_package_features(jsonb) from public, anon, authenticated;

-- The four visible packages from partycarts.html. Hidden duplicate HTML cards
-- are not packages. Preserve the existing prices, quantities and inclusions.
insert into tlb.party_package_settings(inclusions) values ('[
  {"label":"4 Hours Duration","detail":""},
  {"label":"Full Cart Setup","detail":""},
  {"label":"2 Servers","detail":""},
  {"label":"Free Delivery Within Quezon City","detail":"Excluding Novaliches & Payatas"}
]'::jsonb);
insert into tlb.party_packages(name, subtitle, price_cents, badge, sort_order, features) values
('Package 1','Cookie A La Mode',900000,'',10,'[
  {"label":"50 Cookie A La Mode","detail":"Classic Choco Chip Cookie topped w/ Ice Cream"},
  {"label":"Choose 3 Flavors","detail":"Vanilla, Chocolate, Strawberry, Mocha, Ube, Cheese, Cookies & Cream"},
  {"label":"Toppings Included","detail":"Marshmallows, Cereals, Rainbow Sprinkles, Sliced Almonds, Chocolate Syrup, Caramel Syrup"}
]'),
('Package 2','Nori Chips',900000,'',20,'[
  {"label":"100 Cups Nori Chips","detail":""},
  {"label":"Choose 3 Flavors","detail":"Original, Barbeque, Cheese, Sourcream, White Cheddar, Chili BBQ, Sweet Corn"}
]'),
('Package 3','The Sweet & Savory Duo',1050000,'Most Popular',30,'[
  {"label":"50 Cookie A La Mode","detail":"Classic Choco Chip Cookie topped w/ Ice Cream"},
  {"label":"Choose 3 Flavors","detail":"Vanilla, Chocolate, Strawberry, Mocha, Ube, Cheese, Cookies & Cream"},
  {"label":"50 Cups Nori Chips","detail":""},
  {"label":"Choose 3 Flavors","detail":"Original, Barbeque, Cheese, Sourcream, White Cheddar, Chili BBQ, Sweet Corn"}
]'),
('Package 4','Cookie Nibblers',900000,'New!',40,'[
  {"label":"50 Cups of Gourmet Cookie Nibblers","detail":"4pcs of 20g Cookies in each cup"},
  {"label":"Choose max 4 Flavors","detail":"Classic Chocochip, S''mores. Dark Choco Almond, Choco Cheesecake, Caramel Macchiato, Ube Cheesecake, Red Velvet Cheesecake, Matchadamia, Ruby Cranberry, Oreo Madness, Pretzel Crunch"}
]');

-- A narrow public projection and verified-owner writes follow the existing
-- private-schema API model. No direct table access is granted to browsers.
create function public.party_packages_api(p_action text, p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  package tlb.party_packages;
  settings tlb.party_package_settings;
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
    select * into settings from tlb.party_package_settings where id;
    select coalesce(jsonb_agg(
      case when p_action = 'admin_list' then to_jsonb(p) - 'last_save'
      else jsonb_build_object('id',p.id,'name',p.name,'subtitle',p.subtitle,'price_cents',p.price_cents,'badge',p.badge,'features',p.features) end
      order by p.sort_order, p.created_at, p.id), '[]'::jsonb) into items
      from tlb.party_packages p where p_action = 'admin_list' or p.published;
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
      insert into tlb.party_packages(id,name,subtitle,price_cents,badge,features,published,sort_order,last_save)
        values(package_id,btrim(entry->>'name'),btrim(entry->>'subtitle'),(entry->>'price_cents')::integer,btrim(entry->>'badge'),entry->'features',(entry->>'published')::boolean,(entry->>'sort_order')::integer,operation)
        on conflict (id) do nothing;
    end if;
    select * into package from tlb.party_packages where id = package_id for update;
    perform tlb.require(found, 'Package was not found. Close the editor and refresh.');
    -- Retrying a request whose response was lost does not create duplicates.
    if package.last_save = operation then return to_jsonb(package) - 'last_save'; end if;
    perform tlb.require(package.revision = (entry->>'revision')::integer, 'Package changed in another window. Copy your edits, then close the editor and refresh.');
    update tlb.party_packages set name=btrim(entry->>'name'),subtitle=btrim(entry->>'subtitle'),price_cents=(entry->>'price_cents')::integer,
      badge=btrim(entry->>'badge'),features=entry->'features',published=(entry->>'published')::boolean,sort_order=(entry->>'sort_order')::integer,
      revision=revision+1,last_save=operation,updated_at=now() where id=package_id returning * into package;
    return to_jsonb(package) - 'last_save';
  elsif p_action = 'save_settings' then
    perform tlb.require(tlb.valid_package_features(p_payload->'inclusions'), 'Add 1 to 30 shared inclusions with labels and optional details.');
    operation := (p_payload->>'operation_id')::uuid;
    perform tlb.require(operation is not null, 'Reload before saving.');
    select * into settings from tlb.party_package_settings where id for update;
    if settings.last_save is distinct from operation then
      perform tlb.require(settings.revision = (p_payload->>'revision')::integer, 'Shared inclusions changed in another window. Copy your edits, then close the editor and refresh.');
      update tlb.party_package_settings set inclusions=p_payload->'inclusions',revision=revision+1,last_save=operation where id returning * into settings;
    end if;
    return jsonb_build_object('inclusions',settings.inclusions,'revision',settings.revision);
  end if;
  raise exception using errcode='22023', message='Unknown party package action.';
end;
$$;
revoke all on function public.party_packages_api(text,jsonb) from public, anon, authenticated;
grant execute on function public.party_packages_api(text,jsonb) to anon, authenticated;
notify pgrst, 'reload schema';
