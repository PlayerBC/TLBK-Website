-- Separate portfolio galleries; no change to shop products or order records.
create table tlb.galleries (
  slug text primary key check (slug in ('custom-orders', 'pastries')),
  enabled boolean not null default false,
  revision integer not null default 1,
  category_order text[] not null default '{}'
);
insert into tlb.galleries(slug) values ('custom-orders'), ('pastries');

create function tlb.gallery_normalize(value text) returns text
language sql immutable strict set search_path = '' as $$
  select translate(lower(value), 'áàâäãåéèêëíìîïóòôöõúùûüñç', 'aaaaaaeeeeiiiiooooouuuunc');
$$;
create function tlb.gallery_search_text(category text, title text, description text, keywords text[]) returns tsvector
language sql immutable set search_path = '' as $$
  select to_tsvector('simple'::regconfig, tlb.gallery_normalize(category || ' ' || title || ' ' || description || ' ' || array_to_string(keywords, ' ')));
$$;
create table tlb.gallery_photos (
  id uuid primary key default gen_random_uuid(),
  gallery text not null references tlb.galleries(slug),
  photo_url text not null check (photo_url ~ '^https://[^[:space:]]+$' and length(photo_url) <= 4096),
  category text not null check (length(btrim(category)) between 1 and 100),
  title text not null default '' check (length(title) <= 200),
  description text not null default '' check (length(description) <= 2000),
  keywords text[] not null default '{}' check (cardinality(keywords) <= 100),
  published boolean not null default true,
  sort_order integer not null default 0,
  legacy_id text check (length(legacy_id) between 1 and 300),
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  search_vector tsvector generated always as (tlb.gallery_search_text(category, title, description, keywords)) stored,
  unique (gallery, legacy_id)
);
create index gallery_photos_browse on tlb.gallery_photos(gallery, sort_order, created_at, id);
create index gallery_photos_category on tlb.gallery_photos(gallery, category);
create index gallery_photos_search on tlb.gallery_photos using gin(search_vector);
alter table tlb.galleries enable row level security;
alter table tlb.gallery_photos enable row level security;
revoke all on tlb.galleries, tlb.gallery_photos from public, anon, authenticated;
revoke all on function tlb.gallery_normalize(text), tlb.gallery_search_text(text,text,text,text[]) from public, anon, authenticated;

