-- Include saved product lines and payment totals in future review notifications.
-- Existing outbox payloads stay unchanged so provider retries retain their body.
create or replace function tlb.queue_order_review_emails(p_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare
  o tlb.orders;
  s jsonb;
  recipient record;
  summary jsonb;
  items jsonb;
begin
  select * into strict o from tlb.orders where id=p_id;
  perform tlb.require(o.payment_status='under_review' and o.fulfillment_status='pending_confirmation'
    and o.proof_path is not null,'Only a submitted payment proof can request review.');
  select jsonb_build_object('shop_name',data->'shop_name','site_url',data->'site_url')
    into s from tlb.settings where id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'name',line->'name','quantity',line->'quantity',
    'selection_labels',coalesce(line->'selection_labels','[]'::jsonb),
    'unit_price_cents',line->'unit_price_cents','line_total_cents',line->'line_total_cents'
  ) order by position),'[]'::jsonb) into items
  from jsonb_array_elements(coalesce(o.data->'items','[]'::jsonb)) with ordinality as saved(line,position);
  summary:=jsonb_build_object('id',o.id,'reference',o.reference,
    'buyer_name',o.data#>>'{buyer,name}','fulfillment_date',o.fulfillment_date,
    'method',o.method,'items',items,'subtotal_cents',o.data->'subtotal_cents',
    'discount_cents',o.data->'discount_cents','delivery_cents',o.data->'delivery_cents',
    'total_cents',o.data->'total_cents','promo_code',o.data#>>'{promo_snapshot,code}');
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
