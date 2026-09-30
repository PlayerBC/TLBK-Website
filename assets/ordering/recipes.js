import {ready,auth,recipeApi as api,uploadRecipeFile,recipeFileUrl} from './client.js';
import {confirmDialog} from './site-dialog.js';
import {prepareProductImage} from './product-image.js';
import * as model from './recipe-model.js';
import {quantity,exact,scaleFactor,scaleIngredients,displayQuantity,costRecipe,ingredientTotals,multiply,scaledYield} from './recipe-math.js';

const root=document.querySelector('#recipe-main'),dialog=document.querySelector('#recipe-dialog'),dialogBody=document.querySelector('#recipe-dialog-body');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(label,action,extra='',cls='')=>`<button type="button" data-action="${action}" ${extra} class="${cls}">${label}</button>`;
const money=value=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(typeof value==='object'?Number(value.n)/Number(value.d):Number(value||0));
const date=value=>value?new Date(value).toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric'}):'—';
const state={role:null,categories:[],settings:{},tab:'library',kitchen:new URLSearchParams(location.search).get('view')==='kitchen',
 filters:{},offset:0,limit:24,selection:new Set(),record:null,doc:null,variant:0,editing:false,dirty:false,draftId:null,
 scale:{mode:'multiplier',target:'1',rounding:'exact',step:'1'},wholeComponents:false,fileUrls:new Map(),resources:[],request:0};
