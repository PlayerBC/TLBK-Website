-- Queue staff notifications in the same transaction that accepts payment proof.
-- Recipients come only from verified accounts with an owner/staff assignment.
-- No existing orders are backfilled and no customer access tokens enter these emails.
begin;

create or replace function tlb.queue_order_review_emails(p_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare
  o tlb.orders;
  s jsonb;
  recipient record;
  summary jsonb;
begin
  select * into strict o from tlb.orders where id=p_id;
  perform tlb.require(o.payment_status='under_review' and o.fulfillment_status='pending_confirmation'
    and o.proof_path is not null,'Only a submitted payment proof can request review.');
  select jsonb_build_object('shop_name',data->'shop_name','site_url',data->'site_url')
    into s from tlb.settings where id;
  summary:=jsonb_build_object('id',o.id,'reference',o.reference,
    'buyer_name',o.data#>>'{buyer,name}','fulfillment_date',o.fulfillment_date,
    'method',o.method,'total_cents',o.data->'total_cents');
  for recipient in
    select lower(trim(a.email)) as email,jsonb_agg(a.id order by a.id) as user_ids
    from tlb.staff t join auth.users a on a.id=t.user_id
    where t.role in ('owner','staff') and a.email_confirmed_at is not null
      and nullif(trim(a.email),'') is not null
    group by lower(trim(a.email))
  loop
    insert into tlb.outbox(event_key,event_type,order_id,to_email,subject,payload)
    values('review:'||o.id||':'||o.revision||':'||md5(recipient.email),
      'order_review_required',o.id,recipient.email,'Order ready for review · '||o.reference,
      jsonb_build_object('event_type','order_review_required','order',summary,
        'settings',s,'recipient_user_ids',recipient.user_ids))
    on conflict(event_key) do nothing;
  end loop;
end $$;
revoke all on function tlb.queue_order_review_emails(uuid) from public,anon,authenticated;

-- Guard source replacements so replay is harmless and unexpected changes fail
-- atomically instead of silently omitting the notification or recipient checks.
do $migration$
declare
  definition text:=pg_get_functiondef('public.shop_service(text,jsonb)'::regprocedure);
  old_value text;
  new_value text;
  patch record;
begin
  for patch in select * from (values
    ($old$  perform tlb.audit(oid,u,'proof_submitted','Initial payment proof received before its deadline.');$old$,
     $new$  perform tlb.audit(oid,u,'proof_submitted','Initial payment proof received before its deadline.');
  perform tlb.queue_order_review_emails(oid); -- TLB_ORDER_REVIEW_EMAIL_V1$new$),
    ($old$  if p_action='prepare_email' then
   if e.event_type='fulfillment_reminder' then$old$,
     $new$  if p_action='prepare_email' then
   if e.event_type='order_review_required' then
    -- Recheck access before sending: removing a team member or changing their
    -- verified address must not disclose an order to the old recipient.
    select exists(select 1 from tlb.staff t join auth.users a on a.id=t.user_id
      where t.role in ('owner','staff') and a.email_confirmed_at is not null
        and (e.payload->'recipient_user_ids') ? a.id::text
        and lower(trim(a.email))=e.to_email) into good;
    if not good then
      update tlb.outbox set status='skipped',last_error='Recipient no longer has verified staff or owner access.',
        lease_token=null,leased_until=null where id=e.id;
      return jsonb_build_object('skip',true);
    end if;
    select * into o from tlb.orders where id=e.order_id;
    if o.payment_status<>'under_review' or o.fulfillment_status<>'pending_confirmation' then
      update tlb.outbox set status='skipped',last_error='Order no longer needs payment review.',
        lease_token=null,leased_until=null where id=e.id;
      return jsonb_build_object('skip',true);
    end if;
   end if;
   if e.event_type='fulfillment_reminder' then$new$)
  ) as replacements(old_text,new_text)
  loop
    old_value:=patch.old_text; new_value:=patch.new_text;
    if position(E'\r\n' in definition)>0 then
      old_value:=replace(old_value,chr(10),chr(13)||chr(10));
      new_value:=replace(new_value,chr(10),chr(13)||chr(10));
    end if;
    if length(definition)-length(replace(definition,new_value,''))=length(new_value) then
      continue;
    end if;
    if length(definition)-length(replace(definition,old_value,''))<>length(old_value) then
      raise exception 'Unexpected shop_service definition; review before applying staff review emails.';
    end if;
    definition:=replace(definition,old_value,new_value);
  end loop;
  execute definition;
end $migration$;

commit;