-- This narrow definer API follows the shop's private-schema model. Public reads
-- explicitly project fields; owner checks precede every administration action.
create function public.gallery_api(p_action text, p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g text := p_payload->>'gallery';
  cfg tlb.galleries;
  photo tlb.gallery_photos;
  entry jsonb;
  entries jsonb;
  tags text[];
  category_name text;
  items jsonb;
  categories jsonb;
  total bigint;
  query_text text := btrim(coalesce(p_payload->>'query', ''));
  search_query tsquery;
  page_offset integer;
  added integer := 0;
  skipped integer := 0;
  affected integer;
begin
  perform tlb.require(g in ('custom-orders', 'pastries'), 'Choose a valid gallery.');
  select * into cfg from tlb.galleries where slug = g;
  if p_action <> 'browse' then
    perform tlb.require(tlb.is_verified(auth.uid()), 'Sign in with a verified owner account.');
    perform tlb.assert_staff(auth.uid(), true);
  end if;

  if p_action in ('browse', 'admin_list') then
    if p_action = 'browse' and not cfg.enabled then
      return jsonb_build_object('enabled', false, 'items', '[]'::jsonb, 'categories', '[]'::jsonb, 'total', 0);
    end if;
    perform tlb.require(length(query_text) <= 120, 'Search must be 120 characters or fewer.');
    page_offset := coalesce((p_payload->>'offset')::integer, 0);
    perform tlb.require(page_offset >= 0, 'Invalid page.');
    select to_tsquery('simple'::regconfig, string_agg(quote_literal(token) || ':*', ' & ')) into search_query
      from regexp_split_to_table(tlb.gallery_normalize(query_text), '[^[:alnum:]]+') token where token <> '';
    select coalesce(jsonb_agg(c.category order by array_position(cfg.category_order, c.category) nulls last, c.category), '[]') into categories
      from (select distinct category from tlb.gallery_photos where gallery = g and (p_action = 'admin_list' or published)) c;
    select count(*) into total from tlb.gallery_photos p
      where p.gallery = g and (p_action = 'admin_list' or p.published)
      and (coalesce(p_payload->>'category', '') = '' or p.category = p_payload->>'category')
      and (query_text = '' or (search_query is not null and p.search_vector @@ search_query));
    select coalesce(jsonb_agg(result order by sort_order, created_at, id), '[]') into items from (
      select p.sort_order, p.created_at, p.id,
        case when p_action = 'admin_list' then to_jsonb(p) - 'search_vector'
        else jsonb_build_object('id', p.id, 'photo_url', p.photo_url, 'category', p.category, 'title', p.title, 'description', p.description) end as result
      from tlb.gallery_photos p
      where p.gallery = g and (p_action = 'admin_list' or p.published)
      and (coalesce(p_payload->>'category', '') = '' or p.category = p_payload->>'category')
      and (query_text = '' or (search_query is not null and p.search_vector @@ search_query))
      order by p.sort_order, p.created_at, p.id limit 24 offset page_offset
    ) page;
    return jsonb_build_object('enabled', cfg.enabled, 'revision', cfg.revision, 'items', items, 'categories', categories, 'total', total);
  elsif p_action = 'set_enabled' then
    perform tlb.require(jsonb_typeof(p_payload->'enabled') = 'boolean', 'Choose a gallery status.');
    perform tlb.require(not (p_payload->>'enabled')::boolean or exists(select 1 from tlb.gallery_photos where gallery = g and published), 'Add or import photos before publishing the gallery.');
    update tlb.galleries set enabled = (p_payload->>'enabled')::boolean, revision = revision + 1
      where slug = g and revision = (p_payload->>'revision')::integer returning * into cfg;
    perform tlb.require(found, 'Gallery changed. Refresh before trying again.');
    return jsonb_build_object('enabled', cfg.enabled, 'revision', cfg.revision);
  elsif p_action = 'delete' then
    delete from tlb.gallery_photos where gallery = g and id = (p_payload->>'id')::uuid and revision = (p_payload->>'revision')::integer;
    perform tlb.require(found, 'Photo changed or was removed. Refresh before trying again.');
    return jsonb_build_object('deleted', true);
  elsif p_action in ('save', 'import') then
    entries := case when p_action = 'save' then jsonb_build_array(p_payload->'photo') else p_payload->'photos' end;
    perform tlb.require(jsonb_typeof(entries) = 'array', 'Choose photos to save.');
    perform tlb.require(jsonb_array_length(entries) between 1 and 100, 'Import up to 100 photos per batch.');
    for entry in select value from jsonb_array_elements(entries) loop
      perform tlb.require(jsonb_typeof(entry) = 'object', 'Invalid photo record.');
      category_name := btrim(entry->>'category');
      perform tlb.require(length(category_name) between 1 and 100, 'Each photo needs a category (up to 100 characters).');
      perform tlb.require(entry->>'photo_url' ~ '^https://[^[:space:]]+$' and length(entry->>'photo_url') <= 4096, 'Each photo needs a secure image URL.');
      perform tlb.require(jsonb_typeof(coalesce(entry->'keywords', '[]')) = 'array', 'Keywords must be a list.');
      perform tlb.require(not exists(select 1 from jsonb_array_elements(coalesce(entry->'keywords', '[]')) t where jsonb_typeof(t) <> 'string' or length(btrim(t #>> '{}')) not between 1 and 100), 'Each keyword must have 1–100 characters.');
      select coalesce(array_agg(distinct btrim(value)), '{}') into tags from jsonb_array_elements_text(coalesce(entry->'keywords', '[]'));
      perform tlb.require(cardinality(tags) <= 100, 'Use up to 100 keywords per photo.');
      perform tlb.require(length(coalesce(entry->>'title', '')) <= 200 and length(coalesce(entry->>'description', '')) <= 2000, 'Name or description is too long.');
      if p_action = 'import' then
        perform tlb.require(length(btrim(entry->>'legacy_id')) between 1 and 300, 'Imported photos need their original record ID.');
        insert into tlb.gallery_photos(gallery, photo_url, category, title, description, keywords, published, sort_order, legacy_id)
          values (g, entry->>'photo_url', category_name, coalesce(entry->>'title', ''), coalesce(entry->>'description', ''), tags,
            coalesce((entry->>'published')::boolean, true), coalesce((entry->>'sort_order')::integer, 0), btrim(entry->>'legacy_id'))
          on conflict (gallery, legacy_id) do nothing;
        get diagnostics affected = row_count;
        added := added + affected; skipped := skipped + 1 - affected;
      elsif nullif(entry->>'id', '') is null then
        insert into tlb.gallery_photos(gallery, photo_url, category, title, description, keywords, published, sort_order)
          values (g, entry->>'photo_url', category_name, coalesce(entry->>'title', ''), coalesce(entry->>'description', ''), tags,
            coalesce((entry->>'published')::boolean, true), coalesce((entry->>'sort_order')::integer, 0)) returning * into photo;
      else
        update tlb.gallery_photos set photo_url = entry->>'photo_url', category = category_name, title = coalesce(entry->>'title', ''),
          description = coalesce(entry->>'description', ''), keywords = tags, published = coalesce((entry->>'published')::boolean, true),
          sort_order = coalesce((entry->>'sort_order')::integer, 0), revision = revision + 1
          where id = (entry->>'id')::uuid and gallery = g and revision = (entry->>'revision')::integer returning * into photo;
        perform tlb.require(found, 'Photo changed or was removed. Refresh before trying again.');
      end if;
    end loop;
    if p_action = 'import' and p_payload ? 'categories' then
      perform tlb.require(jsonb_typeof(p_payload->'categories') = 'array', 'Invalid categories.');
      perform tlb.require(jsonb_array_length(p_payload->'categories') <= 500 and not exists(select 1 from jsonb_array_elements(p_payload->'categories') c where jsonb_typeof(c) <> 'string' or length(c #>> '{}') not between 1 and 100), 'Invalid categories.');
      update tlb.galleries set category_order = array(select value from jsonb_array_elements_text(p_payload->'categories')) where slug = g;
    end if;
    return case when p_action = 'save' then to_jsonb(photo) - 'search_vector' else jsonb_build_object('added', added, 'skipped', skipped) end;
  end if;
  raise exception 'Unknown gallery action.' using errcode = '22023';
end;
$$;
revoke all on function public.gallery_api(text,jsonb) from public, anon, authenticated;
grant execute on function public.gallery_api(text,jsonb) to anon, authenticated;
