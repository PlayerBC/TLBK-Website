-- A provider import may continue after an Edge request ends. Keep its identity
-- durable and serialize preference changes until that exact job is terminal.
alter table tlb.newsletter_subscribers
  add column if not exists provider_import_id uuid,
  add column if not exists provider_import_filename text,
  add column if not exists provider_import_started_at timestamptz;
do $migration$
begin
  if not exists(select 1 from pg_constraint where conrelid='tlb.newsletter_subscribers'::regclass and conname='newsletter_import_consistent') then
    alter table tlb.newsletter_subscribers add constraint newsletter_import_consistent check (
      (provider_import_filename is null and provider_import_id is null and provider_import_started_at is null)
      or (provider_import_filename is not null and provider_import_started_at is not null and operation_id is not null
        and provider_import_filename='tlb-newsletter-'||operation_id::text||'.csv')
    );
  end if;
end;
$migration$;

create or replace function public.newsletter_service(p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_email text;
  v_user uuid;
  v_token text := p_payload->>'token_hash';
  v_ip text := p_payload->>'ip_hash';
  v_now timestamptz := clock_timestamp();
  v_row tlb.newsletter_subscribers;
  v_config tlb.newsletter_config;
  v_id uuid;
  v_count integer;
  v_seen boolean;
  v_source text;
begin
  if p_action='configuration' then
    select * into v_config from tlb.newsletter_config where singleton;
    return jsonb_build_object('topic_id',v_config.topic_id,'segment_id',v_config.segment_id,
      'site_url',v_config.site_url,'consent_version',v_config.consent_version);
  end if;

  if p_action in ('status','popup_claim','popup_seen') or (p_action='begin_unsubscribe' and p_payload ? 'user_id') then
    v_user := nullif(p_payload->>'user_id','')::uuid;
    select lower(btrim(email)) into v_email from auth.users
      where id=v_user and email_confirmed_at is not null and email is not null;
    if v_email is null then raise exception 'Verified account required' using errcode='22023'; end if;
  end if;

  if p_action='resume_import' then
    v_email := lower(btrim(p_payload->>'email'));
    select * into v_row from tlb.newsletter_subscribers where email=v_email for update;
    if not found or v_row.provider_import_filename is null then return jsonb_build_object('none',true); end if;
    if v_row.operation_expires_at>v_now then return jsonb_build_object('busy',true); end if;
    if v_row.provider_import_filename is not null then
      -- A provider import outlives a request lease. Resume its original operation
      -- rather than issuing a conflicting job or invalidating the original token.
      update tlb.newsletter_subscribers set operation_expires_at=v_now+interval '90 seconds',
        revision=revision+1,updated_at=v_now where email=v_row.email;
      return jsonb_build_object('resume_import',true,'email',v_row.email,
        'operation_id',v_row.operation_id,'operation_kind',v_row.operation_kind,
        'provider_import_id',v_row.provider_import_id,'provider_import_filename',v_row.provider_import_filename,
        'provider_import_started_at',v_row.provider_import_started_at,
        'request_id',v_row.request_id,'contact_id',v_row.provider_contact_id);
    end if;
  elsif p_action='status' then
    select * into v_row from tlb.newsletter_subscribers where email=v_email;
    return jsonb_build_object('email',v_email,'status',case
      when v_row.status='subscribed' then 'subscribed'
      when v_row.confirmation_token_hash is not null and v_row.confirmation_expires_at>v_now then 'pending'
      when v_row.status='pending' then 'none'
      else coalesce(v_row.status,'none') end,
      'popup_seen',exists(select 1 from tlb.newsletter_popup_seen where user_id=v_user),
      'contact_id',v_row.provider_contact_id,'revision',coalesce(v_row.revision,0),
      'provider_import_pending',v_row.provider_import_filename is not null);
  elsif p_action in ('popup_claim','popup_seen') then
    -- The PK arbitrates simultaneous visits from different devices.
    insert into tlb.newsletter_popup_seen(user_id) values(v_user) on conflict do nothing;
    get diagnostics v_count=row_count;
    v_seen := exists(select 1 from tlb.newsletter_subscribers where email=v_email and
      (status='subscribed' or (confirmation_token_hash is not null and confirmation_expires_at>v_now)));
    return jsonb_build_object('show',p_action='popup_claim' and v_count=1 and not v_seen,'popup_seen',true);
  elsif p_action='request' then
    v_email := lower(btrim(p_payload->>'email'));
    v_source := coalesce(nullif(p_payload->>'source',''),'website');
    if v_email is null or length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      then raise exception 'Valid email required' using errcode='22023'; end if;
    if v_token is null or v_token !~ '^[0-9a-f]{64}$'
      then raise exception 'Invalid confirmation token hash' using errcode='22023'; end if;
    if v_ip is null or v_ip !~ '^[0-9a-f]{64}$'
      then raise exception 'Invalid IP hash' using errcode='22023'; end if;
    if v_source !~ '^[a-z0-9_-]{1,40}$'
      then raise exception 'Invalid consent source' using errcode='22023'; end if;
    -- Serialize this short rate decision, never a network call. Count accepted
    -- requests in a rolling window so an hour boundary cannot double the limit.
    perform pg_advisory_xact_lock(hashtextextended('tlb-newsletter-request-rate',0));
    v_now := clock_timestamp();
    if (select count(*) from tlb.newsletter_events where event='requested' and occurred_at>v_now-interval '1 hour')>=100
      or (select count(*) from tlb.newsletter_events where event='requested' and ip_hash=v_ip and occurred_at>v_now-interval '1 hour')>=20
      or (select count(*) from tlb.newsletter_events where event='requested' and email=v_email and occurred_at>v_now-interval '1 hour')>=3
      or exists(select 1 from tlb.newsletter_events where event='requested' and email=v_email and occurred_at>v_now-interval '1 minute')
      then return jsonb_build_object('send',false); end if;
    insert into tlb.newsletter_subscribers(email) values(v_email) on conflict do nothing;
    select * into v_row from tlb.newsletter_subscribers where email=v_email for update;
    if v_row.operation_expires_at>v_now or v_row.provider_import_filename is not null
      then return jsonb_build_object('send',false); end if;
    select * into v_config from tlb.newsletter_config where singleton;
    v_id := gen_random_uuid();
    update tlb.newsletter_subscribers set request_id=v_id,confirmation_token_hash=v_token,
      confirmation_expires_at=v_now+interval '24 hours',source=v_source,consent_version=v_config.consent_version,
      requested_at=v_now,operation_id=null,operation_kind=null,operation_expires_at=null,
      revision=revision+1,updated_at=v_now where email=v_email;
    insert into tlb.newsletter_events(email,event,request_id,source,consent_version,ip_hash,occurred_at)
      values(v_email,'requested',v_id,v_source,v_config.consent_version,v_ip,v_now);
    return jsonb_build_object('send',true,'email',v_email,'request_id',v_id);
  elsif p_action='begin_confirm' then
    if v_token is null or v_token !~ '^[0-9a-f]{64}$' then return jsonb_build_object('valid',false); end if;
    select * into v_row from tlb.newsletter_subscribers
      where confirmation_token_hash=v_token or confirmed_token_hash=v_token for update;
    if not found then return jsonb_build_object('valid',false); end if;
    if v_row.operation_expires_at>v_now then return jsonb_build_object('busy',true); end if;
    if v_row.provider_import_filename is not null then
      -- A provider import outlives a request lease. Resume its original operation
      -- rather than issuing a conflicting job or invalidating the original token.
      update tlb.newsletter_subscribers set operation_expires_at=v_now+interval '90 seconds',
        revision=revision+1,updated_at=v_now where email=v_row.email;
      return jsonb_build_object('resume_import',true,'email',v_row.email,
        'operation_id',v_row.operation_id,'operation_kind',v_row.operation_kind,
        'provider_import_id',v_row.provider_import_id,'provider_import_filename',v_row.provider_import_filename,
        'provider_import_started_at',v_row.provider_import_started_at,
        'request_id',v_row.request_id,'contact_id',v_row.provider_contact_id);
    end if;
    if v_row.status='subscribed' and v_row.confirmed_token_hash=v_token
      then return jsonb_build_object('valid',true,'already_subscribed',true,'email',v_row.email); end if;
    if v_row.confirmation_token_hash is distinct from v_token or v_row.confirmation_expires_at is null
      or v_row.confirmation_expires_at<=v_now then return jsonb_build_object('valid',false); end if;
    v_id := gen_random_uuid();
    update tlb.newsletter_subscribers set operation_id=v_id,operation_kind='confirm',
      operation_expires_at=v_now+interval '90 seconds',revision=revision+1,updated_at=v_now where email=v_row.email;
    return jsonb_build_object('valid',true,'email',v_row.email,'operation_id',v_id,
      'request_id',v_row.request_id,'contact_id',v_row.provider_contact_id);
  elsif p_action='begin_unsubscribe' then
    if v_email is null then
      if v_token is null or v_token !~ '^[0-9a-f]{64}$' then return jsonb_build_object('valid',false); end if;
      select * into v_row from tlb.newsletter_subscribers where unsubscribe_token_hash=v_token for update;
      if not found then return jsonb_build_object('valid',false); end if;
    else
      select * into v_row from tlb.newsletter_subscribers where email=v_email for update;
      if not found then return jsonb_build_object('done',true,'status','unsubscribed'); end if;
    end if;
    if v_row.operation_expires_at>v_now then return jsonb_build_object('busy',true); end if;
    if v_row.provider_import_filename is not null then
      -- A provider import outlives a request lease. Resume its original operation
      -- rather than issuing a conflicting job or invalidating the original token.
      update tlb.newsletter_subscribers set operation_expires_at=v_now+interval '90 seconds',
        revision=revision+1,updated_at=v_now where email=v_row.email;
      return jsonb_build_object('resume_import',true,'email',v_row.email,
        'operation_id',v_row.operation_id,'operation_kind',v_row.operation_kind,
        'provider_import_id',v_row.provider_import_id,'provider_import_filename',v_row.provider_import_filename,
        'provider_import_started_at',v_row.provider_import_started_at,
        'request_id',v_row.request_id,'contact_id',v_row.provider_contact_id);
    end if;
    -- Always reconcile existing records with the provider, even when locally
    -- unsubscribed: a previous provider opt-in may have outlived a DB failure.
    v_id := gen_random_uuid();
    update tlb.newsletter_subscribers set operation_id=v_id,operation_kind='unsubscribe',
      operation_expires_at=v_now+interval '90 seconds',confirmation_token_hash=null,
      confirmation_expires_at=null,confirmed_token_hash=null,revision=revision+1,updated_at=v_now where email=v_row.email;
    return jsonb_build_object('email',v_row.email,'operation_id',v_id,'contact_id',v_row.provider_contact_id);
  elsif p_action in ('finish_confirm','finish_unsubscribe','cancel_operation','reconcile','mark_import_start','mark_import_id') then
    v_email := lower(btrim(p_payload->>'email'));
    select * into v_row from tlb.newsletter_subscribers where email=v_email for update;
    if p_action='reconcile' then
      -- A provider opt-out is authoritative, but an old status read must never
      -- overwrite a more recent operation or create opt-in without confirmation.
      if not found or p_payload->>'status' is distinct from 'unsubscribed'
        or v_row.status<>'subscribed' or v_row.revision is distinct from (p_payload->>'revision')::bigint
        or v_row.operation_expires_at>v_now or v_row.provider_import_filename is not null
        then return jsonb_build_object('updated',false); end if;
      update tlb.newsletter_subscribers set status='unsubscribed',unsubscribed_at=v_now,
        confirmation_token_hash=null,confirmation_expires_at=null,confirmed_token_hash=null,
        operation_id=null,operation_kind=null,operation_expires_at=null,revision=revision+1,updated_at=v_now where email=v_email;
      insert into tlb.newsletter_events(email,event,request_id,source,consent_version)
        values(v_email,'provider_unsubscribed',v_row.request_id,'provider',v_row.consent_version);
      return jsonb_build_object('updated',true);
    end if;
    v_id := nullif(p_payload->>'operation_id','')::uuid;
    if p_action in ('mark_import_start','mark_import_id') then
      if not found or v_id is null or v_row.operation_id is distinct from v_id
        or v_row.operation_expires_at<=v_now then
        raise exception 'Newsletter operation expired or replaced' using errcode='22023';
      end if;
      if p_action='mark_import_start' then
        if nullif(p_payload->>'contact_id','')::uuid is null then
          raise exception 'Provider contact ID required' using errcode='22023';
        end if;
        if v_row.provider_import_filename is not null then
          if v_row.provider_contact_id is distinct from p_payload->>'contact_id' then
            raise exception 'Provider import contact changed' using errcode='22023';
          end if;
          return jsonb_build_object('started',false,'email',v_row.email,
            'operation_id',v_row.operation_id,'operation_kind',v_row.operation_kind,
            'provider_import_filename',v_row.provider_import_filename,'provider_import_id',v_row.provider_import_id,
            'provider_import_started_at',v_row.provider_import_started_at,'contact_id',v_row.provider_contact_id);
        end if;
        update tlb.newsletter_subscribers set
          provider_import_filename='tlb-newsletter-'||v_id::text||'.csv',provider_import_started_at=v_now,
          provider_contact_id=p_payload->>'contact_id',revision=revision+1,updated_at=v_now
          where email=v_email returning * into v_row;
        return jsonb_build_object('started',true,'email',v_row.email,
          'operation_id',v_row.operation_id,'operation_kind',v_row.operation_kind,
          'provider_import_filename',v_row.provider_import_filename,'provider_import_id',v_row.provider_import_id,
          'provider_import_started_at',v_row.provider_import_started_at,'contact_id',v_row.provider_contact_id);
      end if;
      if v_row.provider_import_filename is null or v_row.provider_import_filename is distinct from p_payload->>'provider_import_filename'
        or nullif(p_payload->>'provider_import_id','')::uuid is null then
        raise exception 'Provider import identity does not match' using errcode='22023';
      end if;
      if v_row.provider_import_id is not null and v_row.provider_import_id is distinct from (p_payload->>'provider_import_id')::uuid then
        raise exception 'Provider import ID cannot be replaced' using errcode='22023';
      end if;
      update tlb.newsletter_subscribers set provider_import_id=(p_payload->>'provider_import_id')::uuid,
        revision=revision+1,updated_at=v_now where email=v_email;
      return jsonb_build_object('recorded',true);
    end if;
    if p_action='cancel_operation' then
      if not found or v_id is null or v_row.operation_id is distinct from v_id
        or (v_row.provider_import_filename is not null and p_payload->'import_terminal' is distinct from 'true'::jsonb)
        then return jsonb_build_object('cancelled',false); end if;
      update tlb.newsletter_subscribers set operation_id=null,operation_kind=null,operation_expires_at=null,
        provider_import_id=null,provider_import_filename=null,provider_import_started_at=null,
        revision=revision+1,updated_at=v_now where email=v_email;
      return jsonb_build_object('cancelled',true);
    end if;
    if not found or v_id is null or v_row.operation_id is distinct from v_id or v_row.operation_expires_at<=v_now
      or v_row.operation_kind is distinct from (case when p_action='finish_confirm' then 'confirm' else 'unsubscribe' end)
      then raise exception 'Newsletter operation expired or replaced' using errcode='22023'; end if;
    if v_row.provider_import_filename is not null and p_payload->'import_terminal' is distinct from 'true'::jsonb then
      raise exception 'Provider import must be terminal before completing this operation' using errcode='22023';
    end if;
    if p_action='finish_confirm' then
      if coalesce(p_payload->>'unsubscribe_token_hash','') !~ '^[0-9a-f]{64}$'
        then raise exception 'Invalid unsubscribe token hash' using errcode='22023'; end if;
      update tlb.newsletter_subscribers set status='subscribed',confirmed_at=v_now,unsubscribed_at=null,
        confirmed_token_hash=confirmation_token_hash,confirmation_token_hash=null,confirmation_expires_at=null,
        unsubscribe_token_hash=p_payload->>'unsubscribe_token_hash',provider_contact_id=p_payload->>'contact_id',
        provider_import_id=null,provider_import_filename=null,provider_import_started_at=null,
        operation_id=null,operation_kind=null,operation_expires_at=null,revision=revision+1,updated_at=v_now where email=v_email;
      insert into tlb.newsletter_events(email,event,request_id,source,consent_version)
        values(v_email,'confirmed',v_row.request_id,v_row.source,v_row.consent_version);
      return jsonb_build_object('email',v_email,'status','subscribed');
    else
      update tlb.newsletter_subscribers set status='unsubscribed',unsubscribed_at=v_now,
        confirmation_token_hash=null,confirmation_expires_at=null,confirmed_token_hash=null,
        provider_import_id=null,provider_import_filename=null,provider_import_started_at=null,
        operation_id=null,operation_kind=null,operation_expires_at=null,revision=revision+1,updated_at=v_now where email=v_email;
      insert into tlb.newsletter_events(email,event,request_id,source,consent_version)
        values(v_email,'unsubscribed',v_row.request_id,'preferences',v_row.consent_version);
      return jsonb_build_object('email',v_email,'status','unsubscribed');
    end if;
  end if;
  raise exception 'Unknown newsletter action' using errcode='22023';
end;
$$;

revoke all on function public.newsletter_service(text,jsonb) from public,anon,authenticated;
grant execute on function public.newsletter_service(text,jsonb) to service_role;
