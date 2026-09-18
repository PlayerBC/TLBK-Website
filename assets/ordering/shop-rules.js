// Display helpers only. PostgreSQL revalidates all customer checkout rules.
export function dateInManila(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
  return ['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-');
}
export function addDays(date,n) {const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
export function dayOfWeek(date){return new Date(`${date}T00:00:00Z`).getUTCDay()}
export function allowsSameDay(product){return product?.allow_same_day===true&&Number(product.lead_days)===0}
export function sameDayOpen(settings,now=new Date()){
  if(!settings.cutoff_time)return true;
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(now).split(':').map(Number);
  const cutoff=String(settings.cutoff_time).split(':').map(Number);
  return parts[0]*3600+parts[1]*60+parts[2]+now.getMilliseconds()/1000 < cutoff[0]*3600+cutoff[1]*60+(cutoff[2]||0);
}
// Same-day eligibility is opt-in; the final month is shared by all customers.
// Manila's calendar date controls both boundaries, regardless of device timezone.
export function customerBookingWindow(now=new Date(),allowSameDay=false){
  const today=dateInManila(now),end=new Date(`${today.slice(0,7)}-01T12:00:00Z`);
  end.setUTCMonth(end.getUTCMonth()+3,0);
  const maxDate=end.toISOString().slice(0,10);
  return {today,minDate:allowSameDay?today:addDays(today,1),maxDate,minMonth:today.slice(0,7),maxMonth:maxDate.slice(0,7)};
}
export function customerDateIssue(date,settings={},method='pickup',now=new Date(),allowSameDay=false){
  if(!date)return '';
  const parsed=new Date(`${date}T12:00:00Z`);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)return 'Choose a valid fulfillment date.';
  const window=customerBookingWindow(now,allowSameDay&&sameDayOpen(settings,now));
  if(date<window.today)return 'Choose an available date; past-date bookings are unavailable.';
  if(date<window.minDate)return allowSameDay?'The same-day order cutoff has passed. Choose tomorrow or a later date.':'Same-day orders require eligible ready-stock products. Choose tomorrow or a later date.';
  if(date>window.maxDate)return `Bookings are open through ${window.maxDate}. Choose a date in the current month or the next two months.`;
  return fulfillmentIssue(method,date,settings);
}
export function earliestLeadDate(product,settings,now = new Date()){
  const today=dateInManila(now),week=settings.production_weekdays??[0,1,2,3,4,5,6];
  if(allowsSameDay(product))return sameDayOpen(settings,now)?today:addDays(today,1);
  let count=Math.max(0,Number(product.lead_days)||0);
  if(count===0)return addDays(today,1);
  // A configured cutoff lets an eligible order day count before that time.
  // With no cutoff, retain the next-day production start. Fulfillment is later.
  const start=settings.cutoff_time&&sameDayOpen(settings,now)?0:1;
  for(let n=start;n<start+3660;n++){
    const date=addDays(today,n);
    if(week.includes(dayOfWeek(date))&&!(settings.nonproduction_dates??[]).includes(date))count--;
    if(count===0)return addDays(date,1);
  }
  return null;
}
export function fulfillmentIssue(method,date,settings){
  if(!date)return '';
  if(!(settings.fulfillment_weekdays??[0,1,2,3,4,5,6]).includes(dayOfWeek(date))||(settings.blocked_dates??[]).includes(date))return 'Closed to new orders on this date. Choose another date.';
  if((settings[`${method}_blocked_dates`]??[]).includes(date))return `${method==='delivery'?'Delivery':'Pickup'} is unavailable on this date. Choose another date or fulfillment method.`;
  return '';
}
export function deliveryRestriction(items,products,date,settings){
  const names=[...new Set(items.map(line=>products.find(p=>p.id===line.product_id)).filter(p=>p?.pickup_only===true).map(p=>p.name))];
  if(names.length)return `Pickup only: ${names.join(', ')}. Choose pickup for this basket, or remove these products to use delivery.`;
  return fulfillmentIssue('delivery',date,settings);
}
export function deliveryZone(zones,locality,method){
  return method==='delivery'?zones.find(z=>z.active&&z.localities?.includes(locality)):undefined;
}
export function sameDayBasketEligible(items,products,inventory,method='pickup',now=new Date()){
  const eligible=p=>p?.active&&allowsSameDay(p)&&!(method==='delivery'&&p.pickup_only===true);
  if(items.length)return items.every(line=>eligible(products.find(p=>p.id===line.product_id)));
  // With an empty basket, let customers browse today's stocked same-day menu.
  const today=dateInManila(now);
  return products.some(p=>eligible(p)&&inventory.some(row=>row.product_id===p.id&&row.date===today&&row.available&&Number(row.remaining??(row.capacity-Number(row.reserved||0)))>=Number(p.min_quantity||1)));
}
export function availability(product,date,settings,inventory,now=new Date(),method='pickup'){
  const earliest=earliestLeadDate(product,settings,now);
  if(!product.active)return {available:false,reason:'Currently unavailable',earliest};
  if(method==='delivery'&&product.pickup_only===true)return {available:false,reason:'Pickup only. Choose pickup to order this product.',earliest};
  if(!date)return {available:true,reason:allowsSameDay(product)?sameDayOpen(settings,now)?'Same-day orders available before the order cutoff':'Same-day cutoff passed; available from tomorrow':`${product.lead_days} full production day${product.lead_days===1?'':'s'} notice`,earliest};
  const dateIssue=customerDateIssue(date,settings,method,now,allowsSameDay(product));
  if(dateIssue)return {available:false,reason:dateIssue,earliest};
  if(!earliest||date<earliest)return {available:false,reason:earliest?`Needs more preparation time. Earliest ${earliest}.`:'No production dates configured.',earliest};
  const row=inventory.find(r=>r.product_id===product.id&&r.date===date);
  const remaining=row?Number(row.remaining??(row.capacity-Number(row.reserved||0))):0;
  if(!row||!row.available)return {available:false,reason:'Not available on this date',earliest};
  return {available:remaining>=Number(product.min_quantity||1),remaining,reason:remaining>0?`${remaining} available on this date`:'Sold out for this date',earliest};
}
export function selectionPrice(product,selections){
  let price=Number(product.price_cents);
  for(const group of product.option_groups||[]){
    const selected=selections[group.id]||{};
    if(Object.values(selected).reduce((a,b)=>a+Number(b),0)!==group.required_count)throw new Error(`Choose exactly ${group.required_count} for ${group.label}.`);
    for(const [id,count] of Object.entries(selected)){
      if(!Number.isInteger(Number(count))||Number(count)<0)throw new Error('Please use whole quantities.');
      const choice=group.choices.find(c=>c.id===id&&c.active!==false);
      if(!choice&&Number(count)>0)throw new Error('A selected option is unavailable. Please update your selection.');
      if(choice)price+=choice.surcharge_cents*Number(count);
    }
  }
  return price;
}
export function selectionLabels(product,selections){return (product.option_groups||[]).flatMap(group=>group.choices.filter(c=>Number(selections[group.id]?.[c.id])>0).map(c=>`${selections[group.id][c.id]} × ${c.label}${c.surcharge_cents ? ` (+PHP ${(c.surcharge_cents/100).toFixed(2)} each; PHP ${(c.surcharge_cents*selections[group.id][c.id]/100).toFixed(2)} per unit)` : ''}`))}
