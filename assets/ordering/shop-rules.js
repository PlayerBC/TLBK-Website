// Display helpers only. PostgreSQL revalidates all customer checkout rules.
export function dateInManila(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
  return ['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-');
}
export function addDays(date,n) {const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
export function dayOfWeek(date){return new Date(`${date}T00:00:00Z`).getUTCDay()}
export function earliestLeadDate(product,settings,now = new Date()){
  const today=dateInManila(now),week=settings.production_weekdays??[0,1,2,3,4,5,6];
  const time=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);
  let count=Math.max(0,Number(product.lead_days)||0)+(settings.cutoff_time&&time>=settings.cutoff_time.slice(0,5)?1:0);
  for(let n=1;n<=730;n++){
    const date=addDays(today,n);
    if(count===0)return date;
    if(week.includes(dayOfWeek(date))&&!(settings.nonproduction_dates??[]).includes(date))count--;
  }
  return null;
}
export function availability(product,date,settings,inventory,now=new Date()){
  const earliest=earliestLeadDate(product,settings,now);
  if(!product.active)return {available:false,reason:'Currently unavailable',earliest};
  if(!date)return {available:true,reason:`${product.lead_days} full production day${product.lead_days===1?'':'s'} notice`,earliest};
  if(!earliest||date<earliest)return {available:false,reason:earliest?`Needs more preparation time. Earliest ${earliest}.`:'No production dates configured.',earliest};
  if(!(settings.fulfillment_weekdays??[0,1,2,3,4,5,6]).includes(dayOfWeek(date))||(settings.blocked_dates??[]).includes(date))return {available:false,reason:'Closed to new orders on this date',earliest};
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
