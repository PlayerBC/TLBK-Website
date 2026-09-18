-- Cancellation closes an unapproved payment without claiming it was rejected,
-- approved, or refunded. Keep approved payments and their audit records intact.
alter table tlb.orders drop constraint orders_payment_status_check;
alter table tlb.orders add constraint orders_payment_status_check
  check (payment_status in ('awaiting_payment','under_review','paid','rejected','cancelled'));

do $migration$
declare
  definition text := pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure);
  old_value text := $old$update tlb.orders set fulfillment_status='cancelled',revision=revision+1 where id=oid;$old$;
  new_value text := $new$update tlb.orders set payment_status=case when payment_status in ('awaiting_payment','under_review') then 'cancelled' else payment_status end,fulfillment_status='cancelled',revision=revision+1 where id=oid;$new$;
begin
  if strpos(definition,new_value)>0 then return; end if;
  if (length(definition)-length(replace(definition,old_value,'')))/length(old_value)<>1 then
    raise exception 'Expected exactly one order cancellation update in public.shop_api';
  end if;
  execute replace(definition,old_value,new_value);
end
$migration$;

-- Repair only already-cancelled, unapproved payments. No stock, promo, refund,
-- receipt, or outbox changes; stale staff forms must refresh after this repair.
do $repair$
declare
  o tlb.orders;
  before_order jsonb;
begin
  for o in select * from tlb.orders
    where fulfillment_status='cancelled'
      and payment_status in ('awaiting_payment','under_review')
    for update
  loop
    before_order := tlb.order_json(o.id,true,false)-'history';
    update tlb.orders set payment_status='cancelled',revision=revision+1 where id=o.id;
    perform tlb.audit(o.id,null,'payment_review_closed',
      'Closed the pending payment status because this order was already cancelled. No payment or refund was processed.',
      before_order,tlb.order_json(o.id,true,false)-'history');
  end loop;
end
$repair$;
