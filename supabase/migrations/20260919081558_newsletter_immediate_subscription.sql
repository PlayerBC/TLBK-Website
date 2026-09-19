-- Signup itself records consent. The existing provider lease still serializes
-- contact updates; no email link is required for new subscriptions.
update tlb.newsletter_config set consent_version='tlb-newsletter-v2-single-opt-in' where singleton;

create or replace function tlb.begin_newsletter_subscription(p_payload jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare
  v_email text:=lower(btrim(p_payload->>'email'));
  v_row tlb.newsletter_subscribers;
  v_result jsonb;
begin
  -- Same lock order as the legacy request action, including duplicate signups.
  perform pg_advisory_xact_lock(hashtextextended('tlb-newsletter-request-rate',0));
  select * into v_row from tlb.newsletter_subscribers where email=v_email for update;
  if found then
    if v_row.operation_expires_at>clock_timestamp() then return jsonb_build_object('busy',true); end if;
    if v_row.provider_import_filename is not null then
      return public.newsletter_service('resume_import',jsonb_build_object('email',v_email));
    end if;
    if v_row.status='subscribed' then
      return jsonb_build_object('already_subscribed',true,'email',v_email,'revision',v_row.revision);
    end if;
  end if;
  v_result:=public.newsletter_service('request',p_payload);
  if v_result->'send' is distinct from 'true'::jsonb then return jsonb_build_object('rate_limited',true); end if;
  return public.newsletter_service('begin_confirm',jsonb_build_object('token_hash',p_payload->>'token_hash'));
end;
$$;
revoke all on function tlb.begin_newsletter_subscription(jsonb) from public,anon,authenticated,service_role;

-- Welcome emails use the existing durable, leased email queue. Order messages
-- must still reference an order; only a newsletter welcome can omit one.
alter table tlb.outbox alter column order_id drop not null;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='tlb.outbox'::regclass and conname='outbox_order_reference') then
    alter table tlb.outbox add constraint outbox_order_reference check (
      (event_type='newsletter_welcome' and order_id is null)
      or (event_type<>'newsletter_welcome' and order_id is not null)
    );
  end if;
end $$;

create or replace function tlb.queue_newsletter_welcome(p_email text,p_token text)
returns void language plpgsql set search_path='' as $$
declare
  v_row tlb.newsletter_subscribers;
  v_config tlb.newsletter_config;
  v_settings jsonb;
begin
  select * into v_row from tlb.newsletter_subscribers where email=p_email;
  if v_row.status is distinct from 'subscribed' or p_token is null or p_token !~ '^[0-9a-f]{64}$'
    or v_row.unsubscribe_token_hash is distinct from encode(extensions.digest(p_token,'sha256'),'hex') then
    raise exception 'Invalid welcome subscription' using errcode='22023';
  end if;
  select * into v_config from tlb.newsletter_config where singleton;
  select data into v_settings from tlb.settings where id;
  insert into tlb.outbox(event_key,event_type,to_email,subject,payload)
  values('newsletter-welcome:'||v_row.request_id::text,'newsletter_welcome',v_row.email,
    'Welcome to the TLB newsletter!',jsonb_build_object(
      'event_type','newsletter_welcome','topic_id',v_config.topic_id,
      'unsubscribe_token',p_token,'unsubscribe_token_hash',v_row.unsubscribe_token_hash,
      'settings',jsonb_build_object('site_url',v_config.site_url,'shop_name',v_settings->>'shop_name',
        'pickup_address',v_settings->>'pickup_address','contact_email',v_settings->>'contact_email',
        'contact_phone',v_settings->>'contact_phone')))
  on conflict(event_key) do nothing;
end;
$$;
revoke all on function tlb.queue_newsletter_welcome(text,text) from public,anon,authenticated,service_role;

-- Guarded edits retain the established service grants and all unrelated order
-- behavior. Normalize CRLF so this is repeatable on Windows and Linux.
do $migration$
declare
  definition text;
  patch record;
  function_name text;
  old_value text;
  new_value text;
begin
  foreach function_name in array array['newsletter_service','shop_service'] loop
    definition:=replace(pg_get_functiondef(('public.'||function_name||'(text,jsonb)')::regprocedure),E'\r\n',E'\n');
    for patch in select * from (values
      ('newsletter_service',$old$  if p_action='configuration' then$old$,
       $new$  if p_action='begin_subscribe' then
    return tlb.begin_newsletter_subscription(p_payload);
  end if;
  if p_action='configuration' then$new$),
      ('newsletter_service',$old$      return jsonb_build_object('email',v_email,'status','subscribed');$old$,
       $new$      -- Compatibility for already deployed callers during rollout.
      if p_payload ? 'unsubscribe_token' then
        perform tlb.queue_newsletter_welcome(v_email,p_payload->>'unsubscribe_token');
      end if;
      return jsonb_build_object('email',v_email,'status','subscribed');$new$),
      ('shop_service',$old$elsif p_action in ('prepare_email','email_sent','email_failed') then$old$,
       $new$elsif p_action in ('prepare_email','email_sent','email_failed','email_skipped') then$new$),
      ('shop_service',$old$   return jsonb_build_object('id',e.id,'event_key',e.event_key,'to_email',e.to_email,'subject',e.subject,'payload',e.payload,'attempts',e.attempts,'lease_token',e.lease_token,'first_attempt_at',e.first_attempt_at);$old$,
       $new$   if e.event_type='newsletter_welcome' and not exists (
    select 1 from tlb.newsletter_subscribers n where n.email=e.to_email and n.status='subscribed'
      and n.unsubscribe_token_hash=e.payload->>'unsubscribe_token_hash'
      and n.operation_kind is distinct from 'unsubscribe'
   ) then
    update tlb.outbox set status='skipped',last_error='Newsletter subscription changed before welcome delivery.',
      lease_token=null,leased_until=null where id=e.id;
    return jsonb_build_object('skip',true);
   end if;
   return jsonb_build_object('id',e.id,'event_key',e.event_key,'to_email',e.to_email,'subject',e.subject,'payload',e.payload,'attempts',e.attempts,'lease_token',e.lease_token,'first_attempt_at',e.first_attempt_at);$new$),
      ('shop_service',$old$  elsif p_action='email_sent' then$old$,
       $new$  elsif p_action='email_skipped' then
   perform tlb.require(e.event_type='newsletter_welcome','Only newsletter welcomes can be skipped by the sender.');
   update tlb.outbox set status='skipped',last_error=left(coalesce(p_payload->>'reason','Newsletter recipient opted out.'),2000),
     lease_token=null,leased_until=null where id=e.id;
   return jsonb_build_object('skipped',true);
  elsif p_action='email_sent' then$new$)
    ) as replacements(target,old_text,new_text) where target=function_name loop
      old_value:=replace(patch.old_text,E'\r\n',E'\n');
      new_value:=replace(patch.new_text,E'\r\n',E'\n');
      if length(definition)-length(replace(definition,new_value,''))=length(new_value) then continue; end if;
      if length(definition)-length(replace(definition,old_value,''))<>length(old_value) then
        raise exception 'Newsletter migration expected exactly one matching service section in %',function_name;
      end if;
      definition:=replace(definition,old_value,new_value);
    end loop;
    execute definition;
  end loop;
end;
$migration$;
