-- Keep issued codes valid; all future welcome codes use six characters.
create or replace function tlb.queue_newsletter_welcome(p_email text,p_token text)
returns void language plpgsql set search_path='' as $$
declare
  v_row tlb.newsletter_subscribers;
  v_config tlb.newsletter_config;
  v_settings jsonb;
  v_offer jsonb;
  v_promo_id uuid;
  v_code text;
  v_random bytea;
  v_issued_at timestamptz:=clock_timestamp();
begin
  select * into v_row from tlb.newsletter_subscribers where email=p_email for update;
  if v_row.status is distinct from 'subscribed' or p_token is null or p_token !~ '^[0-9a-f]{64}$'
    or v_row.unsubscribe_token_hash is distinct from encode(extensions.digest(p_token,'sha256'),'hex') then
    raise exception 'Invalid welcome subscription' using errcode='22023';
  end if;
  if v_row.welcome_offer_eligible and v_row.welcome_promo_id is null then
    v_promo_id:=gen_random_uuid();
    loop
      v_random:=extensions.gen_random_bytes(6);
      select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',get_byte(v_random,i)%32+1,1),'' order by i)
        into v_code from generate_series(0,5) as i;
      -- Easy to type, always a mix, without ambiguous I/O/0/1 characters.
      if v_code !~ '[A-Z]' or v_code !~ '[2-9]' then continue; end if;
    v_offer:=jsonb_build_object('id',v_promo_id,'code',v_code,'kind','percent','value',5,
      'min_subtotal_cents',30000,'cap_cents',10000,'global_limit',1,'per_account_limit',1,
      'active',true,'expires_at',v_issued_at+interval '30 days','issued_at',v_issued_at,
      'source','newsletter_welcome');
      insert into tlb.promos(id,code,data) values(v_promo_id,v_code,v_offer) on conflict(code) do nothing;
      exit when found; -- Retry a collision with any existing manual/welcome code.
    end loop;
    update tlb.newsletter_subscribers set welcome_promo_id=v_promo_id,welcome_issued_at=v_issued_at where email=p_email;
  end if;
  select * into v_config from tlb.newsletter_config where singleton;
  select data into v_settings from tlb.settings where id;
  insert into tlb.outbox(event_key,event_type,to_email,subject,payload)
  values('newsletter-welcome:'||v_row.request_id::text,'newsletter_welcome',v_row.email,
    case when v_offer is not null then 'Welcome to TLB — here’s your 5% off code!' else 'Welcome to the TLB newsletter!' end,
    jsonb_build_object('event_type','newsletter_welcome','topic_id',v_config.topic_id,
      'unsubscribe_token',p_token,'unsubscribe_token_hash',v_row.unsubscribe_token_hash,
      'settings',jsonb_build_object('site_url',v_config.site_url,'shop_name',v_settings->>'shop_name',
        'pickup_address',v_settings->>'pickup_address','contact_email',v_settings->>'contact_email',
        'contact_phone',v_settings->>'contact_phone'))
      ||case when v_offer is null then '{}'::jsonb else jsonb_build_object('welcome_offer',v_offer) end)
  on conflict(event_key) do nothing;
end;
$$;
revoke all on function tlb.queue_newsletter_welcome(text,text) from public,anon,authenticated,service_role;

