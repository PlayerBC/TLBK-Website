import {quantity,exact,multiply,scaleIngredients,ingredientTotals,componentPlan,scaledYield} from './recipe-math.js';
export const id=()=>crypto.randomUUID();
export const clone=value=>structuredClone(value);
export const ingredient=()=>({id:id(),name:'',quantity:'',unit:'g',notes:'',brand:''});
export const group=()=>({id:id(),name:'Ingredients',ingredients:[ingredient()]});
export const step=()=>({id:id(),instruction:'',timer_minutes:'',temperature:'',equipment:'',warning:''});
export const method=()=>({id:id(),name:'Method',steps:[step()]});
export const stage=()=>({id:id(),name:'Bake',top:'',bottom:'',actual_bottom:'',fan:'',minutes:'',core:'',notes:''});
export const variant=(name='Standard')=>({id:id(),name,yield:{quantity:'1',unit:'batch',portions:'',portion_weight:'',batch_weight:'',finished_weight:'',pan_size:'',pans:'',loss_percent:''},groups:[group()],methods:[method()],baking:[],components:[],equipment:[],packaging:{description:'',dimensions:'',notes:'',photos:[]},additional_costs:[],production_notes:'',photos:[]});
export const blankRecipe=()=>({name:'',description:'',category_id:'',tags:[],flavor:'',product_line:'',currency:'PHP',allergens:[],private_notes:'',critical_notes:'',photos:[],files:[],variants:[variant()]});
export function normalizeRecipe(doc){
  const result={...blankRecipe(),...clone(doc)};
  result.variants=(doc.variants||[]).map(v=>({...variant(v.name),...clone(v),yield:{...variant().yield,...v.yield},packaging:{description:'',dimensions:'',notes:'',photos:[],...v.packaging}}));
  return result;
}
export function freshVariant(value,name) {
  const v=clone(value);v.id=id();v.name=name||`${value.name} — copy`;
  for(const g of v.groups){g.id=id();for(const r of g.ingredients)r.id=id();}
  for(const m of v.methods){m.id=id();for(const s of m.steps)s.id=id();}
  for(const s of v.baking)s.id=id();for(const c of v.components)c.id=id();return v;
}
export function validateRecipe(doc) {
  const errors=[];if(!doc.name?.trim())errors.push('Add a recipe name.');
  if(!doc.variants?.length)errors.push('Add a size variant.');
  const unique=new Set();
  for(const v of doc.variants||[]) {
    if(!v.name?.trim())errors.push('Name each size variant.');
    try{if(!quantity(v.yield.quantity).n)throw Error();}catch{errors.push(`${v.name}: base yield must be positive.`);}
    if(!v.yield.unit?.trim())errors.push(`${v.name}: add a yield unit.`);
    for(const g of v.groups)for(const r of g.ingredients) {
      if(!r.name?.trim())errors.push(`${v.name} / ${g.name}: name each ingredient or remove the empty row.`);
      try{quantity(r.quantity);}catch{errors.push(`${r.name||'Ingredient'}: enter a nonnegative quantity or fraction.`);}
      if(!r.unit?.trim())errors.push(`${r.name||'Ingredient'}: choose a unit.`);
      if(unique.has(r.id))errors.push('Ingredient row identifiers must be unique.');unique.add(r.id);
    }
    for(const m of v.methods)for(const s of m.steps)if(!s.instruction?.trim())errors.push(`${m.name}: fill or remove empty method steps.`);
  }return errors;
}
export function scaledCopy(doc,variantId,factor,{mode='multiplier',target=null}={}) {
  const result=clone(doc),source=result.variants.find(v=>v.id===variantId);if(!source)throw Error('Choose a size.');
  const f=quantity(factor);if(!f.n)throw Error('Scaling quantity must be positive.');
  source.groups=scaleIngredients(source.groups,f).map(g=>({...g,ingredients:g.ingredients.map(r=>{
    const {base_quantity,scaled_quantity,scaled_display,...row}=r;return {...row,quantity:scaled_display};
  })}));
  source.yield=scaledYield(source.yield,f,{mode,target});
  for(const c of source.components)c.quantity=exact(multiply(quantity(c.quantity),f));
  for(const c of source.additional_costs)if(c.per_batch!==false){c.amount=exact(multiply(quantity(c.amount),f));if(c.resource_id&&c.quantity)c.quantity=exact(multiply(quantity(c.quantity),f));}
  result.variants=[freshVariant(source,source.name)];result.name=`${doc.name} × ${exact(f)}`;return result;
}
export function differences(before,after,path='') {
  if(JSON.stringify(before)===JSON.stringify(after))return [];
  if(before && after && typeof before==='object' && typeof after==='object') {
    const keys=new Set([...Object.keys(before),...Object.keys(after)]);
    return [...keys].flatMap(key=>differences(before[key],after[key],path?`${path}.${key}`:key));
  }return [{field:path,before:before??null,after:after??null}];
}
export function applyVariation(base,overrides) {
  const doc=clone(base);
  for(const change of overrides) {
    const v=doc.variants.find(v=>v.id===change.variant_id);if(!v)throw Error('Variation size no longer exists.');
    const g=v.groups.find(g=>g.id===change.group_id);if(!g)throw Error('Variation ingredient group no longer exists.');
    const index=g.ingredients.findIndex(r=>r.id===change.row_id);
    if(change.action==='add'){g.ingredients.push({...clone(change.ingredient),id:change.row_id||id()});continue;}
    if(index<0)throw Error('Variation ingredient no longer exists.');
    if(change.action==='remove')g.ingredients.splice(index,1);
    else if(change.action==='replace')g.ingredients[index]={...g.ingredients[index],...clone(change.ingredient),id:change.row_id};
    else throw Error('Unknown ingredient variation action.');
  }return doc;
}
export function csvTotals(totals) {
  const escape=value=>`"${String(value??'').replace(/^[=+@\-]/,"'$&").replaceAll('"','""')}"`;
  return '\uFEFF'+[['Ingredient','Brand','Quantity','Unit'],...totals.map(r=>[r.name,r.brand,r.display,r.unit])].map(row=>row.map(escape).join(',')).join('\r\n');
}
export function csvIngredients(doc,variantId,factor='1') {
  const v=doc.variants.find(v=>v.id===variantId);if(!v)throw Error('Choose a size.');return csvTotals(ingredientTotals(v.groups,factor));
}
export async function productionPlan(record,variantId,factor,{loadRecipe,wholeComponents=false}={}){
  const groups=[],components=[],preparations=[],cache=new Map();
  async function expand(current,sizeId,multiplier,path,depth=0,need=null){
    if(depth>32)throw Error('Component nesting exceeds 32 levels.');
    const key=`${current.version_id}:${sizeId}`;if(path.has(key))throw Error('Component cycle detected.');const nextPath=new Set([...path,key]);
    const v=current.document.variants.find(v=>v.id===sizeId);if(!v)throw Error('A linked component size no longer exists in the saved version.');
    preparations.push({record:current,variant_id:sizeId,factor:exact(multiplier),depth,need});
    for(const g of scaleIngredients(v.groups,multiplier))groups.push({...g,name:depth?`${current.document.name} · ${g.name}`:g.name,ingredients:g.ingredients.map(row=>({...row,quantity:row.scaled_display}))});
    for(const link of v.components||[]){
      if(!loadRecipe)throw Error('Load linked recipes before calculating production totals.');
      let child=cache.get(link.version_id);if(!child){child=await loadRecipe(link,current);cache.set(link.version_id,child);}
      const childVariant=child.document.variants.find(v=>v.id===link.variant_id)||(!link.variant_id?child.document.variants[0]:null);
      if(!childVariant)throw Error('Component size was not found.');
      const required=multiply(quantity(link.quantity),multiplier),plan=componentPlan(childVariant.yield.quantity,required,{wholeBatches:wholeComponents});
      components.push({name:child.document.name,version:child.version,version_id:child.version_id,variant_id:childVariant.id,unit:childVariant.yield.unit,required:exact(required),batches:exact(plan.batches),produced:exact(plan.produced),leftover:exact(plan.leftover)});
      await expand(child,childVariant.id,quantity(plan.batches),nextPath,depth+1,{required:exact(required),leftover:exact(plan.leftover),unit:childVariant.yield.unit});
    }
  }
  await expand(record,variantId,quantity(factor),new Set());return {groups,components,preparations,totals:ingredientTotals(groups)};
}
