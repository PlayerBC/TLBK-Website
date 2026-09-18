import test from 'node:test';
import assert from 'node:assert/strict';
import {leadTimeCases} from './lead-time-cases.mjs';
import {dateInManila,earliestLeadDate,availability,selectionPrice,fulfillmentIssue,deliveryRestriction,deliveryZone,allowsSameDay,sameDayOpen,sameDayBasketEligible} from '../assets/ordering/shop-rules.js';
const settings={production_weekdays:[0,1,2,3,4,5,6],nonproduction_dates:[],fulfillment_weekdays:[0,1,2,3,4,5,6],blocked_dates:[]};
const monday=new Date('2026-09-14T02:00:00Z');
const product={id:'cookie',price_cents:60000,min_quantity:1,lead_days:1,active:true,option_groups:[{id:'mix',label:'Six cookies',required_count:6,choices:[{id:'classic',label:'Classic',surcharge_cents:0},{id:'matcha',label:'Matcha',surcharge_cents:3000}]}]};
test('Monday placement and a full Tuesday production day means Wednesday',()=>assert.equal(earliestLeadDate(product,settings,monday),'2026-09-16'));
test('nonproduction date is skipped; fulfillment closure alone does not remove production day',()=>{assert.equal(earliestLeadDate(product,{...settings,nonproduction_dates:['2026-09-15']},monday),'2026-09-17');assert.equal(earliestLeadDate(product,{...settings,blocked_dates:['2026-09-15']},monday),'2026-09-16')});
test('configured cutoff counts today only before the boundary',()=>{assert.equal(earliestLeadDate(product,{...settings,cutoff_time:'10:00'},monday),'2026-09-16');assert.equal(earliestLeadDate(product,{...settings,cutoff_time:'10:01'},monday),'2026-09-15')});
for(const scenario of leadTimeCases)test(scenario.name,()=>assert.equal(earliestLeadDate({...product,lead_days:scenario.days},{...settings,cutoff_time:'12:00',...scenario.settings},new Date(scenario.at)),scenario.expected));
test('earlier lead date still requires fulfillment availability and dated stock',()=>{
  const cake={...product,lead_days:2},schedule={...settings,cutoff_time:'12:00'},now=new Date('2026-09-19T09:00:00+08:00');
  const stock=[{product_id:product.id,date:'2026-09-21',capacity:5,available:true}];
  assert.equal(availability(cake,'2026-09-20',schedule,stock,now).available,false);
  assert.equal(availability(cake,'2026-09-21',schedule,stock,now).available,true);
  assert.equal(availability(cake,'2026-09-21',schedule,[],now).available,false);
  assert.equal(availability(cake,'2026-09-21',{...schedule,pickup_blocked_dates:['2026-09-21']},stock,now).available,false);
});
test('Manila calendar rollover does not use the server local timezone',()=>assert.equal(dateInManila('2026-09-14T16:00:00Z'),'2026-09-15'));
test('four classic and two Matcha add PHP60 to one box, selection count is exact',()=>{assert.equal(selectionPrice(product,{mix:{classic:4,matcha:2}}),66000);assert.throws(()=>selectionPrice(product,{mix:{classic:4,matcha:1}}),/exactly 6/);assert.throws(()=>selectionPrice(product,{mix:{classic:3.5,matcha:2.5}}),/whole/)});
test('missing date capacity is unavailable and soldout day does not affect another day',()=>{const inventory=[{product_id:'cookie',date:'2026-09-16',capacity:10,reserved:10,available:true},{product_id:'cookie',date:'2026-09-17',capacity:10,reserved:3,available:true}];assert.equal(availability(product,'2026-09-16',settings,inventory,monday).available,false);assert.equal(availability(product,'2026-09-17',settings,inventory,monday).remaining,7);assert.equal(availability(product,'2026-09-18',settings,inventory,monday).available,false)});
test('delivery closure leaves pickup and adjacent dates available without changing production lead time',()=>{
  const closed={...settings,delivery_blocked_dates:['2026-09-16']};
  const stock=[{product_id:'cookie',date:'2026-09-16',capacity:10,available:true}];
  assert.match(availability(product,'2026-09-16',closed,stock,monday,'delivery').reason,/Delivery is unavailable/);
  assert.equal(availability(product,'2026-09-16',closed,stock,monday,'pickup').available,true);
  assert.equal(fulfillmentIssue('delivery','2026-09-17',closed),'');
  assert.equal(earliestLeadDate(product,closed,monday),'2026-09-16');
});
test('global booking closures affect both methods while nonproduction days alone do not close fulfillment',()=>{
  for(const method of ['pickup','delivery']){
    assert.match(fulfillmentIssue(method,'2026-09-16',{...settings,blocked_dates:['2026-09-16']}),/Closed/);
    assert.equal(fulfillmentIssue(method,'2026-09-16',{...settings,nonproduction_dates:['2026-09-16']}),'');
  }
  assert.match(fulfillmentIssue('pickup','2026-09-16',{...settings,pickup_blocked_dates:['2026-09-16']}),/Pickup is unavailable/);
});
test('pickup-only products block delivery even before selecting a date and mixed baskets name affected products',()=>{
  const cake={...product,id:'cake',name:'Fragile cake',pickup_only:true};
  assert.equal(availability(cake,'',settings,[],monday,'delivery').available,false);
  assert.equal(availability(cake,'',settings,[],monday,'pickup').available,true);
  assert.equal(availability(product,'',settings,[],monday,'delivery').available,true);
  const items=[{product_id:'cookie'},{product_id:'cake'},{product_id:'cake'}];
  assert.equal(deliveryRestriction(items,[product,cake],'',settings),'Pickup only: Fragile cake. Choose pickup for this basket, or remove these products to use delivery.');
  assert.equal(deliveryRestriction(items.filter(i=>i.product_id!=='cake'),[product,cake],'',settings),'');
});
test('delivery zone selection excludes inactive and unsupported areas, preserves multiline notes, and clears for pickup',()=>{
  const zones=[{active:false,localities:['City'],fee_cents:1,description:'Old'},{active:true,localities:['City'],fee_cents:35000,description:'One motorcycle.\nWe will contact you if more space is needed.'}];
  const selected=deliveryZone(zones,'City','delivery');
  assert.equal(selected.fee_cents,35000);
  assert.equal(selected.description,zones[1].description);
  assert.equal(deliveryZone(zones,'Outside','delivery'),undefined);
  assert.equal(deliveryZone(zones,'City','pickup'),undefined);
});
test('dated stock cannot make past or out-of-window customer selections available',()=>{
  const dates=['2026-09-13','2026-09-14','2026-11-30','2026-12-01'];
  const inventory=dates.map(date=>({product_id:product.id,date,capacity:10,available:true}));
  for(const method of ['pickup','delivery']){
    assert.equal(availability(product,'2026-11-30',settings,inventory,monday,method).available,true);
    for(const date of ['2026-09-13','2026-09-14','2026-12-01'])assert.equal(availability(product,date,settings,inventory,monday,method).available,false);
  }
});
test('same-day opt-in requires zero production days and uses the shared order cutoff',()=>{
  const nori={...product,name:'Nori',lead_days:0,allow_same_day:true};
  const cutoff={...settings,cutoff_time:'12:00'};
  const before=new Date('2026-09-14T03:59:59.999Z'),at=new Date('2026-09-14T04:00:00Z');
  assert.equal(allowsSameDay(nori),true);
  assert.equal(allowsSameDay({...nori,lead_days:1}),false);
  assert.equal(allowsSameDay({...nori,allow_same_day:'true'}),false);
  assert.equal(sameDayOpen(cutoff,before),true);
  assert.equal(sameDayOpen(cutoff,at),false);
  assert.equal(earliestLeadDate(nori,cutoff,before),'2026-09-14');
  assert.equal(earliestLeadDate(nori,cutoff,at),'2026-09-15');
  assert.equal(earliestLeadDate({...nori,allow_same_day:false},cutoff,at),'2026-09-15');
  assert.equal(earliestLeadDate(nori,{...cutoff,cutoff_time:''},at),'2026-09-14');
  assert.equal(earliestLeadDate(nori,{...cutoff,nonproduction_dates:['2026-09-15']},at),'2026-09-15');
});
test('same-day eligibility does not bypass stock, closed dates, pickup-only or past-date limits',()=>{
  const nori={...product,name:'Nori',lead_days:0,allow_same_day:true};
  const rows=[{product_id:product.id,date:'2026-09-14',capacity:10,available:true}];
  assert.equal(availability(nori,'2026-09-14',settings,rows,monday).available,true);
  assert.equal(availability(nori,'2026-09-14',settings,[],monday).available,false);
  assert.equal(availability(nori,'2026-09-14',{...settings,blocked_dates:['2026-09-14']},rows,monday).available,false);
  assert.equal(availability(nori,'2026-09-14',{...settings,delivery_blocked_dates:['2026-09-14']},rows,monday,'delivery').available,false);
  assert.equal(availability({...nori,pickup_only:true},'2026-09-14',settings,rows,monday,'delivery').available,false);
  assert.equal(availability(nori,'2026-09-13',settings,rows,monday).available,false);
});
test('empty baskets need a stocked eligible product to show today, and mixed baskets never qualify',()=>{
  const nori={...product,id:'nori',lead_days:0,allow_same_day:true};
  const cake={...product,id:'cake',lead_days:0,allow_same_day:false};
  const rows=[{product_id:'nori',date:'2026-09-14',capacity:10,available:true}];
  assert.equal(sameDayBasketEligible([],[nori,cake],rows,'pickup',monday),true);
  assert.equal(sameDayBasketEligible([],[nori,cake],[],'pickup',monday),false);
  assert.equal(sameDayBasketEligible([],[{...nori,pickup_only:true}],rows,'delivery',monday),false);
  assert.equal(sameDayBasketEligible([{product_id:'nori'}],[nori,cake],rows,'pickup',monday),true);
  assert.equal(sameDayBasketEligible([{product_id:'nori'},{product_id:'cake'}],[nori,cake],rows,'pickup',monday),false);
  assert.equal(sameDayBasketEligible([{product_id:'missing'}],[nori,cake],rows,'pickup',monday),false);
});
