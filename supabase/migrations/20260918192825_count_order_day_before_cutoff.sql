-- A configured cutoff allows the order day to count when production is open.
-- Keep the established next-day start when no cutoff is configured, and keep
-- fulfillment after the last production day. Same-day opt-in is handled by
-- calculate_quote; zero lead days alone still cannot enable same-day orders.
create or replace function tlb.earliest_lead_date(p_submitted timestamptz,p_days integer,p_settings jsonb)
returns date language plpgsql immutable set search_path='' as $$
declare
  local_submitted timestamp := p_submitted at time zone 'Asia/Manila';
  d date := local_submitted::date + 1;
  needed integer := p_days;
  counted integer := 0;
  i integer;
begin
  if needed=0 then return d; end if;
  if nullif(p_settings->>'cutoff_time','') is not null
     and local_submitted::time < (p_settings->>'cutoff_time')::time then
    d := local_submitted::date;
  end if;
  for i in 1..3660 loop
    if tlb.is_production(d,p_settings) then counted:=counted+1; end if;
    d:=d+1;
    if counted>=needed then return d; end if;
  end loop;
  raise exception 'No usable production schedule is configured.';
end $$;
