import {exact,quantity,multiply,scaleIngredients,scaledYield} from './recipe-math.js';
import {productionPlan} from './recipe-model.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function openRecipeExport({record,production=null,selection=[],filters={},kitchen,settings,api,fileUrl,dialog}) {
 let defaults={layout:'kitchen',paper:'A4',font_size:'10',spacing:'1.45',packaging:true,process:true,notes:false};
 try{defaults={...defaults,...JSON.parse(localStorage.getItem('tlb-recipe-export-preferences')||'{}')};}catch{/* Use print defaults. */}
 const field=(label,name,type,value)=>`<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${type==='number'?'min="8" max="18" step="0.25"':''}></label>`;
 dialog('Print / export PDF',`<form id="recipe-export-form"><p>${record?esc(record.document.name):selection.length?`${selection.length} selected recipes`:'All recipes matching the current filters'} · alphabetical order</p><div class="recipe-fields two"><label>Layout<select name="layout"><option value="kitchen" ${defaults.layout==='kitchen'?'selected':''}>A · Kitchen sheet</option><option value="presentation" ${defaults.layout==='presentation'?'selected':''}>B · TLB presentation</option></select></label><label>Paper<select name="paper"><option ${defaults.paper==='A4'?'selected':''}>A4</option><option ${defaults.paper==='Letter'?'selected':''}>Letter</option></select></label>${field('Text size · pt','font_size','number',defaults.font_size)}<label>Line spacing<select name="spacing">${['1.25','1.45','1.65'].map(s=>`<option ${s===defaults.spacing?'selected':''}>${s}</option>`).join('')}</select></label><label>Typeface<select name="font"><option value="brand" ${defaults.font==="brand"?"selected":""}>TLB brand fonts</option><option value="sans" ${defaults.font==="sans"?"selected":""}>Clear sans serif</option><option value="serif" ${defaults.font==="serif"?"selected":""}>Traditional serif</option></select></label></div>
 ${record&&production?`<label class="recipe-inline-check"><input type="checkbox" name="production">Current production quantity ×${esc(production.factor)} · selected size only</label>`:''}<label class="recipe-inline-check"><input type="checkbox" name="packaging" ${defaults.packaging?'checked':''}>Separate packaging, special equipment and notes page</label><label class="recipe-inline-check"><input type="checkbox" name="process" ${defaults.process?'checked':''}>Process photos</label>${!kitchen?`<label class="recipe-inline-check"><input type="checkbox" name="notes" ${defaults.notes?'checked':''}>Private notes</label>`:''}<label class="recipe-inline-check"><input type="checkbox" name="component_breaks" ${defaults.component_breaks==="on"?"checked":""}>Start each ingredient group on a new page</label><label class="recipe-inline-check"><input type="checkbox" name="save_defaults" checked>Remember these export preferences</label><p class="recipe-muted">Choose “Save as PDF” in the print window. Linked components are included with the required quantities and their saved methods. Baking times and temperatures stay unchanged.</p><p data-export-status role="status"></p><button class="primary" type="submit">Prepare printable recipe${record?'':' book'}</button></form>`);
 const form=document.querySelector('#recipe-export-form');
 form.addEventListener('submit',async event=>{
  event.preventDefault();const button=form.querySelector('[type=submit]'),status=form.querySelector('[data-export-status]');button.disabled=true;
  try {
   const values=Object.fromEntries(new FormData(form)),options={...values,packaging:values.packaging==='on',process:values.process==='on',notes:!kitchen&&values.notes==='on'};
   options.font_size=String(Math.min(18,Math.max(8,Number(options.font_size)||10)));
   if(values.save_defaults==='on')localStorage.setItem('tlb-recipe-export-preferences',JSON.stringify(options));
   status.textContent='Loading recipe versions and photos…';let records=[];
   if(record)records=[record];else{
    let ids=selection;
    if(!ids.length){ids=[];let offset=0;while(true){const page=await api('list',{...filters,kitchen,limit:100,offset});ids.push(...page.rows.map(r=>r.id));offset+=page.rows.length;if(offset>=page.total||!page.rows.length)break;}}
    if(!ids.length)throw Error('There are no recipes in this export.');
    for(let i=0;i<ids.length;i+=3){records.push(...await Promise.all(ids.slice(i,i+3).map(id=>api('get',{id,kitchen}))));status.textContent=`Loaded ${records.length} of ${ids.length} recipes…`;}
   }
   records.sort((a,b)=>a.document.name.localeCompare(b.document.name));
   records=await preparePrintRecords(records,{production:values.production==='on'?production:null,api,kitchen});
   const urls=new Map();for(const r of records)for(const f of r.files||[])if(f.mime_type.startsWith('image/')&&!urls.has(f.id))urls.set(f.id,await fileUrl(f.path));
   document.querySelector('.recipe-print-root')?.remove();document.querySelector('#recipe-print-page-style')?.remove();
   const style=document.createElement('style');style.id='recipe-print-page-style';
   const font=options.font==='sans'?'Arial, sans-serif':options.font==='serif'?'Georgia, serif':'inherit';
   style.textContent=`@page{size:${options.paper==='Letter'?'Letter':'A4'};margin:16mm;@bottom-right{content:counter(page);font:9pt Arial;color:#777}}@media print{.recipe-print-root{font-size:${options.font_size}pt!important;line-height:${['1.25','1.45','1.65'].includes(options.spacing)?options.spacing:'1.45'}!important;font-family:${font}!important}${options.component_breaks==='on'?'.recipe-print-group{break-before:page}':''}}`;
   if(options.font==='sans'||options.font==='serif')style.textContent+=`@media print{.recipe-print-root h1{font-family:${font}!important}}`;
   document.head.append(style);const printable=document.createElement('div');printable.className=`recipe-print-root ${options.layout==='presentation'?'presentation':''}`;
   printable.innerHTML=printBook(records,options,urls);document.body.append(printable);
   await Promise.all([...printable.querySelectorAll('img')].map(img=>img.decode().catch(()=>{throw Error('A recipe photo could not load. Retry before printing.');})));
   await document.fonts.ready;status.textContent='Ready. Use the print window to print or save a PDF.';document.querySelector('#recipe-dialog').close();window.print();
  }catch(error){status.textContent=error.message;status.className='recipe-error';}finally{button.disabled=false;}
 });
}
function photos(list,urls){return (list||[]).filter(p=>urls.has(p.file_id)).map(p=>`<img src="${esc(urls.get(p.file_id))}" alt="${esc(p.caption||'Recipe photo')}">`).join('');}
export async function preparePrintRecords(records,{production=null,api,kitchen=false}={}) {
 const output=[],cache=new Map();
 const loadRecipe=async(link,parent)=>{const related=parent.links.find(l=>l.version_id===link.version_id);if(!related)throw Error('A component reference is missing.');if(!cache.has(link.version_id))cache.set(link.version_id,await api('get',{id:related.recipe_id,version_id:link.version_id,kitchen}));return cache.get(link.version_id);};
 for(const source of records){
  for(const v of source.document.variants.filter(v=>!production||production.variant_id===v.id)){
   const plan=await productionPlan(source,v.id,production?.factor||'1',{loadRecipe,wholeComponents:production?.wholeComponents||false});
   for(const prep of plan.preparations){
    const current=structuredClone(prep.record),size=structuredClone(current.document.variants.find(v=>v.id===prep.variant_id)),factor=quantity(prep.factor);
    size.groups=scaleIngredients(size.groups,factor).map(g=>({...g,ingredients:g.ingredients.map(r=>({...r,quantity:r.scaled_display}))}));
    const portionMode=prep.depth===0&&production?.mode==='portion';
    size.yield=scaledYield(size.yield,factor,{mode:portionMode?'portion':'multiplier',target:production?.target});
    for(const c of size.components||[])c.quantity=exact(multiply(quantity(c.quantity),factor));
    current.document.variants=[size];current.print_id=`${current.id}-${output.length}`;
    current.print_context=prep.depth?`Component for ${source.document.name} · ${v.name} · ×${prep.factor} · Needed ${prep.need.required} ${prep.need.unit}; left over ${prep.need.leftover} ${prep.need.unit}`:`${v.name} · ×${prep.factor}`;
    current.is_component=prep.depth>0;output.push(current);
   }
  }
 }return output;
}
export function printBook(records,options,urls=new Map()) {
 const main=records.filter(r=>!r.is_component),contents=main.length>1?`<section class="recipe-print-cover"><p class="recipe-eyebrow">The Little Baker Kitchen</p><h1>Recipe collection</h1><p>${main.length} recipe sizes · ${new Date().toLocaleDateString('en-PH')}</p><h2>Alphabetical contents</h2><ol>${main.map(r=>`<li><a href="#print-${r.print_id||r.id}">${esc(r.document.name)} · ${esc(r.print_context||'')}</a> · Version ${r.version}</li>`).join('')}</ol></section>`:'';
 return contents+records.map(r=>{
  const d=r.document;
  const hasReference=d.variants.some(v=>Object.entries(v.packaging||{}).some(([key,value])=>key==='photos'?value?.length:typeof value==='string'&&value.trim())||(v.equipment||[]).length)||(options.notes&&d.private_notes);
  return `<article id="print-${r.print_id||r.id}"><p class="recipe-eyebrow">The Little Baker Kitchen · ${esc(r.code)} · Version ${r.version}</p><h1>${esc(d.name)}</h1><p class="recipe-muted">${esc(r.print_context||'')} · Updated ${new Date(r.updated_at).toLocaleDateString('en-PH')} · ${esc(r.status)}</p><p>${esc(d.description)}</p>${photos(d.photos,urls)}${d.critical_notes?`<div class="recipe-print-note">${esc(d.critical_notes)}</div>`:''}
  ${d.variants.map(v=>`<h2>${esc(v.name)}</h2><div class="recipe-yield"><strong>Yield: ${esc(v.yield.quantity)} ${esc(v.yield.unit)}</strong>${v.yield.portions?`<span>${esc(v.yield.portions)} portions</span>`:''}${v.yield.portion_weight?`<span>${esc(v.yield.portion_weight)} g per portion</span>`:''}${v.yield.pan_size?`<span>${esc(v.yield.pan_size)}</span>`:''}</div>
   ${v.groups.map(g=>`<section class="recipe-print-group"><h3>${esc(g.name)}</h3><table><thead><tr><th>Ingredient</th><th>Quantity</th><th>Notes</th></tr></thead><tbody>${g.ingredients.map(row=>`<tr><td>${esc(row.name)}${row.brand?` · ${esc(row.brand)}`:''}</td><td>${esc(row.quantity)} ${esc(row.unit)}</td><td>${esc(row.notes)}</td></tr>`).join('')}</tbody></table></section>`).join('')}
   ${(v.methods||[]).map(m=>`<h3>${esc(m.name)}</h3><ol>${m.steps.map(s=>`<li>${esc(s.instruction).replaceAll('\n','<br>')}${s.timer_minutes||s.temperature||s.equipment?`<p class="recipe-muted">${[s.timer_minutes?`${s.timer_minutes} min`:'',s.temperature,s.equipment].filter(Boolean).map(esc).join(' · ')}</p>`:''}${s.warning?`<p><strong>${esc(s.warning)}</strong></p>`:''}${options.process&&s.image_id?photos([{file_id:s.image_id}],urls):''}</li>`).join('')}</ol>`).join('')}
   ${(v.baking||[]).length?`<h3>Baking & temperature stages</h3><table>${v.baking.map(s=>`<tr><td><strong>${esc(s.name)}</strong></td><td>${[['Top',s.top,'°C'],['Bottom setting',s.bottom,'°C'],['Actual',s.actual_bottom,'°C'],['Time',s.minutes,'min'],['Fan',s.fan,''],['Core',s.core,'°C'],['Ingredient',s.ingredient_temperature,'°C'],['Batter',s.batter_temperature,'°C'],['Resting',s.resting_temperature,'°C'],['Cooling',s.cooling_minutes,'min'],['Freezing',s.freezing_minutes,'min']].filter(([,value])=>value).map(([label,value,unit])=>`${label}: ${esc(value)} ${unit}`).join('<br>')}</td><td>${esc(s.notes)}</td></tr>`).join('')}</table>`:''}
   ${v.production_notes?`<h3>Production notes</h3><div class="recipe-print-note">${esc(v.production_notes)}</div>`:''}
  `).join('')}
  ${options.packaging&&hasReference?`<section class="recipe-reference"><p class="recipe-eyebrow">${esc(d.name)} · Reference</p><h1>Packaging & special equipment</h1>${d.variants.map(v=>`<h2>${esc(v.name)}</h2><p>${[v.packaging?.description,v.packaging?.dimensions,v.packaging?.box,v.packaging?.board].filter(Boolean).map(esc).join(' · ')}</p><p>${esc(v.packaging?.notes)}</p>${photos(v.packaging?.photos,urls)}${(v.equipment||[]).length?`<h3>Special equipment</h3><ul>${v.equipment.map(e=>`<li><strong>${esc(e.name)}</strong>${e.notes?` · ${esc(e.notes)}`:''}</li>`).join('')}</ul>`:''}`).join('')}${options.notes&&d.private_notes?`<h2>Private notes</h2><div class="recipe-print-note">${esc(d.private_notes)}</div>`:''}</section>`:''}</article>`;
 }).join('');
}