let noticeTimer,autosaveTimer,draggedRow,ingredientSearchTimer,pendingAutosave=Promise.resolve();
function notify(message,error=false) {
 const node=document.querySelector('#recipe-notice');node.textContent=message;node.setAttribute('role',error?'alert':'status');
 clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{node.textContent='';},error?12000:6000);
}
function showError(error){const message=error.message||'The request could not be completed.';if(dialog.open){let alert=dialogBody.querySelector('[data-dialog-error]');if(!alert){alert=document.createElement('p');alert.dataset.dialogError='';alert.className='recipe-error';alert.setAttribute('role','alert');dialogBody.prepend(alert);}alert.textContent=message;}else notify(message,true);}
function setDialog(title,body){document.querySelector('#recipe-dialog-title').textContent=title;dialogBody.innerHTML=body;if(!dialog.open)dialog.showModal();}
const closeDialog=()=>dialog.close();
const canEdit=()=>state.role!=='kitchen'&&!state.kitchen;
const isOwner=()=>state.role==='owner'&&!state.kitchen;
function shell(content,{tabs=true}={}) {
 root.classList.toggle('recipe-production',state.kitchen||state.role==='kitchen');
 root.innerHTML=`${tabs?`<div class="recipe-toolbar"><div><div class="recipe-eyebrow">Your kitchen reference</div><h1>${state.kitchen?'Production recipes':'Recipes & costing'}</h1><p class="recipe-muted">${state.kitchen?'Approved formulas, ready for the kitchen. Changes here do not edit your recipes.':'Your formulas, testing notes and production knowledge, kept together.'}</p></div>${canEdit()?`<div class="recipe-actions">${button('Import recipe','import')}${button('+ New recipe','new','','primary')}</div>`:''}</div><nav class="recipe-tabs" aria-label="Recipe sections">${[['library','Recipes'],...(canEdit()?[['ingredient','Ingredients'],['supplier','Suppliers'],['packaging','Packaging'],['equipment','Equipment']]:[]),...(isOwner()?[['categories','Categories'],['access','Access'],['backups','Backups']]:[])].map(([key,label])=>button(label,'tab',`data-tab="${key}" ${state.tab===key?'aria-current="page"':''}`)).join('')}</nav>`:''}${content}`;
}
function getPath(object,path){return path.split('.').reduce((v,k)=>v?.[k],object);}
function setPath(object,path,value){const keys=path.split('.');if(keys.some(k=>['__proto__','prototype','constructor'].includes(k)))throw Error('Invalid field.');let node=object;for(const k of keys.slice(0,-1))node=node[k]??(node[k]={});node[keys.at(-1)]=value;}
function field(label,path,{type='text',wide=false,options=null,placeholder='',rows=3,list='',readonly=false}={}) {
 const raw=getPath(state.doc,path),value=Array.isArray(raw)?raw.join(', '):raw??'';
 const common=`data-path="${esc(path)}" ${Array.isArray(raw)?'data-array="true"':''} ${readonly?'readonly':''}`;
 const input=options?`<select ${common}>${options.map(([v,t])=>`<option value="${esc(v)}" ${String(v)===String(value)?'selected':''}>${esc(t)}</option>`).join('')}</select>`:
 type==='textarea'?`<textarea ${common} rows="${rows}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`:
 `<input type="${type}" ${common} value="${esc(value)}" placeholder="${esc(placeholder)}" ${list?`list="${list}"`:''}>`;
 return `<label class="${wide?'wide':''}">${esc(label)}${input}</label>`;
}
function markDirty(){state.dirty=true;clearTimeout(autosaveTimer);autosaveTimer=setTimeout(saveDraft,1200);}
async function saveDraft(){
 if(!state.editing||!state.doc)return;const captured=state.draftId;
 try {pendingAutosave=api('autosave',{draft_id:captured,id:state.record?.id,revision:state.record?.revision,document:state.doc});await pendingAutosave;
  if(state.draftId===captured){const status=root.querySelector('[data-save-status]');if(status)status.textContent='Draft recovered automatically if you leave. Publish only with Save.';}
 }catch(error){const status=root.querySelector('[data-save-status]');if(status)status.textContent=`Draft could not be saved: ${error.message}`;}
}
async function leaveEditor(){
 if(!state.editing)return true;
 if(state.dirty&&!await confirmDialog('Your working draft is separate from the saved recipe. Leave this editor?',{confirmLabel:'Leave editor'}))return false;
 clearTimeout(autosaveTimer);if(state.dirty)await saveDraft();state.editing=false;state.dirty=false;return true;
}
async function library(){
 state.record=null;state.editing=false;state.tab='library';const request=++state.request;
 shell('<p role="status">Loading recipes…</p>');
 const data=await api('list',{...state.filters,offset:state.offset,limit:state.limit,kitchen:state.kitchen});if(request!==state.request)return;
 shell(`<div class="recipe-filters"><label>Find a recipe or ingredient<input type="search" data-filter="query" value="${esc(state.filters.query||'')}" placeholder="Search your recipes"></label>
  <label>Category<select data-filter="category_id"><option value="">All categories</option>${state.categories.map(c=>`<option value="${c.id}" ${state.filters.category_id===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label>
  ${!state.kitchen?`<label>Status<select data-filter="status"><option value="">All statuses</option>${['draft','testing','approved','production','archived'].map(s=>`<option ${state.filters.status===s?'selected':''}>${s}</option>`).join('')}</select></label>`:''}
  <label>Collection<select data-filter="collection"><option value="">All recipes · A–Z</option><option value="favorites" ${state.filters.favorites?'selected':''}>Favorites</option><option value="pinned" ${state.filters.pinned?'selected':''}>Pinned recipes</option><option value="recent" ${state.filters.recent?'selected':''}>Recently used</option>${isOwner()?`<option value="deleted" ${state.filters.deleted?'selected':''}>Recently deleted</option>`:''}</select></label></div>
  <div class="recipe-toolbar"><span class="recipe-muted">${data.total} recipes${state.selection.size?` · ${state.selection.size} selected`:''}</span><div class="recipe-actions">${button('More filters','filters')}${button('Print / export','export-library')}${canEdit()?button('Recover working draft','drafts'):''}</div></div>
  <div class="recipe-library">${data.rows.length?data.rows.map(r=>`<article class="recipe-card"><header><span class="recipe-badge ${esc(r.status)}">${esc(r.status)}</span><label class="recipe-inline-check"><input type="checkbox" data-select="${r.id}" aria-label="Select ${esc(r.name)}" ${state.selection.has(r.id)?'checked':''}></label></header><h2>${esc(r.name)}</h2><div class="recipe-muted">${esc(r.code)} · Version ${r.version}<br>Updated ${date(r.updated_at)}</div><div class="recipe-actions">${button(r.deleted_at?'View deleted recipe':'Open recipe','open',`data-id="${r.id}"`,'primary')}${button(r.favorite?'★':'☆','favorite',`data-id="${r.id}" data-favorite="${!r.favorite}" data-pinned="${Boolean(r.pinned)}" aria-label="${r.favorite?'Remove favorite':'Favorite recipe'}"`)}${button(r.pinned?'Unpin':'Pin','pin',`data-id="${r.id}" data-favorite="${Boolean(r.favorite)}" data-pinned="${!r.pinned}"`)}</div></article>`).join(''):'<div class="recipe-empty"><h2>No recipes here yet</h2><p>Create a recipe or adjust your filters.</p></div>'}</div>
  <div class="recipe-pagination">${button('Previous','page',`data-offset="${Math.max(0,state.offset-state.limit)}" ${state.offset===0?'disabled':''}`)}<span class="recipe-muted">${data.total?`${state.offset+1}–${Math.min(state.offset+state.limit,data.total)} of ${data.total}`:'0 recipes'}</span>${button('Next','page',`data-offset="${state.offset+state.limit}" ${state.offset+state.limit>=data.total?'disabled':''}`)}</div>`);
}
function beginEdit(record=null,document=null){
 state.record=record;state.doc=model.normalizeRecipe(document||record?.document||model.blankRecipe());state.variant=0;state.editing=true;state.dirty=false;state.draftId=model.id();renderEditor();
}
function renderEditor(){
 const d=state.doc,v=d.variants[state.variant],p=`variants.${state.variant}`;
 shell(`<div class="recipe-toolbar"><div><div class="recipe-eyebrow">${state.record?`Version ${state.record.version} · changes create a new version`:'New recipe'}</div><h1>${esc(d.name||'Untitled recipe')}</h1></div>${button('Back to library','library')}</div>
  <form id="recipe-editor">${d.import_review?`<section class="recipe-card"><h2>Review imported recipe</h2><p class="recipe-muted">Check quantities, units, yield and methods against the original source before approving this recipe.</p><label class="recipe-inline-check"><input type="checkbox" data-import-reviewed ${d.import_review.reviewed?'checked':''}>I have reviewed this imported formula and its yield.</label><details><summary>Original extracted text</summary><pre class="recipe-source-text">${esc(d.import_review.source_text)}</pre></details></section>`:''}<section class="recipe-card"><h2>Recipe details</h2><div class="recipe-fields">
  ${field('Recipe name','name',{wide:true})}${field('Category','category_id',{options:[['','Uncategorized'],...state.categories.filter(c=>c.active).map(c=>[c.id,c.name])]})}${field('Flavor','flavor')}${field('Product line','product_line')}${field('Tags · separated by commas','tags',{wide:true})}${field('Short description','description',{type:'textarea',wide:true})}
  </div><details class="recipe-advanced"><summary>Allergens, critical notes and private notes</summary><div class="recipe-fields">
 ${field('Allergens · manual additions / override','allergens',{wide:true})}${field('Critical production notes','critical_notes',{type:'textarea',wide:true})}${field('Private notes · hidden in kitchen view','private_notes',{type:'textarea',wide:true})}</div><label class="recipe-inline-check"><input type="checkbox" data-allergen-override ${d.allergen_override?'checked':''}>Use only my manual allergen list</label><p class="recipe-muted">Otherwise, allergens from linked ingredients and components are included on save. Review the list; it is a kitchen reference, not a compliance certification.</p></details>
  <div class="recipe-section-head"><h3>Finished product photos</h3>${button('+ Photo','upload', 'data-purpose="product"')}</div>${photoMarkup(d.photos)}
  </section><section class="recipe-card"><div class="recipe-section-head"><h2>Size variants</h2><div class="recipe-actions">${button('+ Size','add-variant')}${button('Duplicate size','duplicate-variant')}${d.variants.length>1?button('Remove size','remove-variant','','danger'):''}</div></div>
  <label>Working size<select data-editor-variant>${d.variants.map((v,i)=>`<option value="${i}" ${i===state.variant?'selected':''}>${esc(v.name)}</option>`).join('')}</select></label><div class="recipe-fields" style="margin-top:16px">${field('Size name',`${p}.name`)}${field('Base yield',`${p}.yield.quantity`)}${field('Yield unit',`${p}.yield.unit`)}${field('Number of portions',`${p}.yield.portions`)}${field('Portion weight · g',`${p}.yield.portion_weight`)}${field('Batch weight · g',`${p}.yield.batch_weight`)}${field('Finished weight · g',`${p}.yield.finished_weight`)}${field('Pan / mold size',`${p}.yield.pan_size`)}${field('Number of pans / molds',`${p}.yield.pans`)}${field('Expected loss · %',`${p}.yield.loss_percent`)}</div></section>
  <section class="recipe-card"><div class="recipe-section-head"><h2>Ingredients</h2>${button('+ Ingredient group','add-group')}</div><p class="recipe-muted">Keep fractions and original units. Use the handle or arrow buttons to reorder ingredients.</p>
  ${v.groups.map((g,gi)=>`<div class="recipe-group" data-group="${gi}"><div class="recipe-section-head">${field('Group / component',`${p}.groups.${gi}.name`)}${button('Remove group','remove-group',`data-group="${gi}"`,'danger')}</div>
   ${g.ingredients.map((r,ri)=>ingredientEditor(p,gi,ri)).join('')}${button('+ Ingredient','add-ingredient',`data-group="${gi}"`)}</div>`).join('')}<datalist id="recipe-ingredients"></datalist></section>
  <section class="recipe-card"><div class="recipe-section-head"><h2>Linked components</h2>${button('+ Link recipe','link-component')}</div><p class="recipe-muted">Each component uses a saved version. New component versions must be adopted explicitly.</p>${v.components.map((c,i)=>`<div class="recipe-fields"><label>Component<input value="${esc(c.name||c.version_id)}" readonly></label>${field('Amount of component yield needed',`${p}.components.${i}.quantity`)}${field('Version tracking',`${p}.components.${i}.mode`,{options:[['pinned','Keep this version'],['latest','Show when a newer version is available']]})}</div><div class="recipe-actions">${button('Remove link','remove-component',`data-index="${i}"`,'danger')}${button('Check newer version','update-component',`data-index="${i}"`)}</div>`).join('')}</section>
  <section class="recipe-card"><div class="recipe-section-head"><h2>Method</h2>${button('+ Method section','add-method')}</div>${v.methods.map((m,mi)=>`<div class="recipe-section-head">${field('Method section',`${p}.methods.${mi}.name`)}${button('Remove section','remove-method',`data-method="${mi}"`,'danger')}</div>${m.steps.map((s,si)=>`<div class="recipe-step-editor">${field(`Step ${si+1}`,`${p}.methods.${mi}.steps.${si}.instruction`,{type:'textarea'})}<div class="recipe-fields">${field('Timer · minutes',`${p}.methods.${mi}.steps.${si}.timer_minutes`)}${field('Temperature / setting',`${p}.methods.${mi}.steps.${si}.temperature`)}${field('Equipment',`${p}.methods.${mi}.steps.${si}.equipment`)}${field('Warning / note',`${p}.methods.${mi}.steps.${si}.warning`,{wide:true})}</div><div class="recipe-actions">${s.image_id?photoMarkup(v.photos.filter(p=>p.file_id===s.image_id)):''}${button('Process photo','upload',`data-purpose="process" data-method="${mi}" data-step="${si}"`)}${button('↑','move-step',`data-method="${mi}" data-step="${si}" data-direction="-1" aria-label="Move step up" ${si===0?'disabled':''}`)}${button('↓','move-step',`data-method="${mi}" data-step="${si}" data-direction="1" aria-label="Move step down" ${si===m.steps.length-1?'disabled':''}`)}${button('Remove step','remove-step',`data-method="${mi}" data-step="${si}"`,'danger')}</div></div>`).join('')}<div class="recipe-actions">${button('+ Step','add-step',`data-method="${mi}"`)}</div>`).join('')}</section>
  <section class="recipe-card"><div class="recipe-section-head"><h2>Baking & temperature stages</h2>${button('+ Stage','add-stage')}</div>${v.baking.map((s,i)=>`<div class="recipe-fields">${[['Stage name','name'],['Top heat · °C','top'],['Bottom heat setting · °C','bottom'],['Actual bottom heat · °C','actual_bottom'],['Fan setting','fan'],['Time · minutes','minutes'],['Core temperature · °C','core'],['Ingredient temperature · °C','ingredient_temperature'],['Batter temperature · °C','batter_temperature'],['Resting temperature · °C','resting_temperature'],['Cooling time · minutes','cooling_minutes'],['Freezing time · minutes','freezing_minutes']].map(([label,key])=>field(label,`${p}.baking.${i}.${key}`)).join('')}${field('Stage notes',`${p}.baking.${i}.notes`,{wide:true,type:'textarea'})}</div>${button('Remove stage','remove-stage',`data-index="${i}"`,'danger')}`).join('')}</section>
  <section class="recipe-card"><h2>Packaging, special equipment & notes</h2><p class="recipe-muted">These appear on a separate reference page in PDF exports.</p><div class="recipe-fields two">${field('Packaging description',`${p}.packaging.description`)}${field('Dimensions / size',`${p}.packaging.dimensions`)}${field('Box',`${p}.packaging.box`)}${field('Board / base',`${p}.packaging.board`)}${field('Packaging notes',`${p}.packaging.notes`,{type:'textarea',wide:true})}</div>${button('+ Packaging photo','upload','data-purpose="packaging"')}${photoMarkup(v.packaging.photos)}
  <div class="recipe-section-head"><h3>Special equipment</h3>${button('+ Equipment','add-equipment')}</div>${v.equipment.map((e,i)=>`<div class="recipe-fields two">${field('Equipment',`${p}.equipment.${i}.name`)}${field('Notes',`${p}.equipment.${i}.notes`)}</div>${button('Remove equipment','remove-equipment',`data-index="${i}"`,'danger')}`).join('')}
  ${field('Production notes',`${p}.production_notes`,{type:'textarea'})}</section>
  <section class="recipe-card"><div class="recipe-section-head"><h2>Costing · optional</h2><div class="recipe-actions">${button('Link packaging price','link-packaging-cost')}${button('+ Additional cost','add-cost')}</div></div><p class="recipe-muted">Ingredient prices come from the ingredient database or the row’s optional cost fields. A price snapshot is saved with each recipe version.</p>${v.additional_costs.map((c,i)=>`<div class="recipe-fields">${field('Cost type',`${p}.additional_costs.${i}.name`,{options:[['Packaging','Packaging'],['Labor','Labor'],['Utilities','Utilities'],['Delivery allocation','Delivery allocation'],['Miscellaneous','Miscellaneous']]})}${c.resource_id?`${field('Packaging item',`${p}.additional_costs.${i}.resource_name`,{readonly:true})}${field('Quantity used',`${p}.additional_costs.${i}.quantity`)}${field('Unit',`${p}.additional_costs.${i}.unit`)}`:field('Amount · PHP',`${p}.additional_costs.${i}.amount`)}<div class="recipe-row-buttons">${button('Remove cost','remove-cost',`data-index="${i}"`,'danger')}</div></div>`).join('')}${button('Preview calculated costs','cost-preview')}</section>
  <footer class="recipe-sticky-save"><span class="recipe-status-text" data-save-status>Changes are a working draft until saved.</span><div class="recipe-actions"><label>Status<select id="recipe-save-status">${(isOwner()?['draft','testing','approved','production','archived']:['draft','testing']).map(s=>`<option value="${s}" ${s===(state.record?.status||'draft')?'selected':''}>${s}</option>`).join('')}</select></label>${button('Save new version','save','','primary')}</div></footer></form>`,{tabs:false});
 const sections=[...root.querySelectorAll('#recipe-editor>section')];const nav=document.createElement('nav');nav.className='recipe-editor-outline';nav.setAttribute('aria-label','Recipe editor sections');nav.innerHTML=sections.map((section,i)=>{section.id=`recipe-editor-section-${i}`;return `<a href="#${section.id}">${esc(section.querySelector('h2')?.textContent||'Section')}</a>`;}).join('');root.querySelector('#recipe-editor').prepend(nav);
 hydratePhotos();
}
function ingredientEditor(p,gi,ri){
 const prefix=`${p}.groups.${gi}.ingredients.${ri}`,rows=state.doc.variants[state.variant].groups[gi].ingredients;
 return `<div class="recipe-ingredient-editor" data-ingredient-row="${ri}" data-group="${gi}"><button type="button" class="recipe-drag" draggable="true" aria-label="Drag ingredient">⠿</button>${field('Ingredient',`${prefix}.name`,{list:'recipe-ingredients'})}${field('Quantity',`${prefix}.quantity`)}${field('Unit',`${prefix}.unit`)}${field('Notes',`${prefix}.notes`)}<div class="recipe-row-buttons">${button('↑','move-ingredient',`data-group="${gi}" data-row="${ri}" data-direction="-1" aria-label="Move ingredient up" ${ri===0?'disabled':''}`)}${button('×','remove-ingredient',`data-group="${gi}" data-row="${ri}" aria-label="Remove ingredient"`,'danger')}</div><details class="recipe-row-extra"><summary>Brand, formula percentage and cost</summary><div class="recipe-fields">${field('Brand',`${prefix}.brand`)}${field('Formula percentage',`${prefix}.percentage`)}${field('Practical rounding increment · optional',`${prefix}.rounding_step`)}${field('Purchase price · PHP',`${prefix}.cost_snapshot.amount`)}${field('Purchase quantity',`${prefix}.cost_snapshot.quantity`)}${field('Purchase unit',`${prefix}.cost_snapshot.unit`)}</div>${rows[ri].ingredient_id?`<p class="recipe-muted">Linked to your ingredient database. The latest purchase price is captured on Save.</p>`:''}</details></div>`;
}
function photoMarkup(photos=[]){return `<div class="recipe-photos">${photos.map(p=>`<figure><img data-file-id="${esc(p.file_id)}" alt="${esc(p.caption||p.purpose||'Recipe photo')}"><figcaption>${state.editing?`<label>Caption<input data-photo-caption="${p.id}" value="${esc(p.caption||'')}"></label>`:esc(p.caption||'')}${state.editing?button('Remove','remove-photo',`data-file-id="${p.file_id}"`):''}</figcaption></figure>`).join('')}</div>`;}
async function hydratePhotos(){
 for(const link of root.querySelectorAll('[data-attachment]')){const file=state.record?.files.find(f=>f.id===link.dataset.attachment);if(file)try{link.href=await recipeFileUrl(file.path);}catch(error){link.textContent+=' · could not load';}}
 for(const img of root.querySelectorAll('img[data-file-id]')) {
  const file=[...(state.record?.files||[]),...(state.doc?.files||[])].find(f=>f.id===img.dataset.fileId);if(!file?.path)continue;
  try{let item=state.fileUrls.get(file.id);if(!item||Date.now()>item.expires){item={url:await recipeFileUrl(file.path),expires:Date.now()+12*60*1000};state.fileUrls.set(file.id,item);}if(img.isConnected)img.src=item.url;}catch{img.alt='Photo could not be loaded. Reopen the recipe to retry.';}
 }
}
async function openRecipe(id){
 const request=++state.request;shell('<p role="status">Opening recipe…</p>',{tabs:false});
 const record=await api('get',{id,kitchen:state.kitchen});if(request!==state.request)return;state.record=record;state.doc=model.normalizeRecipe(record.document);state.variant=0;state.editing=false;state.scale={mode:'multiplier',target:'1',rounding:'exact',step:'1'};renderRecipe();
}
function checkKey(row){return `tlb-recipe-check:${state.record.version_id}:${state.variant}:${state.scale.mode}:${state.scale.target}:${row}`;}
function checked(row){try{return sessionStorage.getItem(checkKey(row))==='1';}catch{return false;}}
function renderRecipe(){
 const r=state.record,d=state.doc,v=d.variants[state.variant];let f=quantity('1'),scalingError='';
 try{f=scaleFactor(v.yield,state.scale.mode,state.scale.target);}catch(error){scalingError=error.message;}
 const groups=scaleIngredients(v.groups,f);
 shell(`<div class="recipe-toolbar"><div><div class="recipe-eyebrow">${esc(r.code)} · Version ${r.version} · ${date(r.updated_at)}</div><h1>${esc(d.name)}</h1><span class="recipe-badge ${r.status}">${r.status}</span></div><div class="recipe-actions">${button('Library','library')}${canEdit()?button('Edit recipe','edit'):''}${button('Print / PDF','export')}${button('Ingredient CSV','csv')}</div></div>
  ${r.deleted_at?`<div class="recipe-notice">This recipe is in Recently deleted. Its history remains available. ${button('Restore recipe','undelete')}</div>`:''}
  <p>${esc(d.description)}</p>${(d.allergen_override?d.allergens:[...(d.allergens||[]),...(d.detected_allergens||[])]).length?`<p class="recipe-muted">Allergens: ${[...new Set(d.allergen_override?d.allergens:[...(d.allergens||[]),...(d.detected_allergens||[])])].map(esc).join(', ')}</p>`:''}${d.base?`<p class="recipe-muted">Variation of ${esc(d.base.name)} · saved base version ${button('Compare with base','compare-base')}</p>`:''}${photoMarkup(d.photos)}
  <section class="recipe-card"><div class="recipe-scale"><label>Size<select data-view-variant>${d.variants.map((v,i)=>`<option value="${i}" ${i===state.variant?'selected':''}>${esc(v.name)}</option>`).join('')}</select></label><label>Scale by<select data-scale="mode">${[['multiplier','Multiplier'],['yield','Desired yield'],['pieces','Number of pieces'],['portion','Portion weight · g'],['weight','Batch weight · g'],['pans','Number of pans']].map(([key,label])=>`<option value="${key}" ${state.scale.mode===key?'selected':''}>${label}</option>`).join('')}</select></label><label>Production quantity<input data-scale="target" inputmode="decimal" value="${esc(state.scale.target)}"></label><label>Display rounding<select data-scale="rounding">${[['exact','Exact quantities'],['whole','Whole grams'],['practical','Custom increment']].map(([key,label])=>`<option value="${key}" ${state.scale.rounding===key?'selected':''}>${label}</option>`).join('')}</select></label>${state.scale.rounding==='practical'?`<label>Rounding increment<input data-scale="step" value="${esc(state.scale.step)}"></label>`:''}</div>
  ${scalingError?`<p class="recipe-error">${esc(scalingError)}</p>`:''}<div class="recipe-yield"><span>Base: ${esc(v.yield.quantity)} ${esc(v.yield.unit)}</span><span>Prepare: ${esc(scaledYield(v.yield,f,state.scale).quantity)} ${esc(v.yield.unit)}</span><span>Multiplier ×${esc(exact(f))}</span>${state.scale.mode==='portion'?`<span>${esc(state.scale.target)} g per portion</span>`:''}${v.yield.pan_size?`<span>${esc(v.yield.pan_size)}</span>`:''}${v.yield.portions?`<span>${esc(v.yield.portions)} base portions</span>`:''}</div><p class="recipe-muted">Temporary production scaling leaves the saved formula unchanged. Temperatures and baking times stay the same. ≈ marks a rounded display.</p><div class="recipe-actions">${button('Ingredient totals','production-totals',scalingError?'disabled':'')}${button('Reset checkoffs','reset-checks')}${canEdit()?button('Save scaled copy','scaled-copy',scalingError?'disabled':''):''}</div></section>
  ${d.critical_notes?`<div class="recipe-notice">${esc(d.critical_notes).replaceAll('\n','<br>')}</div>`:''}
  <div class="recipe-grid"><div>${groups.map(g=>`<section class="recipe-card"><h2>${esc(g.name)}</h2><div class="recipe-table-wrap"><table class="recipe-table"><thead><tr><th>Ingredient</th><th>Base</th><th>Production</th></tr></thead><tbody>${g.ingredients.map(row=>{
   const shown=displayQuantity(row.scaled_quantity,{mode:state.scale.rounding==='whole'&&!['g','gram','grams'].includes(row.unit.toLowerCase())?'exact':state.scale.rounding,step:row.rounding_step||state.scale.step});return `<tr><td><label class="recipe-check"><input type="checkbox" data-check="${row.id}" ${checked(row.id)?'checked':''}><span>${esc(row.name)}${row.brand?`<small class="recipe-muted"> · ${esc(row.brand)}</small>`:''}${row.notes?`<small class="recipe-muted" style="display:block">${esc(row.notes)}</small>`:''}</span></label></td><td class="numeric recipe-muted">${esc(row.base_quantity)} ${esc(row.unit)}</td><td class="numeric" title="Exact: ${esc(exact(row.scaled_quantity))}">${shown.rounded?'≈ ':''}${esc(shown.text)} ${esc(row.unit)}</td></tr>`;
  }).join('')}</tbody></table></div></section>`).join('')}
  ${v.components.length?`<section class="recipe-card"><h2>Components</h2><label class="recipe-inline-check"><input type="checkbox" data-whole-components ${state.wholeComponents?'checked':''}>Prepare whole batches; show leftovers</label>${v.components.map(c=>{const link=r.links.find(l=>l.version_id===c.version_id);return `<div class="recipe-resource-row"><span>${esc(link?.name||c.name||'Component')}<small class="recipe-muted" style="display:block">Version ${link?.number||'—'} · ${esc(c.quantity)} base yield${link?.update_available?' · New version available':''}</small></span>${button('View','open-component',`data-id="${link?.recipe_id||''}" data-version="${c.version_id}"`)}</div>`;}).join('')}</section>`:''}</div>
  <div>${v.methods.map(m=>`<section class="recipe-card"><h2>${esc(m.name)}</h2>${m.steps.map((s,i)=>`<div class="recipe-method-step"><label class="recipe-check"><input type="checkbox" data-check="${s.id}" ${checked(s.id)?'checked':''}><span><strong>${i+1}.</strong> ${esc(s.instruction).replaceAll('\n','<br>')}</span></label>${s.timer_minutes||s.temperature||s.equipment?`<p class="recipe-step-meta">${[s.timer_minutes?`${s.timer_minutes} min`:'',s.temperature,s.equipment].filter(Boolean).map(esc).join(' · ')}</p>`:''}${s.warning?`<p class="recipe-step-meta">${esc(s.warning)}</p>`:''}${s.image_id?photoMarkup([{file_id:s.image_id,purpose:'Process photo'}]):''}</div>`).join('')}</section>`).join('')}
  ${v.baking.length?`<section class="recipe-card"><h2>Baking & temperature settings</h2>${v.baking.map(s=>`<h3>${esc(s.name)}</h3><p>${[['Top',s.top,'°C'],['Bottom setting',s.bottom,'°C'],['Actual bottom',s.actual_bottom,'°C'],['Time',s.minutes,'min'],['Core',s.core,'°C'],['Fan',s.fan,''],['Ingredient',s.ingredient_temperature,'°C'],['Batter',s.batter_temperature,'°C'],['Resting',s.resting_temperature,'°C'],['Cool',s.cooling_minutes,'min'],['Freeze',s.freezing_minutes,'min']].filter(([,value])=>value).map(([label,value,unit])=>`${label}: <strong>${esc(value)} ${unit}</strong>`).join(' · ')}</p>${s.notes?`<p class="recipe-muted">${esc(s.notes)}</p>`:''}`).join('')}</section>`:''}</div></div>
  <section class="recipe-card"><h2>Packaging & special equipment</h2><p>${[v.packaging.description,v.packaging.dimensions,v.packaging.box,v.packaging.board].filter(Boolean).map(esc).join(' · ')}</p><p>${esc(v.packaging.notes)}</p>${photoMarkup(v.packaging.photos)}${v.equipment.map(e=>`<p><strong>${esc(e.name)}</strong>${e.notes?` · ${esc(e.notes)}`:''}</p>`).join('')}${v.production_notes?`<h3>Production notes</h3><p>${esc(v.production_notes).replaceAll('\n','<br>')}</p>`:''}</section>
  ${canEdit()?`<section class="recipe-card"><div class="recipe-actions">${button('Costing','cost-preview')}${button('Testing / R&D','tests')}${button('Production history','runs')}${button('Version history','versions')}${button('Duplicate','duplicate')}${button('New variation','variation')}${isOwner()?button('Move to recently deleted','delete','','danger'):''}</div>${(r.files||[]).filter(f=>f.visibility==='private'||!f.mime_type.startsWith('image/')).length?`<h3>Private source files</h3><ul>${r.files.filter(f=>f.visibility==='private'||!f.mime_type.startsWith('image/')).map(f=>`<li><a data-attachment="${f.id}" target="_blank" rel="noopener noreferrer">${esc(f.filename)}</a></li>`).join('')}</ul>`:''}${d.private_notes?`<h3>Private notes</h3><p>${esc(d.private_notes).replaceAll('\n','<br>')}</p>`:''}</section>`:''}`,{tabs:false});hydratePhotos();
}

async function resources(kind){
 state.tab=kind;state.record=null;state.editing=false;shell('<p role="status">Loading…</p>');
 const result=await api('resources',{kind,query:state.resourceQuery||'',limit:100,include_inactive:true});state.resources=result.rows;
 shell(`<div class="recipe-toolbar"><label>Search ${esc(kind)} records<input data-resource-search value="${esc(state.resourceQuery||'')}" type="search"></label>${button(`+ Add ${kind}`,'add-resource')}</div><section class="recipe-card">${result.rows.length?result.rows.map(r=>`<div class="recipe-resource-row"><div><strong>${esc(r.name)}</strong><p class="recipe-muted">${r.active?'Active':'Inactive'}${r.data.brand?` · ${esc(r.data.brand)}`:''}${r.price?` · ${money(r.price.amount)} / ${esc(r.price.quantity)} ${esc(r.price.unit)}`:''}</p></div>${button('Edit','edit-resource',`data-id="${r.id}"`)}</div>`).join(''):'<div class="recipe-empty">Add your first record to reuse it across recipes.</div>'}</section><p class="recipe-muted">Showing up to 100 matching records. Use search to narrow your results.</p>`);
}
async function resourceEditor(record=null){
 const kind=state.tab,data=record?.data||{},price=record?.price||{};state.resourceEditing=record;const suppliers=['ingredient','packaging'].includes(kind)?(await api('resources',{kind:'supplier',limit:100})).rows:[];
 const input=(label,key,value,type='text')=>`<label>${label}<input name="${key}" type="${type}" value="${esc(value)}"></label>`;
 const fields=kind==='supplier'?[['Supplier type','type'],['Contact name','contact_name'],['Email','email'],['Phone','phone'],['Address','address'],['Payment terms','payment_terms']]:
 kind==='ingredient'?[['Default unit','default_unit'],['Brand','brand'],['Category','category'],['Allergens · comma separated','allergens']]:
 kind==='packaging'?[['Packaging type','type'],['Dimensions','dimensions'],['Default unit','default_unit'],['Minimum order quantity','minimum_order_quantity'],['Product associations','product_associations']]:[['Equipment type','type']];
 setDialog(`${record?'Edit':'Add'} ${kind}`,`<form id="recipe-resource-form"><div class="recipe-fields two">${input('Name','name',record?.name||'')}${fields.map(([label,key])=>input(label,key,Array.isArray(data[key])?data[key].join(', '):data[key]||'')).join('')}<label class="wide">Notes<textarea name="notes">${esc(data.notes)}</textarea></label></div>
  ${['ingredient','packaging'].includes(kind)?`<h3>Purchase price · optional</h3><p class="recipe-muted">A changed purchase price is added to history. Existing recipe versions keep their previous prices.</p><div class="recipe-fields">${input('Price · PHP','price_amount',price.amount??'')}${input('Purchase quantity','price_quantity',price.quantity??'')}${input('Purchase unit','price_unit',price.unit||data.default_unit||'g')}<label>Supplier<select name="price_supplier"><option value="">Not specified</option>${suppliers.map(r=>`<option value="${r.id}" ${price.supplier_id===r.id?'selected':''}>${esc(r.name)}</option>`).join('')}</select></label></div>${record?button('Price history','price-history',`data-id="${record.id}"`):''}`:''}
  <label class="recipe-inline-check"><input name="active" type="checkbox" ${record?.active!==false?'checked':''}>Active</label><button class="primary" type="submit">Save ${kind}</button></form>`);
}
async function categories(){
 state.tab='categories';shell(`<section class="recipe-card"><div class="recipe-section-head"><h2>Categories & subcategories</h2>${button('+ Category','add-category')}</div>${state.categories.map(c=>`<div class="recipe-resource-row"><span>${esc(c.name)}${c.parent_id?` <small class="recipe-muted">in ${esc(state.categories.find(p=>p.id===c.parent_id)?.name)}</small>`:''}${!c.active?' · Inactive':''}</span>${button('Edit','edit-category',`data-id="${c.id}"`)}</div>`).join('')}</section>`);
}
function categoryEditor(c={}){state.categoryEditing=c;setDialog(c.id?'Edit category':'Add category',`<form id="recipe-category-form"><div class="recipe-fields two"><label>Category name<input name="name" value="${esc(c.name)}" required maxlength="100"></label><label>Parent category<select name="parent_id"><option value="">Top-level category</option>${state.categories.filter(p=>p.id!==c.id).map(p=>`<option value="${p.id}" ${c.parent_id===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label></div><label class="recipe-inline-check"><input name="active" type="checkbox" ${c.active!==false?'checked':''}>Available for new recipes</label><button class="primary" type="submit">Save category</button></form>`);}
async function access(){
 state.tab='access';const people=await api('access');shell(`<section class="recipe-card"><h2>Recipe permissions</h2><p class="recipe-muted">Only owners can approve recipes or change these permissions. Kitchen viewers receive production recipes, packaging and equipment; costs, supplier contacts, private notes and testing logs stay hidden.</p>${people.map(p=>`<div class="recipe-resource-row"><div><strong>${esc(p.email)}</strong><small class="recipe-muted" style="display:block">${p.role==='owner'?'Owner · full access':'Staff account'}</small></div>${p.role==='owner'?'':`<label>Recipe access<select data-access-user="${p.user_id}"><option value="">No access</option><option value="kitchen" ${p.recipe_permission==='kitchen'?'selected':''}>Kitchen · view production</option><option value="chef" ${p.recipe_permission==='chef'?'selected':''}>Chef · edit drafts & tests</option></select></label>`}</div>`).join('')}</section>`);
}
async function versions(offset=0){
 state.historyOffset=offset;const rows=await api('versions',{id:state.record.id,limit:100,offset});state.versions=rows;
 setDialog('Version history',`<p class="recipe-muted">Restoring creates a new draft. Every previous formula stays available.</p>${rows.map(v=>`<div class="recipe-resource-row"><div><strong>Version ${v.number}</strong> · ${esc(v.status)}<p class="recipe-muted">${date(v.created_at)} · ${esc(v.author||'Former account')} · ${esc(v.reason||'No change note')}</p></div><div class="recipe-actions">${button('Compare','compare-version',`data-version="${v.id}"`)}${button('Restore','restore-version',`data-version="${v.id}"`)}${button('Duplicate','duplicate-version',`data-version="${v.id}"`)}</div></div>`).join('')}<div class="recipe-actions">${button('Newer versions','history-page',`data-offset="${Math.max(0,offset-100)}" ${offset===0?'disabled':''}`)}${button('Older versions','history-page',`data-offset="${offset+100}" ${rows.length<100?'disabled':''}`)}</div>`);
}
async function tests(){
 const rows=await api('tests',{id:state.record.id,limit:100});state.tests=rows;
 setDialog('Testing & R&D',`<div class="recipe-actions">${button('+ New test','add-test')}</div>${rows.map(t=>`<div class="recipe-resource-row"><div><strong>Test #${t.number}</strong> · ${esc(t.data.date||date(t.created_at))}<p>${esc(t.data.result||t.data.observations||'No result entered')}</p><small class="recipe-muted">${t.promoted_version_id?'Promoted to a saved recipe version':'Separate from the saved production recipe'}</small></div><div class="recipe-actions">${button('View / edit','edit-test',`data-id="${t.id}"`)}${isOwner()&&!t.promoted_version_id?button('Promote','promote-test',`data-id="${t.id}"`):''}</div></div>`).join('')||'<p class="recipe-empty">Record your first test without changing the approved formula.</p>'}`);
}
function testEditor(t=null){
 state.testEditing=t;const d=t?.data||{},locked=Boolean(t?.promoted_version_id);state.testDraftPhotos=structuredClone(d.photos||[]);
 setDialog(t?`Test #${t.number}`:'New test',`<form id="recipe-test-form"><div class="recipe-fields two"><label>Test date<input name="date" type="date" value="${esc(d.date||new Date().toLocaleDateString('en-CA'))}" ${locked?'disabled':''}></label><label>Rating · 0 to 5<input name="rating" type="number" min="0" max="5" step="0.5" value="${esc(d.rating??'')}" ${locked?'disabled':''}></label>${[['Changes made','changes'],['Bake settings','bake_settings'],['Ingredient changes','ingredient_changes'],['Observations','observations'],['Result','result'],['Next test','next_test']].map(([label,key])=>`<label class="wide">${label}<textarea name="${key}" ${locked?'disabled':''}>${esc(d[key])}</textarea></label>`).join('')}</div><p class="recipe-muted">This test starts with the recipe version you are viewing. Save the log, then use “Edit tested formula” to record the exact tested quantities before promotion.</p><div class="recipe-photos" data-test-photos></div>${locked?'':button('+ Test photo','test-photo')}${locked?'':`<div class="recipe-actions"><button class="primary" type="submit">Save test log</button>${t?button('Edit tested formula','edit-test-formula',`data-id="${t.id}"`):''}</div>`}</form>`);renderTestPhotos().catch(showError);
}
async function costPreview(){
 const snapshot=state.editing?(await api('cost_preview',{document:state.doc})).snapshot:state.record.cost_snapshot;
 const captured=snapshot?.variants?.find(v=>v.variant_id===state.doc.variants[state.variant].id);
 if(captured){setDialog('Recipe costing',`<p class="recipe-muted">${state.editing?'Draft preview with current ingredient prices.':'Historical prices captured with this version.'} Linked component costs use their pinned versions.</p>${!captured.complete?'<div class="recipe-notice">Partial cost: prices or conversions are missing.</div>':''}<div class="recipe-yield"><span>Batch ${money(captured.total)}</span>${captured.per_yield?`<span>Per ${esc(state.doc.variants[state.variant].yield.unit)} ${money(captured.per_yield)}</span>`:''}${captured.per_portion?`<span>Per portion ${money(captured.per_portion)}</span>`:''}</div><table class="recipe-table"><thead><tr><th>Ingredient / component / additional cost</th><th>Cost · PHP</th></tr></thead><tbody>${captured.lines.map(l=>`<tr><td>${esc(l.name||l.row_id)}</td><td class="numeric">${money(l.amount)}</td></tr>`).join('')}${captured.missing.map(l=>`<tr><td>${esc(l.name)}</td><td>${esc(l.reason)}</td></tr>`).join('')}</tbody></table><p class="recipe-muted">Selling prices remain separate.</p>`);return;}
 const v=state.doc.variants[state.variant],cost=costRecipe(v.groups,{additional:v.additional_costs||[],portions:v.yield.portions,currency:state.doc.currency||'PHP'});
 setDialog('Recipe costing',`<p class="recipe-muted">${state.editing?'Draft preview. Linked ingredient prices are refreshed and captured when you save.':'Uses the purchase prices recorded in this recipe version.'}</p>${!cost.complete?`<div class="recipe-notice">This is a partial cost. ${cost.missing.length} ingredients need prices or unit conversions.</div>`:''}<div class="recipe-yield"><span>Batch ${money(cost.total)}</span>${cost.per_portion?`<span>Per portion ${money(cost.per_portion)}</span>`:''}</div><table class="recipe-table"><thead><tr><th>Ingredient</th><th>Cost · PHP</th></tr></thead><tbody>${cost.lines.map(l=>`<tr><td>${esc(l.name)}</td><td class="numeric">${money(l.cost)}</td></tr>`).join('')}${cost.missing.map(m=>`<tr><td>${esc(m.name)}</td><td>${esc(m.reason)}</td></tr>`).join('')}</tbody></table><p class="recipe-muted">Additional costs: ${money(v.additional_costs.reduce((sum,c)=>sum+Number(c.amount||0),0))}. Selling prices are not changed by recipe costs.</p>`);
}
async function uploadPhoto(attrs){
 const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';
 input.addEventListener('change',async()=>{try{
  if(!input.files[0])return;notify('Preparing and uploading photo…');const file=await prepareProductImage(input.files[0]);const record=await uploadRecipeFile(file);
  const photo={id:model.id(),file_id:record.id,purpose:attrs.purpose,caption:''};state.doc.files.push({...record,visibility:'kitchen'});
  if(attrs.purpose==='product')state.doc.photos.push(photo);
  else if(attrs.purpose==='packaging')state.doc.variants[state.variant].packaging.photos.push(photo);
  else {state.doc.variants[state.variant].methods[Number(attrs.method)].steps[Number(attrs.step)].image_id=record.id;state.doc.variants[state.variant].photos.push(photo);}
  markDirty();renderEditor();notify('Photo uploaded. Save the recipe to attach it to this version.');
 }catch(error){showError(error);}});input.click();
}
async function saveRecipe(){
 const errors=model.validateRecipe(state.doc);if(errors.length){setDialog('Check these recipe fields',`<ul>${errors.map(e=>`<li>${esc(e)}</li>`).join('')}</ul>`);return;}
 // Empty optional costing inputs do not turn an uncosted ingredient into zero cost.
 for(const v of state.doc.variants)for(const g of v.groups)for(const row of g.ingredients)if(row.cost_snapshot&&!Object.values(row.cost_snapshot).some(Boolean))delete row.cost_snapshot;
 const status=root.querySelector('#recipe-save-status').value;state.pendingSaveStatus=status;
 setDialog(state.testFormula?'Save tested formula':status==='production'?'Publish production version':'Save recipe version',`<form id="recipe-save-form"><p>${state.testFormula?'This updates the testing log’s proposed formula. The main recipe remains unchanged.':status==='production'?'This new version will become the recipe used by kitchen staff. Previous versions remain available.':'Your changes will be saved as a new version.'}</p><label>What changed? · optional<textarea name="reason" placeholder="e.g. Adjusted bake time after test #12"></textarea></label><div class="recipe-actions"><button class="primary" type="submit">${state.testFormula?'Save tested formula':'Confirm save'}</button></div></form>`);
}
async function performSave(form){
 clearTimeout(autosaveTimer);await pendingAutosave.catch(()=>{});
 const reason=new FormData(form).get('reason')||'';
 if(state.testFormula){
  const t=state.testFormula;
  await api('save_test',{id:t.id,recipe_id:t.recipe_id,version_id:t.version_id,revision:t.revision,data:t.data,proposed_document:state.doc});state.testFormula=null;
  state.editing=false;state.dirty=false;closeDialog();await openRecipe(t.recipe_id);notify('Tested formula saved. Production recipe unchanged.');return;
 }
 const record=await api(state.record?'save':'create',{id:state.record?.id,revision:state.record?.revision,document:state.doc,status:state.pendingSaveStatus,reason});
 clearTimeout(autosaveTimer);await api('remove_draft',{draft_id:state.draftId}).catch(()=>{});state.record=record;state.doc=model.normalizeRecipe(record.document);state.editing=false;state.dirty=false;closeDialog();renderRecipe();notify(`Version ${record.version} saved.`);
}
function move(array,from,to){if(to<0||to>=array.length)return;const [item]=array.splice(from,1);array.splice(to,0,item);}
async function action(name,a={}){
 const v=state.doc?.variants[state.variant];
 if(name==='tab'){if(!await leaveEditor())return;state.resourceQuery='';if(a.tab==='library')return library();if(a.tab==='categories')return categories();if(a.tab==='access')return access();if(a.tab==='backups'){state.tab='backups';shell('<div id="recipe-backups"></div>');const m=await import('./recipe-backups.js');return m.mountRecipeBackups(root.querySelector('#recipe-backups'));}return resources(a.tab);}
 if(name==='library'){if(await leaveEditor())return library();return;}
 if(name==='new'){if(await leaveEditor()){state.testFormula=null;beginEdit();}return;}
 if(name==='open')return openRecipe(a.id);
 if(name==='edit'){state.testFormula=null;beginEdit(state.record);return;}
 if(name==='page'){state.offset=Number(a.offset);return library();}
 if(name==='favorite'||name==='pin'){await api('favorite',{id:a.id,favorite:a.favorite==='true',pinned:a.pinned==='true'});return library();}
 if(name==='save')return saveRecipe();
 if(name==='upload')return uploadPhoto(a);
 if(name==='add-variant'){state.doc.variants.push(model.variant(`Size ${state.doc.variants.length+1}`));state.variant=state.doc.variants.length-1;}
 else if(name==='duplicate-variant'){state.doc.variants.push(model.freshVariant(v));state.variant=state.doc.variants.length-1;}
 else if(name==='remove-variant'){if(!await confirmDialog('Remove this size from the working draft?',{danger:true,confirmLabel:'Remove size'}))return;state.doc.variants.splice(state.variant,1);state.variant=0;}
 else if(name==='add-group')v.groups.push(model.group());
 else if(name==='remove-group'){if(!await confirmDialog('Remove this ingredient group from the draft?',{danger:true,confirmLabel:'Remove group'}))return;v.groups.splice(Number(a.group),1);}
 else if(name==='add-ingredient')v.groups[Number(a.group)].ingredients.push(model.ingredient());
 else if(name==='remove-ingredient'){const row=v.groups[Number(a.group)].ingredients[Number(a.row)];if(row.name&&!await confirmDialog(`Remove ${row.name} from this draft?`,{confirmLabel:'Remove ingredient',danger:true}))return;v.groups[Number(a.group)].ingredients.splice(Number(a.row),1);}
 else if(name==='move-ingredient')move(v.groups[Number(a.group)].ingredients,Number(a.row),Number(a.row)+Number(a.direction));
 else if(name==='add-method')v.methods.push(model.method());
 else if(name==='remove-method'){if(!await confirmDialog('Remove this method section?',{danger:true,confirmLabel:'Remove section'}))return;v.methods.splice(Number(a.method),1);}
 else if(name==='add-step')v.methods[Number(a.method)].steps.push(model.step());
 else if(name==='remove-step')v.methods[Number(a.method)].steps.splice(Number(a.step),1);
 else if(name==='move-step')move(v.methods[Number(a.method)].steps,Number(a.step),Number(a.step)+Number(a.direction));
 else if(name==='add-stage')v.baking.push(model.stage());
 else if(name==='remove-stage')v.baking.splice(Number(a.index),1);
 else if(name==='add-equipment')v.equipment.push({id:model.id(),name:'',notes:''});
 else if(name==='remove-equipment')v.equipment.splice(Number(a.index),1);
 else if(name==='link-packaging-cost'){const rows=(await api('resources',{kind:'packaging',limit:100})).rows;state.packagingChoices=rows;setDialog('Link packaging cost',rows.map(r=>`<div class="recipe-resource-row"><span>${esc(r.name)}${r.price?` · ${money(r.price.amount)} / ${esc(r.price.quantity)} ${esc(r.price.unit)}`:''}</span>${button('Use item','choose-packaging-cost',`data-id="${r.id}"`)}</div>`).join('')||'<p>Add packaging items in the Packaging section first.</p>');return;}
 else if(name==='choose-packaging-cost'){const r=state.packagingChoices.find(r=>r.id===a.id);v.additional_costs.push({id:model.id(),name:'Packaging',resource_id:r.id,resource_name:r.name,quantity:'1',unit:r.data.default_unit||r.price?.unit||'pc',amount:'0',per_batch:true});closeDialog();}
 else if(name==='add-cost')v.additional_costs.push({id:model.id(),name:'Packaging',amount:'0',per_batch:true});
 else if(name==='remove-cost')v.additional_costs.splice(Number(a.index),1);
 else if(name==='remove-component'){if(!await confirmDialog('Remove this component link from the working draft?',{confirmLabel:'Remove component',danger:true}))return;v.components.splice(Number(a.index),1);}
 else if(name==='remove-photo'){
  state.doc.photos=state.doc.photos.filter(p=>p.file_id!==a.fileId);
  v.photos=v.photos.filter(p=>p.file_id!==a.fileId);v.packaging.photos=v.packaging.photos.filter(p=>p.file_id!==a.fileId);for(const m of v.methods)for(const step of m.steps)if(step.image_id===a.fileId)delete step.image_id;
  const used=state.doc.photos.some(p=>p.file_id===a.fileId)||state.doc.variants.some(size=>size.photos.some(p=>p.file_id===a.fileId)||size.packaging.photos.some(p=>p.file_id===a.fileId)||size.methods.some(m=>m.steps.some(step=>step.image_id===a.fileId)));
  if(!used)state.doc.files=state.doc.files.filter(f=>f.id!==a.fileId);
 }
 else if(name==='link-component'){
  setDialog('Link a component recipe','<p class="recipe-muted">Choose a production recipe. Its exact version is retained until you adopt a newer one.</p><label>Search components<input type="search" data-component-search></label><div data-component-results></div>');await findComponents('');return;
 }else if(name==='choose-component'){
  const r=await api('get',{id:a.id,kitchen:true});state.componentChoice=r;setDialog('Choose component size',r.document.variants.map(size=>`<div class="recipe-resource-row"><span>${esc(size.name)} · ${esc(size.yield.quantity)} ${esc(size.yield.unit)}</span>${button('Use size','attach-component',`data-variant="${size.id}"`)}</div>`).join(''));return;
 }else if(name==='attach-component'){const r=state.componentChoice,size=r.document.variants.find(v=>v.id===a.variant);v.components.push({id:model.id(),name:r.document.name,version_id:r.version_id,variant_id:size.id,quantity:size.yield.quantity,unit:size.yield.unit,mode:'pinned'});closeDialog();
 }else if(name==='update-component'){
  const c=v.components[Number(a.index)],related=state.record?.links.find(l=>l.version_id===c.version_id);if(!related)throw Error('Save this link first to check for an update.');const latest=await api('get',{id:related.recipe_id,kitchen:true});if(latest.version_id===c.version_id){notify('This component already uses the current production version.');return;}if(!latest.document.variants.some(size=>size.id===c.variant_id))throw Error('The original size was removed. Link the new component size explicitly.');if(!await confirmDialog(`Adopt ${latest.document.name} version ${latest.version} in this working draft? Save a new recipe version to publish the change.`,{confirmLabel:'Adopt version'}))return;c.version_id=latest.version_id;
 }else if(name==='open-component'){
  const r=await api('get',{id:a.id,version_id:a.version,kitchen:state.kitchen});setDialog(r.document.name,`<p>Saved component version ${r.version}</p>${r.document.variants.map(v=>`<h3>${esc(v.name)} · ${esc(v.yield.quantity)} ${esc(v.yield.unit)}</h3>${v.groups.map(g=>`<h3>${esc(g.name)}</h3><table class="recipe-table">${g.ingredients.map(row=>`<tr><td>${esc(row.name)}</td><td class="numeric">${esc(row.quantity)} ${esc(row.unit)}</td></tr>`).join('')}</table>`).join('')}`).join('')}`);return;
 }else if(name==='cost-preview')return costPreview();
 else if(name==='versions')return versions();
 else if(name==='history-page')return versions(Number(a.offset));
 else if(name==='compare-version'){
  const old=await api('get',{id:state.record.id,version_id:a.version}),changes=model.differences(old.document,state.doc);setDialog(`Version ${old.version} → ${state.record.version}`,`<div class="recipe-table-wrap"><table class="recipe-table recipe-diff"><thead><tr><th>Field</th><th>Earlier value</th><th>Current value</th></tr></thead><tbody>${changes.map(c=>`<tr><td>${esc(c.field)}</td><td>${esc(typeof c.before==='object'?JSON.stringify(c.before):c.before)}</td><td>${esc(typeof c.after==='object'?JSON.stringify(c.after):c.after)}</td></tr>`).join('')||'<tr><td colspan="3">No formula differences.</td></tr>'}</tbody></table></div>`);return;
 }else if(name==='restore-version'){
  if(!await confirmDialog('Restore this version as a new draft? The production recipe stays unchanged.',{confirmLabel:'Restore as draft'}))return;
  const r=await api('restore_version',{version_id:a.version,revision:state.record.revision,status:'draft',reason:'Restored historical version'});closeDialog();return openRecipe(r.id);
 }else if(['duplicate','variation','duplicate-version'].includes(name)){
  const r=await api('duplicate',{version_id:a.version||state.record.version_id,mode:name==='variation'?'variation':'exact'});closeDialog();beginEdit(r);notify('Created a separate draft with a new recipe ID.');return;
 }else if(name==='scaled-copy'){const doc=model.scaledCopy(state.doc,v.id,scaleFactor(v.yield,state.scale.mode,state.scale.target),state.scale);beginEdit(null,doc);notify('Review this scaled copy, then save it as a new recipe.');return;}
 else if(name==='reset-checks'){for(const g of v.groups)for(const row of g.ingredients)sessionStorage.removeItem(checkKey(row.id));for(const m of v.methods)for(const s of m.steps)sessionStorage.removeItem(checkKey(s.id));renderRecipe();return;}
 else if(name==='test-photo')return uploadTestPhoto();
 else if(name==='tests')return tests();
 else if(name==='runs')return productionHistory();
 else if(name==='add-test'){testEditor();return;}
 else if(name==='edit-test'){testEditor(state.tests.find(t=>t.id===a.id));return;}
 else if(name==='edit-test-formula'){const t=state.tests.find(t=>t.id===a.id);state.testFormula=t;closeDialog();beginEdit(state.record,t.proposed_document||state.record.document);return;}
 else if(name==='promote-test'){
  if(!await confirmDialog('Publish this test’s saved formula as the new production version?',{confirmLabel:'Promote test'}))return;
  const r=await api('promote_test',{test_id:a.id,revision:state.record.revision,status:'production',reason:'Promoted successful R&D test'});closeDialog();return openRecipe(r.id);
 }else if(name==='delete'){
  if(!await confirmDialog('Move this recipe to Recently deleted? Historical versions and backups are retained.',{confirmLabel:'Remove recipe',danger:true}))return;
  await api('delete',{id:state.record.id,revision:state.record.revision});return library();
 }else if(name==='undelete'){await api('undelete',{id:state.record.id,revision:state.record.revision});return openRecipe(state.record.id);}
 else if(name==='add-resource')return resourceEditor();
 else if(name==='edit-resource')return resourceEditor(state.resources.find(r=>r.id===a.id));
 else if(name==='price-history'){const rows=await api('prices',{id:a.id,limit:100});setDialog('Purchase price history',`<table class="recipe-table"><thead><tr><th>Recorded</th><th>Price</th><th>Purchase quantity</th></tr></thead><tbody>${rows.map(p=>`<tr><td>${date(p.created_at)}</td><td>${money(p.amount)}</td><td>${esc(p.quantity)} ${esc(p.unit)}</td></tr>`).join('')}</tbody></table>`);return;}
 else if(name==='add-category'){categoryEditor();return;}
 else if(name==='edit-category'){categoryEditor(state.categories.find(c=>c.id===a.id));return;}
 else if(name==='drafts'){
  const drafts=await api('drafts',{limit:100});state.drafts=drafts;setDialog('Recover a working draft',drafts.map(d=>`<div class="recipe-resource-row"><div>${esc(d.document.name||'Untitled recipe')}<small class="recipe-muted" style="display:block">${date(d.updated_at)}</small></div>${button('Open draft','recover-draft',`data-id="${d.draft_id}"`)}</div>`).join('')||'<p>No working drafts to recover.</p>');return;
 }else if(name==='recover-draft'){
  const draft=state.drafts.find(d=>d.draft_id===a.id),record=draft.recipe_id?await api('get',{id:draft.recipe_id}):null;
  if(record&&record.revision!==draft.base_revision){setDialog('The saved recipe has changed','<p>This draft started from an older version. Recover it as a separate recipe to avoid overwriting newer work.</p>'+button('Recover as new recipe','recover-draft-copy',`data-id="${a.id}"`));return;}
  closeDialog();beginEdit(record,draft.document);state.draftId=draft.draft_id;state.dirty=true;return;
 }else if(name==='recover-draft-copy'){const draft=state.drafts.find(d=>d.draft_id===a.id);closeDialog();beginEdit(null,draft.document);return;}
 else if(name==='filters'){setDialog('More recipe filters',`<form id="recipe-filter-form"><div class="recipe-fields two">${canEdit()?`<label>Author<select name="author"><option value="">All authors</option>${(state.authors||[]).map(a=>`<option value="${a.id}" ${state.filters.author===a.id?'selected':''}>${esc(a.name)}</option>`).join('')}</select></label>`:''}${[['Tag','tag'],['Flavor','flavor'],['Product line','product_line'],['Version number','version'],['Updated since','updated_after']].map(([label,key])=>`<label>${label}<input name="${key}" type="${key==='updated_after'?'date':'text'}" value="${esc(state.filters[key]||'')}"></label>`).join('')}</div><button type="submit" class="primary">Apply filters</button></form>`);return;}
 else if(name==='csv'){const plan=await currentProductionPlan();download(model.csvTotals(plan.totals),`${state.doc.name}-ingredients.csv`,'text/csv;charset=utf-8');return;}
 else if(name==='production-totals')return showProductionTotals();
 else if(name==='compare-base'){const link=state.record.links.find(l=>l.kind==='variation');if(!link)throw Error('Variation base was not found.');const base=await api('get',{id:link.recipe_id,version_id:link.version_id});const changes=model.differences(base.document,state.doc).filter(c=>!c.field.startsWith('base.')&&!c.field.startsWith('detected_allergens'));setDialog(`Changes from ${base.document.name} · version ${base.version}`,`<table class="recipe-table recipe-diff"><thead><tr><th>Field</th><th>Base</th><th>Variation</th></tr></thead><tbody>${changes.map(c=>`<tr><td>${esc(c.field)}</td><td>${esc(JSON.stringify(c.before))}</td><td>${esc(JSON.stringify(c.after))}</td></tr>`).join('')}</tbody></table>`);return;}
 else if(name==='export'||name==='export-library'){const m=await import('./recipe-print.js');return m.openRecipeExport({record:name==='export'?state.record:null,production:name==='export'?{variant_id:v.id,factor:exact(scaleFactor(v.yield,state.scale.mode,state.scale.target)),mode:state.scale.mode,target:state.scale.target,wholeComponents:state.wholeComponents}:null,selection:[...state.selection],filters:state.filters,kitchen:state.kitchen,settings:state.settings,api,fileUrl:recipeFileUrl,dialog:setDialog});}
 else if(name==='import'){const m=await import('./recipe-import.js');return m.openRecipeImport({dialog:setDialog,close:closeDialog,beginEdit,upload:uploadRecipeFile,notify});}
 else return;
 markDirty();renderEditor();
}
function download(text,filename,type){const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}

// Event handlers are attached once; rendering does not accumulate listeners.
async function handleClick(event){
 const target=event.target.closest('[data-action]');if(!target||target.disabled)return;
 target.disabled=true;try{await action(target.dataset.action,target.dataset);}catch(error){showError(error);}finally{if(target.isConnected)target.disabled=false;}
}
root.addEventListener('click',handleClick);dialogBody.addEventListener('click',handleClick);
root.addEventListener('submit',event=>{if(event.target.id==='recipe-editor'){event.preventDefault();saveRecipe().catch(showError);}});
root.addEventListener('input',event=>{
 const el=event.target;
 if(el.dataset.photoCaption){for(const photo of [...state.doc.photos,...state.doc.variants.flatMap(v=>[...v.photos,...v.packaging.photos])])if(photo.id===el.dataset.photoCaption)photo.caption=el.value;markDirty();}
 else if(el.dataset.path){setPath(state.doc,el.dataset.path,el.dataset.array?el.value.split(',').map(s=>s.trim()).filter(Boolean):el.value);markDirty();
  if(/\.ingredients\.\d+\.name$/.test(el.dataset.path)){clearTimeout(ingredientSearchTimer);ingredientSearchTimer=setTimeout(async()=>{try{
   const result=await api('resources',{kind:'ingredient',query:el.value,limit:20});state.ingredientSuggestions=result.rows;
   const list=root.querySelector('#recipe-ingredients');if(list)list.innerHTML=result.rows.map(r=>`<option value="${esc(r.data.brand?r.name+' · '+r.data.brand:r.name)}">${esc(r.data.brand||r.data.default_unit||'')}</option>`).join('');
  }catch(error){showError(error);}},250);}
 }else if(el.matches('[data-filter="query"]')){clearTimeout(state.searchTimer);state.searchTimer=setTimeout(()=>{state.filters.query=el.value;state.offset=0;library().catch(showError);},400);}
 else if(el.hasAttribute('data-resource-search')){clearTimeout(state.searchTimer);state.searchTimer=setTimeout(()=>{state.resourceQuery=el.value;resources(state.tab).catch(showError);},400);}
});
root.addEventListener('change',async event=>{const el=event.target;try{
 if(el.dataset.photoCaption){for(const photo of [...state.doc.photos,...state.doc.variants.flatMap(v=>[...v.photos,...v.packaging.photos])])if(photo.id===el.dataset.photoCaption)photo.caption=el.value;markDirty();}
 else if(el.dataset.path){setPath(state.doc,el.dataset.path,el.dataset.array?el.value.split(',').map(s=>s.trim()).filter(Boolean):el.value);markDirty();
  if(/\.ingredients\.\d+\.name$/.test(el.dataset.path)){const row=getPath(state.doc,el.dataset.path.replace(/\.name$/,'')),match=state.ingredientSuggestions?.find(r=>(r.data.brand?r.name+' · '+r.data.brand:r.name)===el.value);if(match){row.name=match.name;row.ingredient_id=match.id;row.unit=match.data.default_unit||row.unit;row.brand=match.data.brand||'';if(match.price)row.cost_snapshot={...match.price,amount:String(match.price.amount),quantity:String(match.price.quantity)};renderEditor();}else{if(row.ingredient_id){delete row.cost_snapshot;row.brand='';}delete row.ingredient_id;}}
 }else if(el.hasAttribute('data-whole-components')){state.wholeComponents=el.checked;}
 else if(el.hasAttribute('data-allergen-override')){state.doc.allergen_override=el.checked;markDirty();}
 else if(el.hasAttribute('data-import-reviewed')){state.doc.import_review.reviewed=el.checked;markDirty();}
 else if(el.dataset.filter&&el.dataset.filter!=='query'){const key=el.dataset.filter;if(key==='collection'){delete state.filters.favorites;delete state.filters.pinned;delete state.filters.recent;delete state.filters.deleted;if(el.value)state.filters[el.value]=true;}else state.filters[key]=el.value;state.offset=0;await library();}
 else if(el.dataset.select){if(el.checked)state.selection.add(el.dataset.select);else state.selection.delete(el.dataset.select);}
 else if(el.hasAttribute('data-editor-variant')){state.variant=Number(el.value);renderEditor();}
 else if(el.hasAttribute('data-view-variant')){state.variant=Number(el.value);state.scale.target='1';state.scale.mode='multiplier';renderRecipe();}
 else if(el.dataset.scale){state.scale[el.dataset.scale]=el.value;renderRecipe();}
 else if(el.dataset.check){sessionStorage.setItem(checkKey(el.dataset.check),el.checked?'1':'0');}
 else if(el.dataset.accessUser){await api('save_access',{user_id:el.dataset.accessUser,permission:el.value||null});notify('Recipe access updated.');}
 }catch(error){showError(error);}});
root.addEventListener('dragstart',event=>{const handle=event.target.closest('.recipe-drag'),row=handle?.closest('[data-ingredient-row]');if(!row)return;draggedRow={group:Number(row.dataset.group),row:Number(row.dataset.ingredientRow)};event.dataTransfer.setData('text/plain',String(draggedRow.row));event.dataTransfer.effectAllowed='move';row.classList.add('dragging');});
root.addEventListener('dragover',event=>{const row=event.target.closest('[data-ingredient-row]');if(row&&draggedRow?.group===Number(row.dataset.group)){event.preventDefault();row.classList.add('drag-over');}});
root.addEventListener('dragleave',event=>event.target.closest('[data-ingredient-row]')?.classList.remove('drag-over'));
root.addEventListener('drop',event=>{const row=event.target.closest('[data-ingredient-row]');if(!row||draggedRow?.group!==Number(row.dataset.group))return;event.preventDefault();move(state.doc.variants[state.variant].groups[draggedRow.group].ingredients,draggedRow.row,Number(row.dataset.ingredientRow));draggedRow=null;markDirty();renderEditor();});
root.addEventListener('dragend',()=>{draggedRow=null;root.querySelectorAll('.dragging,.drag-over').forEach(r=>r.classList.remove('dragging','drag-over'));});
dialogBody.addEventListener('submit',async event=>{
 const form=event.target;if(!['recipe-save-form','recipe-resource-form','recipe-category-form','recipe-test-form','recipe-filter-form','recipe-run-form'].includes(form.id))return;event.preventDefault();const submit=form.querySelector('[type=submit]');submit.disabled=true;
 try{const f=Object.fromEntries(new FormData(form));
  if(form.id==='recipe-save-form')await performSave(form);
  else if(form.id==='recipe-resource-form'){
   const record=state.resourceEditing,data={...(record?.data||{})};for(const [key,value]of Object.entries(f))if(!['name','active'].includes(key)&&!key.startsWith('price_'))data[key]=key==='allergens'?value.split(',').map(s=>s.trim()).filter(Boolean):value;
   const payload={id:record?.id,revision:record?.revision,kind:state.tab,name:f.name,data,active:f.active==='on'};
   if(f.price_amount!==undefined&&f.price_amount!=='')payload.price={amount:f.price_amount,quantity:f.price_quantity,unit:f.price_unit,currency:'PHP',supplier_id:f.price_supplier||null};
   await api('save_resource',payload);closeDialog();await resources(state.tab);notify('Record saved.');
  }else if(form.id==='recipe-category-form'){await api('save_category',{id:state.categoryEditing.id,...f,active:f.active==='on'});state.categories=(await api('bootstrap')).categories;closeDialog();await categories();}
  else if(form.id==='recipe-test-form'){const t=state.testEditing;await api('save_test',{id:t?.id,revision:t?.revision,recipe_id:state.record.id,version_id:t?.version_id||state.record.version_id,data:{...(t?.data||{}),...f,photos:state.testDraftPhotos},proposed_document:t?.proposed_document||state.record.document});await tests();notify('Test log saved.');}
  else if(form.id==='recipe-run-form'){await api('record_run',{...f,scaling_mode:state.scale.mode,version_id:state.record.version_id,variant_id:state.doc.variants[state.variant].id,multiplier:exact(scaleFactor(state.doc.variants[state.variant].yield,state.scale.mode,state.scale.target))});await productionHistory();notify('Production quantity recorded.');}
  else if(form.id==='recipe-filter-form'){Object.assign(state.filters,f);state.offset=0;closeDialog();await library();}
 }catch(error){showError(error);}finally{if(submit.isConnected)submit.disabled=false;}
});
document.querySelector('[data-dialog-close]').addEventListener('click',closeDialog);
window.addEventListener('beforeunload',event=>{if(state.editing&&state.dirty){event.preventDefault();event.returnValue='';}});

async function boot(){
 await ready;
 if(!auth){shell('<div class="recipe-empty"><h1>Recipe library unavailable</h1><p>Check your connection and reload.</p></div>',{tabs:false});return;}
 const {data:{session}}=await auth.getSession();
 if(!session){shell('<div class="recipe-empty"><h1>Your private recipe library</h1><p>Sign in with an authorized account to continue.</p><a class="recipe-button" href="account.html?next=recipes.html">Sign in</a></div>',{tabs:false});return;}
 try{const setup=await api('bootstrap');Object.assign(state,setup);if(state.role==='kitchen')state.kitchen=true;await library();}
 catch(error){shell(`<div class="recipe-empty"><h1>Recipe access required</h1><p>${esc(error.message)}</p><a class="recipe-button" href="account.html">My account</a></div>`,{tabs:false});}
}
boot().catch(showError);
ready.then(()=>auth?.onAuthStateChange?.(event=>{if(event==='SIGNED_OUT'){state.doc=null;state.record=null;state.role=null;state.fileUrls.clear();state.editing=false;state.dirty=false;clearTimeout(autosaveTimer);closeDialog();boot().catch(showError);}}));

async function currentProductionPlan(){
 const v=state.doc.variants[state.variant];
 return model.productionPlan(state.record,v.id,scaleFactor(v.yield,state.scale.mode,state.scale.target),{wholeComponents:state.wholeComponents,loadRecipe:async(link,parent)=>{
  const related=parent.links.find(l=>l.version_id===link.version_id);if(!related)throw Error('A saved component link is missing.');return api('get',{id:related.recipe_id,version_id:link.version_id,kitchen:state.kitchen});
 }});
}
async function showProductionTotals(){
 const plan=await currentProductionPlan();
 setDialog('Production ingredient totals',`<p class="recipe-muted">Combined ingredients include linked component recipes. Quantities remain exact.</p><table class="recipe-table"><thead><tr><th>Ingredient</th><th>Prepare</th></tr></thead><tbody>${plan.totals.map(r=>`<tr><td>${esc(r.name)}${r.brand?` · ${esc(r.brand)}`:''}</td><td class="numeric">${esc(r.display)} ${esc(r.unit)}</td></tr>`).join('')}</tbody></table>${plan.components.length?`<h3>Component preparation</h3><table class="recipe-table"><thead><tr><th>Component</th><th>Required</th><th>Batches</th><th>Left over</th></tr></thead><tbody>${plan.components.map(c=>`<tr><td>${esc(c.name)} · v${c.version}</td><td>${esc(c.required)} ${esc(c.unit)}</td><td>${esc(c.batches)}</td><td>${esc(c.leftover)} ${esc(c.unit)}</td></tr>`).join('')}</tbody></table>`:''}`);
}

async function renderTestPhotos(){
 const target=dialogBody.querySelector('[data-test-photos]');if(!target)return;target.replaceChildren();
 for(const file of state.testDraftPhotos){const img=document.createElement('img');img.alt='R&D test photo';img.src=await recipeFileUrl(file.path);if(target.isConnected)target.append(img);}
}
function uploadTestPhoto(){
 const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp,image/heic,image/heif';
 input.addEventListener('change',async()=>{try{if(!input.files[0])return;const file=await prepareProductImage(input.files[0]),uploaded=await uploadRecipeFile(file);state.testDraftPhotos.push(uploaded);await renderTestPhotos();notify('Photo ready. Save the testing log to attach it.');}catch(error){showError(error);}});input.click();
}

async function productionHistory(){
 const rows=await api('runs',{id:state.record.id,limit:100}),v=state.doc.variants[state.variant],factor=exact(scaleFactor(v.yield,state.scale.mode,state.scale.target));
 setDialog('Production history',`${['approved','production'].includes(state.record.status)?`<form id="recipe-run-form"><h3>Record a completed batch</h3><p>Version ${state.record.version} · ${esc(v.name)} · multiplier ×${factor}</p><div class="recipe-fields two"><label>Produced on<input name="produced_on" type="date" required value="${new Date().toLocaleDateString('en-CA')}"></label><label>Actual finished yield · ${esc(v.yield.unit)}<input name="actual_yield" inputmode="decimal" required></label><label class="wide">Production notes<textarea name="notes"></textarea></label></div><p class="recipe-muted">This adds a production record without changing the recipe.</p><button type="submit" class="primary">Record production</button></form>`:'<p class="recipe-muted">Open an approved or production version to record a completed batch.</p>'}<h3>Recorded batches</h3><table class="recipe-table"><thead><tr><th>Date</th><th>Planned</th><th>Actual</th><th>Notes</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.produced_on)}</td><td>${esc(r.planned_yield)} ${esc(r.yield_unit)}</td><td>${esc(r.actual_yield)} ${esc(r.yield_unit)}</td><td>${esc(r.notes)}</td></tr>`).join('')||'<tr><td colspan="4">No batches recorded yet.</td></tr>'}</tbody></table>`);
}

async function findComponents(query){
 const target=dialogBody.querySelector('[data-component-results]'),result=await api('list',{kitchen:true,query,limit:30});if(!target?.isConnected)return;
 target.innerHTML=result.rows.filter(r=>r.id!==state.record?.id).map(r=>`<div class="recipe-resource-row"><span>${esc(r.name)} · v${r.version}</span>${button('Link','choose-component',`data-id="${r.id}"`)}</div>`).join('')+`<p class="recipe-muted">${result.total} matches. Refine the search to find any production recipe.</p>`;
}
let componentSearchTimer;
dialogBody.addEventListener('input',event=>{if(event.target.hasAttribute('data-component-search')){clearTimeout(componentSearchTimer);const query=event.target.value;componentSearchTimer=setTimeout(()=>findComponents(query).catch(showError),250);}});

root.addEventListener('keydown',event=>{if(event.altKey&&event.key==='Enter'&&event.target.closest('[data-ingredient-row]')){event.preventDefault();const gi=Number(event.target.closest('[data-ingredient-row]').dataset.group);state.doc.variants[state.variant].groups[gi].ingredients.push(model.ingredient());markDirty();renderEditor();root.querySelector(`[data-group="${gi}"][data-ingredient-row="${state.doc.variants[state.variant].groups[gi].ingredients.length-1}"] input`)?.focus();}});
