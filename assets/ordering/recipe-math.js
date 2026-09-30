// Recipe quantities use rational arithmetic. Display rounding never changes a formula.
const fractions = { '¼':'1/4','½':'1/2','¾':'3/4','⅐':'1/7','⅑':'1/9','⅒':'1/10','⅓':'1/3','⅔':'2/3','⅕':'1/5','⅖':'2/5','⅗':'3/5','⅘':'4/5','⅙':'1/6','⅚':'5/6','⅛':'1/8','⅜':'3/8','⅝':'5/8','⅞':'7/8' };
const gcd = (a,b) => { a=a<0n?-a:a; b=b<0n?-b:b; while(b) [a,b]=[b,a%b]; return a||1n; };
function rational(n,d=1n) {
  if(!d) throw Error('A quantity cannot have a zero denominator.');
  if(d<0n) { n=-n; d=-d; }
  const g=gcd(n,d); return {n:n/g,d:d/g};
}
function decimal(value) {
  if(!/^\d+(?:\.\d+)?$/.test(value)) throw Error('Enter a number or fraction, such as 120, 0.5 or 1½.');
  const [whole,part='']=value.split('.'); return rational(BigInt(whole+part),10n**BigInt(part.length));
}
export function quantity(value) {
  if(value && typeof value==='object' && 'n' in value && 'd' in value) {
    const result=rational(BigInt(value.n),BigInt(value.d));
    if(result.n<0n) throw Error('Quantities cannot be negative.'); return result;
  }
  let text=String(value??'').trim();
  if(!text || text.length>120) throw Error('Enter a quantity of at most 120 characters.');
  text=text.replace(/[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g,m=>` ${fractions[m]}`).trim();
  return text.split('+').reduce((total,term)=> {
    const t=term.trim(); let q;
    const mixed=t.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
    const fraction=t.match(/^(\d+)\s*\/\s*(\d+)$/);
    if(mixed) q=add(decimal(mixed[1]),rational(BigInt(mixed[2]),BigInt(mixed[3])));
    else if(fraction) q=rational(BigInt(fraction[1]),BigInt(fraction[2]));
    else q=decimal(t.startsWith('.')?`0${t}`:t);
    return add(total,q);
  },rational(0n));
}
export const add=(a,b)=>rational(a.n*b.d+b.n*a.d,a.d*b.d);
export const multiply=(a,b)=>rational(a.n*b.n,a.d*b.d);
export function divide(a,b) { if(!b.n) throw Error('The base quantity must be greater than zero.'); return rational(a.n*b.d,a.d*b.n); }
export const compare=(a,b)=>a.n*b.d===b.n*a.d?0:a.n*b.d>b.n*a.d?1:-1;
export const serialize=q=>({n:q.n.toString(),d:q.d.toString()});
export function exact(value) {
  const q=quantity(value); let d=q.d;
  while(d%2n===0n)d/=2n; while(d%5n===0n)d/=5n;
  if(d!==1n) { const whole=q.n/q.d,remainder=q.n%q.d; return whole&&remainder?`${whole} ${remainder}/${q.d}`:`${q.n}/${q.d}`; }
  const whole=q.n/q.d; let remainder=q.n%q.d,tail='';
  while(remainder) { remainder*=10n;tail+=remainder/q.d;remainder%=q.d; }
  return `${whole}${tail?`.${tail}`:''}`;
}
export function displayQuantity(value,{mode='exact',step='1'}={}) {
  const q=quantity(value);
  if(mode==='exact')return {text:exact(q),exact:serialize(q),rounded:false};
  if(!['whole','practical'].includes(mode))throw Error('Unknown rounding option.');
  const increment=quantity(mode==='whole'?'1':step);
  if(!increment.n)throw Error('Rounding increment must be greater than zero.');
  const units=divide(q,increment),rounded=multiply(rational((units.n*2n+units.d)/(units.d*2n)),increment);
  return {text:exact(rounded),exact:serialize(q),rounded:compare(rounded,q)!==0};
}
export function scaleFactor(yieldInfo,mode,target) {
  const wanted=quantity(target); if(!wanted.n)throw Error('Production quantity must be greater than zero.');
  if(mode==='multiplier')return wanted;
  const fields={yield:'quantity',pieces:'portions',portion:'portion_weight',weight:'batch_weight',pans:'pans'};
  if(!fields[mode])throw Error('Unknown scaling method.');
  if(!yieldInfo?.[fields[mode]])throw Error(`Add a base ${fields[mode].replaceAll('_',' ')} before using this scaling method.`);
  return divide(wanted,quantity(yieldInfo[fields[mode]]));
}
export function scaleIngredients(groups,factor) {
  const f=quantity(factor); if(!f.n)throw Error('Scale must be greater than zero.');
  return groups.map(group=>({...group,ingredients:group.ingredients.map(row=>({...row,base_quantity:row.quantity,
    scaled_quantity:serialize(multiply(quantity(row.quantity),f)),scaled_display:exact(multiply(quantity(row.quantity),f))}))}));
}
export function scaledYield(yieldInfo,factor,{mode='multiplier',target=null}={}){
 const result=structuredClone(yieldInfo),f=quantity(factor);
 const keys=mode==='portion'?['batch_weight','finished_weight']:['quantity','portions','batch_weight','finished_weight','pans'];
 if(mode==='portion'&&['mass','volume'].includes(unitInfo(result.unit).dimension))keys.push('quantity');
 for(const key of keys)if(result[key])result[key]=exact(multiply(quantity(result[key]),f));
 if(mode==='portion')result.portion_weight=target?exact(quantity(target)):exact(multiply(quantity(result.portion_weight),f));
 return result;
}
const units = {
  g:['mass','1','g'],gram:['mass','1','g'],grams:['mass','1','g'],kg:['mass','1000','g'],mg:['mass','0.001','g'],
  ml:['volume','1','ml'],l:['volume','1000','ml'],litre:['volume','1000','ml'],liter:['volume','1000','ml'],
  pc:['count','1','pc'],pcs:['count','1','pc'],piece:['count','1','pc'],pieces:['count','1','pc'],
};
export function unitInfo(unit) {
  const text=String(unit||'').trim().toLowerCase(); if(!text)throw Error('Choose an ingredient unit.');
  const [dimension,factor,canonical]=units[text]||[`custom:${text}`,'1',text];
  return {dimension,factor:quantity(factor),canonical};
}
export function convert(value,from,to) {
  const a=unitInfo(from),b=unitInfo(to);
  if(a.dimension!==b.dimension)throw Error(`Cannot convert ${from} to ${to} without an explicit conversion.`);
  return divide(multiply(quantity(value),a.factor),b.factor);
}
export function ingredientTotals(groups,factor='1') {
  const totals=new Map(),f=quantity(factor);
  for(const group of groups)for(const row of group.ingredients) {
    const u=unitInfo(row.unit),identity=row.ingredient_id||`${String(row.name).trim().toLowerCase()}|${String(row.brand||'').trim().toLowerCase()}`;
    const key=`${identity}|${u.dimension}`;
    const current=totals.get(key)||{ingredient_id:row.ingredient_id||null,name:row.name,brand:row.brand||'',unit:u.canonical,quantity:rational(0n)};
    current.quantity=add(current.quantity,multiply(multiply(quantity(row.quantity),u.factor),f));totals.set(key,current);
  }
  return [...totals.values()].map(row=>({...row,quantity:serialize(row.quantity),display:exact(row.quantity)})).sort((a,b)=>a.name.localeCompare(b.name));
}
export function componentPlan(baseYield,needed,{wholeBatches=false}={}) {
  const base=quantity(baseYield),requested=quantity(needed),ratio=divide(requested,base);
  const batches=wholeBatches?rational((ratio.n+ratio.d-1n)/ratio.d):ratio;
  const produced=multiply(batches,base),leftover=rational(produced.n*requested.d-requested.n*produced.d,produced.d*requested.d);
  return {batches:serialize(batches),produced:serialize(produced),leftover:serialize(leftover)};
}
// Cost currency must match. No density, egg weight or cup convention is guessed.
export function ingredientCost(row,price) {
  if(!price || price.amount==null || !price.quantity || !price.unit) return null;
  const used=convert(row.quantity,row.unit,price.unit);
  return multiply(divide(used,quantity(price.quantity)),quantity(price.amount));
}
export function costRecipe(groups,{prices={},additional=[],portions=null,currency='PHP',factor='1'}={}) {
  const lines=[],missing=[];let total=quantity('0');const f=quantity(factor);
  for(const group of groups)for(const row of group.ingredients) {
    const price=row.cost_snapshot||prices[row.ingredient_id];
    if(price?.currency && price.currency!==currency) {missing.push({id:row.id,name:row.name,reason:'Different currency'});continue;}
    try {
      const cost=ingredientCost(row,price);
      if(cost===null){missing.push({id:row.id,name:row.name,reason:'Price not entered'});continue;}
      const scaled=multiply(cost,f);total=add(total,scaled);
      lines.push({id:row.id,name:row.name,cost:serialize(scaled),price_snapshot:structuredClone(price)});
    }catch(error){missing.push({id:row.id,name:row.name,reason:error.message});}
  }
  const ingredientTotal=total;
  for(const cost of additional)total=add(total,multiply(quantity(cost.amount),cost.per_batch===false?quantity('1'):f));
  const count=portions?multiply(quantity(portions),f):null;
  return {currency,complete:missing.length===0,missing,lines,ingredient_total:serialize(ingredientTotal),total:serialize(total),
    per_portion:count?.n?serialize(divide(total,count)):null};
}
