import {costingEditor,costSummaryMarkup,openCosting,costingOverviewMarkup,costingOverviewRows} from './recipe-costing.js?v=refinement-20261002-1';
import {recipeStatuses,recipeStatus,recipeStatusLabel} from './recipe-status.js?v=approved-ux-1';
import {mountKitchenReader} from './recipe-kitchen.js?v=approved-ux-1';
import {createKitchenGuard,kitchenLockMarkup} from './recipe-kitchen-guard.js?v=staff-security-1';
import {ready,auth,recipeApi as callRecipeApi,uploadRecipeFile,recipeFileUrl} from './client.js?v=approved-20261002-1';
import {mountSupplierQuotes} from './recipe-suppliers.js?v=refinement-20261002-1';
import {configureRecipeUnits,unitOptions,unitOptionsMarkup} from './recipe-units.js?v=refinement-20261002-1';
import {allRecipeSuppliers} from './recipe-catalog.js?v=approved-20261002-1';
import {resourceTableMarkup,sortResourceRows} from './recipe-resource-table.js?v=refinement-20261002-1';
import {recipeLoadingMarkup} from './recipe-loading.js?v=approved-ux-1';
import {confirmDialog} from './site-dialog.js?v=brand-20261001';
import {prepareProductImage} from './product-image.js?v=approved-20261002-1';
import * as model from './recipe-model.js?v=approved-20261002-1';
import {componentEditor} from './recipe-component-editor.js?v=approved-20261002-1';
import {mountTestWorkspace} from './recipe-rd-workspace.js?v=approved-ux-1';
import {ingredientPickerMarkup,mountIngredientPicker} from './recipe-ingredient-picker.js?v=refinement-20261002-1';
import {addRecipePackaging,packagingEditor,packagingReferenceMarkup,packagingItems,packagingPhotos,packagingLegacyText,replacePackagingPhotos} from './recipe-packaging.js?v=approved-20261002-1';
import {quantity,exact,scaleFactor,scaleIngredients,displayQuantity,ingredientTotals,multiply,scaledYield,componentPlan,scalingOptions,initialScale} from './recipe-math.js?v=approved-20261002-1';

import {arrangeEditor,arrangeReader,arrangeCosting,currentCostMarkup,allowanceMarkup,fillLibraryCosts} from './recipe-refinement.js?v=refinement-20261002-1';
import {purchaseDraft} from './recipe-purchase.js?v=refinement-20261002-1';

const root=document.querySelector('#recipe-main'),dialog=document.querySelector('#recipe-dialog'),dialogBody=document.querySelector('#recipe-dialog-body');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(label,action,extra='',cls='')=>`<button type="button" data-action="${action}" ${extra} class="${cls}">${label}</button>`;
const money=value=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(typeof value==='object'?Number(value.n)/Number(value.d):Number(value||0));
const date=value=>value?new Date(value).toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric'}):'—';
const state={role:null,categories:[],settings:{},tab:'library',rd:new URLSearchParams(location.search).get('view')==='rd',can_view_rd:false,kitchen:new URLSearchParams(location.search).get('view')==='kitchen',
 filters:{},offset:0,limit:24,selection:new Set(),record:null,doc:null,variant:0,editing:false,dirty:false,draftId:null,
 scale:{mode:'multiplier',target:'1',rounding:'exact',step:'1'},wholeComponents:false,fileUrls:new Map(),resources:[],request:0};
let noticeTimer,autosaveTimer,draggedRow,pendingAutosave=Promise.resolve();
const readActions=new Set(['costing_settings','recipe_units','library_costs','purchase_preview','bootstrap','list','get','resources','prices','versions','tests','drafts','access','runs','costing','cost_preview','costing_overview','component_plan','export','export_data','access_check','staff_overview','staff_activity','scale','export_authorize','client_security_event']);
function invalidateLibrary(){state.libraryView=null;state.libraryStamp=null;}
function clearFileUrls(){for(const file of state.fileUrls.values())if(file.url?.startsWith('blob:'))URL.revokeObjectURL(file.url);state.fileUrls.clear();}
function clearPrivateView(){
 purchaseDraft.clear(state.userId);configureRecipeUnits();
 state.authEpoch=(state.authEpoch||0)+1;state.request++;state.resourceRequest++;invalidateLibrary();
 state.doc=null;state.record=null;state.testWorkspace=null;state.testDraftPhotos=[];state.tests=[];state.versions=[];state.resources=[];state.costOverviewData=null;clearFileUrls();state.selection.clear();state.filters={};state.costFilters={};state.categories=[];
 state.staffAccessController?.dispose();state.staffAccessController=null;state.staffAccessState=null;
 state.drafts=[];state.resourcePhotos=[];state.accessPeople=[];state.packagingChoices=[];state.resourceEditing=null;state.testEditing=null;state.categoryEditing=null;state.componentChoice=null;state.draftId=null;
 ingredientPicker.clear();state.editing=false;state.dirty=false;clearTimeout(autosaveTimer);clearTimeout(state.searchTimer);clearTimeout(state.costSearchTimer);closeDialog();dialogBody.replaceChildren();root.replaceChildren();document.querySelector('.recipe-print-root')?.remove();document.querySelector('#recipe-print-page-style')?.remove();
}
async function api(action,payload={}){
 const epoch=state.authEpoch||0,started=performance.now();if(!readActions.has(action))invalidateLibrary();
 let result;try{result=await callRecipeApi(action,payload);if(result?.error){const error=Error(result.message);Object.assign(error,result);throw error;}}
 catch(error){if(epoch===(state.authEpoch||0)){kitchenGuard.failure(error);if(/R&D access/.test(error.message))queueMicrotask(()=>kitchenGuard.check());}throw error;}
 if(epoch!==(state.authEpoch||0))throw Error('Your recipe session changed. Sign in again.');
 if(action!=='bootstrap'&&result?.access&&!kitchenGuard.accept(result,started))throw Error('Kitchen Recipe access must be verified again.');
 if(!readActions.has(action)&&(/^(staff_|save_access|save_rd_access)/.test(action)))kitchenGuard.changed();
 return result;
}
function librarySignature(){return JSON.stringify([state.userId,state.role,state.can_view_rd,state.kitchen,state.rd,state.filters,state.offset]);}
function rememberLibrary(){
 // Search debounces belong to their list view, never the opened recipe or editor.
 clearTimeout(state.searchTimer);clearTimeout(state.costSearchTimer);
 if(state.role==='kitchen')return;
 persistResourceView();
 if(!root.querySelector('.recipe-library')||!state.libraryStamp)return;
 const query=root.querySelector('[data-filter="query"]')?.value||'';
 if(query!==(state.filters.query||'')){state.filters.query=query;state.offset=0;invalidateLibrary();return;}
 state.libraryView={nodes:[...root.childNodes],scroll:window.scrollY,focus:document.activeElement,signature:librarySignature()};
}
const ingredientPicker=mountIngredientPicker(root,{api,getRow:input=>getPath(state.doc,input.dataset.path.replace(/\.name$/,'')),onChange:markDirty});
const kitchenGuard=createKitchenGuard({call:callRecipeApi,getState:()=>state,notify,
 onLock(reason,policy){
  if(['recipe_denied','rd_denied'].includes(reason))state.resumeKitchen=null;
  else if(state.record)state.resumeKitchen={id:state.record.root_id||state.record.id,rd:state.rd};
  clearPrivateView();state.access=policy;shell(kitchenLockMarkup(reason,policy,esc),{tabs:false});
 },
 async onResume(){
  const resume=state.resumeKitchen;if(state.record)state.resumeKitchen={id:state.record.root_id||state.record.id,rd:state.rd};
  clearPrivateView();await startRecipeLibrary({resume:state.resumeKitchen||resume});
 },
 async onPermissionChange(setup){
  clearPrivateView();state.role=setup.role;state.can_view_rd=Boolean(setup.can_view_rd);if(!canRD())state.rd=false;state.resumeKitchen=null;
  state.kitchen=state.role==='kitchen'||new URLSearchParams(location.search).get('view')==='kitchen';await startRecipeLibrary();
 }
});
state.resourceDensity='compact';state.resourceSort='az';state.resourceRequest=0;state.resourceOffset=0;state.resourceTotal=0;state.resourceLimit=100;state.resourceViews={};state.listViews={};
try{if(localStorage.getItem('tlb-recipe-resource-density-v1')==='comfortable')state.resourceDensity='comfortable';}catch{}
function notify(message,error=false) {
 const node=document.querySelector('#recipe-notice');node.textContent=message;node.setAttribute('role',error?'alert':'status');
 clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{node.textContent='';},error?12000:6000);
}
function showError(error){const message=error.message||'The request could not be completed.';if(dialog.open){let alert=dialogBody.querySelector('[data-dialog-error]');if(!alert){alert=document.createElement('p');alert.dataset.dialogError='';alert.className='recipe-error';alert.setAttribute('role','alert');dialogBody.prepend(alert);}alert.textContent=message;}else notify(message,true);}
function setDialog(title,body){dialog.classList.remove('recipe-cost-sheet');document.querySelector('#recipe-dialog-title').textContent=title;dialogBody.innerHTML=body;if(!dialog.open)dialog.showModal();}
const closeDialog=()=>dialog.close();
const canEdit=()=>state.role!=='kitchen'&&!state.kitchen;
const canRD=()=>state.role==='owner'||state.can_view_rd===true;
const canEditRecord=()=>canEdit()&&!state.record?.rd_restricted;
const isOwner=()=>state.role==='owner'&&!state.kitchen;
const statusOptions=(value,owner=true)=>(owner?recipeStatuses:recipeStatuses.filter(([key])=>key==='draft'||(key==='testing'&&canRD()))).map(([key,label])=>`<option value="${key}" ${key===recipeStatus(value)?'selected':''}>${label}</option>`).join('');
function updateNavigation(){
 const nav=document.querySelector('.recipe-header nav'),brand=document.querySelector('.recipe-header .brand');
 if(!nav)return;
 nav.innerHTML=`${state.role&&state.role!=='kitchen'?(state.kitchen?'<a class="recipe-button primary" href="recipes.html">Back to recipe admin</a>':'<a href="recipes.html?view=kitchen">Kitchen view</a>'):''}${canRD()&&state.role==='kitchen'?`<div class="kitchen-recipe-switch" role="group" aria-label="Recipe collection">${button('Final','kitchen-scope',`data-view="final" aria-pressed="${!state.rd}"`)}${button('R&D','kitchen-scope',`data-view="rd" aria-pressed="${state.rd}"`)}</div>`:''}${state.role==='owner'?'<a href="manage.html">Admin dashboard</a>':''}<a href="account.html">Account</a>`;
 if(brand)brand.href=state.role==='owner'?'manage.html':'recipes.html';
 document.body.classList.toggle('recipe-kitchen-view',Boolean(state.kitchen||state.role==='kitchen'));
 document.body.classList.toggle('recipe-staff-protected',state.role==='kitchen');
}
function shell(content,{tabs=true,heading='',retainFilters=false}={}) {
 const retained=retainFilters?root.querySelector('.recipe-filters'):null,active=retained?.contains(document.activeElement)?document.activeElement:null,caret=active?.selectionStart;
 ingredientPicker.close();
 const loading=content.includes('data-recipe-loading'),wasLoading=root.getAttribute('aria-busy')==='true';
 root.classList.toggle('recipe-loading-ready',wasLoading&&!loading);
 if(loading)root.setAttribute('aria-busy','true');else root.removeAttribute('aria-busy');
 root.classList.toggle('recipe-production',state.kitchen||state.role==='kitchen');updateNavigation();
 document.body.classList.toggle('recipe-staff-access-view',Boolean(tabs&&heading));
 root.innerHTML=`${tabs?`${heading||`<div class="recipe-toolbar"><div><div class="recipe-eyebrow">Your kitchen reference</div><h1>${state.rd?'R&D recipes':state.kitchen?'Production recipes':'Recipes & costing'}</h1><p class="recipe-muted">${state.rd?'Research formulas for review. These recipes are still in development.':state.kitchen?'Final recipes, ready for the kitchen. Changes here do not edit your recipes.':'Your formulas, testing notes and production knowledge, kept together.'}</p></div>${canEdit()?`<div class="recipe-actions">${button(purchaseDraft.read(state.userId)?'Resume purchase':'Record purchase','record-purchase')}${button('+ New recipe','new','','primary')}</div>`:''}</div>`}<nav class="recipe-tabs" aria-label="Recipe sections">${[['library','Recipes'],...(canEdit()?[['costing','Costing'],['ingredient','Ingredients & supplies'],['manage','Manage']]:[])].map(([key,label])=>button(label,'tab',`data-tab="${key}" ${(state.tab===key||key==='ingredient'&&state.tab==='packaging'||key==='manage'&&['supplier','units','equipment','categories','staff-access','backups'].includes(state.tab))?'aria-current="page"':''}`)).join('')}</nav>${canEdit()&&['ingredient','packaging'].includes(state.tab)?`<div class="recipe-supply-tabs">${[['ingredient','Ingredients'],['packaging','Packaging']].map(([key,label])=>button(label,'tab',`data-tab="${key}" ${state.tab===key?'aria-current="page"':''}`)).join('')}</div>`:''}${canEdit()&&['supplier','units','equipment','categories','staff-access','backups'].includes(state.tab)?`<div class="recipe-manage-back">${button('← Manage','tab','data-tab="manage"')}</div>`:''}`:''}${content}`;
 if(retained&&root.querySelector('.recipe-filters')){root.querySelector('.recipe-filters').replaceWith(retained);if(active){active.focus({preventScroll:true});if(caret!=null)active.setSelectionRange(caret,caret);}}
}
function getPath(object,path){return path.split('.').reduce((v,k)=>v?.[k],object);}
function setPath(object,path,value){const keys=path.split('.');if(keys.some(k=>['__proto__','prototype','constructor'].includes(k)))throw Error('Invalid field.');let node=object;for(const k of keys.slice(0,-1))node=node[k]??(node[k]={});node[keys.at(-1)]=value;}
function field(label,path,{type='text',wide=false,options=null,placeholder='',rows=3,list='',readonly=false}={}) {
 const raw=getPath(state.doc,path),value=Array.isArray(raw)?raw.join(', '):raw??'';
 const common=`data-path="${esc(path)}" ${Array.isArray(raw)?'data-array="true"':''} ${readonly?'readonly':''}`;
 if(!options&&/\.ingredients\.\d+\.unit$/.test(path))options=unitOptions(value);
 const input=options?`<select ${common}>${options.map(([v,t])=>`<option value="${esc(v)}" ${String(v)===String(value)?'selected':''}>${esc(t)}</option>`).join('')}</select>`:
 type==='textarea'?`<textarea ${common} rows="${rows}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`:
 `<input type="${type}" ${common} value="${esc(value)}" placeholder="${esc(placeholder)}" ${list?`list="${list}"`:''}>`;
 return `<label class="${wide?'wide':''}">${esc(label)}${input}</label>`;
}
function markDirty(){state.dirty=true;const status=root.querySelector('[data-save-status]');if(status)status.textContent=state.testWorkspace?'Unsaved test changes · Save test keeps formula and observations together':'Unsaved changes';clearTimeout(autosaveTimer);if(!state.testWorkspace)autosaveTimer=setTimeout(saveDraft,1200);}
function syncSectionName(el){
 if(/\.groups\.\d+\.name$/.test(el.dataset.path||'')){
  const section=el.closest('[data-component-editor]');if(!section)return;section.querySelector('[data-component-heading]').textContent=el.value;
  const link=root.querySelector(`.recipe-editor-outline a[href="#${section.id}"]`);if(link)link.textContent=el.value||'Component';
  for(const option of root.querySelectorAll('[data-method-group] option'))if(option.value===section.dataset.componentEditor)option.textContent=el.value;
 }else if(/\.methods\.\d+\.name$/.test(el.dataset.path||'')){const title=el.closest('[data-method-editor]')?.querySelector('h3');if(title)title.textContent=el.value||'Procedure';}
}
async function saveDraft(){
 if(!state.editing||!state.doc||state.testWorkspace)return;const captured=state.draftId;
 try {pendingAutosave=api('autosave',{draft_id:captured,id:state.record?.id,revision:state.record?.revision,status:state.saveStatus,document:state.doc});await pendingAutosave;
  if(state.draftId===captured){const status=root.querySelector('[data-save-status]');if(status)status.textContent='Working copy backed up. Click Save to keep these changes.';}
  return true;
 }catch(error){const status=root.querySelector('[data-save-status]');if(status)status.textContent=`Draft could not be saved: ${error.message}`;return false;}
}
async function leaveEditor(){
 if(!state.editing)return true;
 if(state.dirty&&!await confirmDialog(state.testWorkspace?'Leave without saving these test changes? Save test keeps the formula and observations together.':'Your working draft is separate from the saved recipe. Leave this editor?',{confirmLabel:'Leave editor'}))return false;
 clearTimeout(autosaveTimer);if(state.dirty&&!state.testWorkspace&&!await saveDraft())return false;state.editing=false;state.dirty=false;state.testWorkspace=null;return true;
}
async function library({reuse=false,scroll=null}={}){
 clearTimeout(state.searchTimer);
 const previousScroll=scroll??(root.querySelector('.recipe-filters')&&root.querySelector('.recipe-library')?window.scrollY:state.listViews.library?.scroll||0);
 if(state.role==='kitchen'){state.doc=null;state.resumeKitchen=null;clearFileUrls();if(kitchenGuard.locked)return;}
 state.record=null;state.editing=false;state.tab='library';const request=++state.request;
 const retained=state.libraryView;
 if(reuse&&retained?.signature===librarySignature()){
  shell('<p role="status">Returning to your results…</p>',{tabs:false});
  try{
   const {data:{session}}=await auth.getSession(),setup=await api('bootstrap');
   if(request!==state.request)return;
   if(session?.user?.id===state.userId&&setup.role===state.role&&Boolean(setup.can_view_rd)===Boolean(state.can_view_rd)&&retained===state.libraryView){
    state.categories=setup.categories;state.settings=setup.settings;state.global_allowance=setup.global_allowance;configureRecipeUnits(setup.settings?.recipe_units);state.authors=setup.authors;root.replaceChildren(...retained.nodes);updateNavigation();
    requestAnimationFrame(()=>{if(request!==state.request)return;retained.focus?.focus({preventScroll:true});window.scrollTo(0,retained.scroll);});return;
   }
   clearPrivateView();state.userId=session?.user?.id;Object.assign(state,setup);configureRecipeUnits(setup.settings?.recipe_units);state.kitchen=setup.role==='kitchen'||new URLSearchParams(location.search).get('view')==='kitchen';if(!canRD())state.rd=false;state.offset=0;return library();
  }catch(error){invalidateLibrary();state.doc=null;state.role=null;state.costOverviewData=null;state.resources=[];closeDialog();shell(`<section class="recipe-empty"><h1>Recipe access required</h1><p>${esc(error.message)}</p><a class="recipe-button" href="account.html">My account</a></section>`,{tabs:false});return;}
 }
 invalidateLibrary();
 if(!root.querySelector('.recipe-library'))shell(recipeLoadingMarkup());else root.setAttribute('aria-busy','true');
 let data;try{data=await api('list',{...state.filters,offset:state.offset,limit:state.limit,kitchen:state.kitchen,rd:state.rd});}catch(error){if(request===state.request&&state.tab==='library')sectionLoadError(error);return;}
 if(request!==state.request||state.tab!=='library')return;
 if(state.offset>0&&state.offset>=data.total){state.offset=Math.max(0,Math.floor((data.total-1)/state.limit)*state.limit);return library({scroll:previousScroll});}
 shell(`<div class="recipe-filters"><label>Find a recipe or ingredient<input type="search" data-filter="query" value="${esc(state.filters.query||'')}" placeholder="Search your recipes"></label>
  <label>Category<select data-filter="category_id"><option value="">All categories</option>${state.categories.filter(c=>!c.deleted_at).map(c=>`<option value="${c.id}" ${state.filters.category_id===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label>
  ${!state.kitchen?`<label>Status<select data-filter="status"><option value="">Active recipes</option>${recipeStatuses.filter(([key])=>key!=='testing'||canRD()).map(([key,label])=>`<option value="${key}" ${state.filters.status===key?'selected':''}>${label}</option>`).join('')}</select></label>`:''}
  <label>Collection<select data-filter="collection"><option value="">All recipes · A–Z</option><option value="favorites" ${state.filters.favorites?'selected':''}>Favorites</option><option value="pinned" ${state.filters.pinned?'selected':''}>Pinned recipes</option><option value="recent" ${state.filters.recent?'selected':''}>Recently used</option>${isOwner()?`<option value="deleted" ${state.filters.deleted?'selected':''}>Recently deleted</option>`:''}</select></label></div>
  <div class="recipe-toolbar"><span class="recipe-muted">${data.total} recipes${state.selection.size?` · ${state.selection.size} selected`:''}</span><div class="recipe-actions">${button('Refresh results','refresh-library')}${button('More filters','filters')}${state.role!=='kitchen'?button('Print / export','export-library'):''}${canEdit()?button('Recover working draft','drafts'):''}</div></div>
  <div class="recipe-library">${data.rows.length?data.rows.map(r=>`<article class="recipe-card"><header><span class="recipe-badge ${esc(r.status)}">${recipeStatusLabel(r.status)}</span>${state.role!=='kitchen'?`<label class="recipe-inline-check"><input type="checkbox" data-select="${r.id}" aria-label="Select ${esc(r.name)}" ${state.selection.has(r.id)?'checked':''}></label>`:''}</header><h2>${esc(r.name)}</h2>${canEdit()?`<div class="recipe-library-cost" data-library-cost="${r.id}"><span>Loading current cost…</span></div>`:''}<div class="recipe-muted">${esc(r.code)} · Version ${r.version}<br>Updated ${date(r.updated_at)}</div><div class="recipe-actions">${button(r.deleted_at?'View deleted recipe':'Open recipe','open',`data-id="${r.id}"`,'primary')}${canEdit()&&!r.deleted_at&&!r.rd_restricted?button('Edit','edit-open',`data-id="${r.id}"`):''}${button(r.favorite?'★':'☆','favorite',`data-id="${r.id}" data-favorite="${!r.favorite}" data-pinned="${Boolean(r.pinned)}" aria-label="${r.favorite?'Remove favorite':'Favorite recipe'}"`)}${button(r.pinned?'Unpin':'Pin','pin',`data-id="${r.id}" data-favorite="${Boolean(r.favorite)}" data-pinned="${!r.pinned}"`)}</div></article>`).join(''):`<div class="recipe-empty"><h2>No recipes here yet</h2><p>${state.role==='kitchen'?'No authorized recipes match these filters. Contact an Administrator if a recipe is missing.':'Create a recipe or adjust your filters.'}</p></div>`}</div>
  <div class="recipe-pagination">${button('Previous','page',`data-offset="${Math.max(0,state.offset-state.limit)}" ${state.offset===0?'disabled':''}`)}<span class="recipe-muted">${data.total?`${state.offset+1}–${Math.min(state.offset+state.limit,data.total)} of ${data.total}`:'0 recipes'}</span>${button('Next','page',`data-offset="${state.offset+state.limit}" ${state.offset+state.limit>=data.total?'disabled':''}`)}</div>`,{retainFilters:true});
 if(canEdit()){fillLibraryCosts(root,data.rows,api);showWorkingDraft(request);}
 state.libraryStamp=librarySignature();
 if(request===state.request)window.scrollTo(0,previousScroll);persistResourceView();
}
async function showWorkingDraft(request){
 try{const drafts=await api('drafts',{limit:1});if(request!==state.request||state.tab!=='library'||state.editing||!drafts.length)return;state.drafts=drafts;
  const banner=document.createElement('div');banner.className='recipe-draft-banner';banner.innerHTML=`<span>Unfinished recipe: <strong>${esc(drafts[0].document.name||'Untitled recipe')}</strong></span>${button('Resume working draft','recover-draft',`data-id="${drafts[0].draft_id}"`)}`;root.querySelector('.recipe-filters')?.before(banner);
 }catch{/* Draft recovery remains available through the explicit recovery action. */}
}
function beginEdit(record=null,document=null,testWorkspace=null){
 if(record?.rd_restricted)throw Error('R&D access is required to edit this recipe.');
 if(testWorkspace&&!canRD())throw Error('R&D access is required to use test logs.');
 rememberLibrary();state.request++;
 ingredientPicker.clear();
 state.testWorkspace=testWorkspace;
 state.record=record;state.doc=model.normalizeRecipe(document||record?.document||model.blankRecipe());
 // Resolve old, unambiguous associations in this working copy before names
 // change. Opening the editor never rewrites an approved recipe version.
 for(const v of state.doc.variants)for(const m of v.methods)if(!Object.hasOwn(m,'group_id'))m.group_id=model.methodGroupId(v,m);
 state.variant=0;state.editorSection='ingredients';state.editing=true;state.dirty=false;state.saveStatus=isOwner()?recipeStatus(record?.status):record?.status==='testing'?'testing':'draft';state.draftId=model.id();renderEditor();
}
function scalingEditor(v,p){
 const options=v.yield.scale_options||[];
 return `<section class="recipe-form-section recipe-scaling-editor"><div class="recipe-section-head"><h3>Scale by options</h3>${button('+ Scaling option','add-scaling-option',options.length>=12?'disabled':'')}</div><p class="recipe-muted">Name each way you want to scale this size, and enter the amount made by one base batch. For example: Yield · 1 cake, or Pcs · 12 pieces.</p>${options.map((option,index)=>`<div class="recipe-scaling-option"><div class="recipe-fields">${field('Scale by',`${p}.yield.scale_options.${index}.label`,{placeholder:'Yield, Pcs, Trays…'})}${field('Base amount',`${p}.yield.scale_options.${index}.quantity`)}${field('Unit',`${p}.yield.scale_options.${index}.unit`,{placeholder:'cakes, pcs, g…'})}</div>${button('Remove option','remove-scaling-option',`data-index="${index}"`,'danger')}</div>`).join('')}${options.length?field('Default scaling option',`${p}.yield.scale_default`,{options:[['multiplier','Multiplier'],...options.map(option=>['custom:'+option.id,option.label||'Unnamed option'])]}):'<p class="recipe-muted">The standard scaling options are available until you define your own.</p>'}</section>`;
}
function yieldReviewMarkup(v){
 const review=model.yieldReview(v);
 return '<section class="recipe-card"><h3>Raw weight & yield check</h3><p>'+esc(review.raw_weight)+' g of ingredients entered by mass'+(review.complete?'.':' · partial: other units or linked components need an explicit weight.')+'</p><p class="recipe-muted">Raw ingredient weight excludes packaging and equipment. Finished weight and expected loss are recorded separately; blank loss is unknown.</p>'+review.warnings.map(message=>'<p class="recipe-notice" role="status">'+esc(message)+'</p>').join('')+'</section>';
}
async function costingOverview({scroll=null}={}){
 const previousScroll=scroll??(root.querySelector('.recipe-cost-overview')?window.scrollY:state.listViews.costing?.scroll||0);
 state.tab='costing';state.record=null;state.editing=false;const ticket=++state.request;state.costFilters??={};
 if(!root.querySelector('.recipe-cost-overview'))shell(recipeLoadingMarkup({rows:true}));else root.setAttribute('aria-busy','true');
 try{const data=await api('costing_overview',{...state.costFilters,mode:state.costFilters.mode||'all',source:'current',limit:24});if(ticket!==state.request||state.tab!=='costing'||state.editing||state.record)return;if(state.costFilters.offset>0&&state.costFilters.offset>=data.total){state.costFilters.offset=Math.max(0,Math.floor((data.total-1)/24)*24);return costingOverview({scroll:previousScroll});}state.costOverviewData=data;state.global_allowance=data.global_allowance;shell(allowanceMarkup(data.global_allowance,isOwner())+costingOverviewMarkup(data,state.costFilters,state.categories,{button,canViewRD:canRD()}),{retainFilters:true});bindSharedAllowance();arrangeCosting(root);if(ticket===state.request)window.scrollTo(0,previousScroll);persistResourceView();}
 catch(error){if(ticket===state.request&&state.tab==='costing')sectionLoadError(error);}
}
function bindSharedAllowance(){
 const form=root.querySelector('[data-shared-allowance]');if(!form)return;
 form.addEventListener('submit',async event=>{event.preventDefault();if(!form.reportValidity())return;const submit=form.querySelector('button'),status=form.querySelector('[data-allowance-status]');if(submit.disabled)return;submit.disabled=true;
  try{state.global_allowance=await api('save_costing_settings',{percent:form.elements.percent.value,revision:state.global_allowance.revision});await costingOverview();notify('Shared allowance applied to every recipe and size.');}
  catch(error){status.textContent=error.message;}finally{if(submit.isConnected)submit.disabled=false;}
 });
}
function manage(){
 state.tab='manage';state.record=null;state.editing=false;++state.request;
 const items=[['supplier','Suppliers','Saved suppliers and purchase prices'],['units','Units','Standard and custom purchase units'],['equipment','Equipment','Tools used in your recipes'],...(isOwner()?[['categories','Categories','Organize recipes and supplies'],['staff-access','Staff Access','People, permissions and activity'],['backups','Backups','Export, restore and scheduled backups']]:[])];
 shell(`<section class="recipe-card"><h2>Manage</h2><div class="recipe-management-grid">${items.map(([key,label,description])=>button(`${label}<small>${description}</small>`,'tab',`data-tab="${key}"`)).join('')}</div><div class="recipe-actions">${button('Import recipe','import')}</div></section>`);
}
async function manageUnits(){
 state.tab='units';state.record=null;state.editing=false;const ticket=++state.request;shell(recipeLoadingMarkup({rows:true}));
 try{const data=await api('recipe_units');if(ticket!==state.request||state.tab!=='units')return;configureRecipeUnits(data.units);state.settings.recipe_units=data.units;
  shell(`<section class="recipe-card"><h2>Units</h2><p class="recipe-muted">These units are available in ingredients, packaging and purchase forms. For a bag, bottle or pack, enter its contents when recording a purchase so costs can be compared.</p><div class="recipe-table-wrap"><table class="recipe-table"><thead><tr><th>Unit</th><th>Short label</th></tr></thead><tbody>${[['Grams','g'],['Kilograms','kg'],['Millilitres','ml'],['Pieces','pcs'],...data.units.map(u=>[u.name,u.symbol])].map(([name,symbol])=>`<tr><td>${esc(name)}</td><td>${esc(symbol)}</td></tr>`).join('')}</tbody></table></div><form data-add-unit><div class="recipe-fields two"><label>Unit name<input name="name" required maxlength="60" placeholder="Bag"></label><label>Short label<input name="symbol" required maxlength="16" placeholder="bag"></label></div><p data-unit-status role="status"></p><button class="primary" type="submit">Add unit</button></form></section>`);
  const form=root.querySelector('[data-add-unit]');form.addEventListener('submit',async event=>{event.preventDefault();if(!form.reportValidity())return;const submit=form.querySelector('button');submit.disabled=true;try{await api('save_recipe_unit',Object.fromEntries(new FormData(form)));await manageUnits();notify('Unit added. It is ready in your recipe and purchase forms.');}catch(error){form.querySelector('[data-unit-status]').textContent=error.message;}finally{if(submit.isConnected)submit.disabled=false;}});
 }catch(error){if(ticket===state.request)sectionLoadError(error);}
}
async function loadCurrentCostCard(factor,scalingMode){
 const host=root.querySelector('[data-saved-cost-card]'),record=state.record,variant=state.doc.variants[state.variant];if(!host)return;
 try{const data=await api('costing',{id:record.id,version_id:record.version_id,factor:exact(factor),scaling_mode:scalingMode,source:'current'});if(host.isConnected)host.innerHTML=currentCostMarkup(data.snapshot,data.snapshot.variants.find(v=>v.variant_id===variant.id));}
 catch(error){if(host.isConnected)host.innerHTML='<p class="recipe-error" role="alert">'+esc(error.message)+'</p>'+button('Retry costing','cost-preview');}
}
function renderEditor(){
 const d=state.doc,v=d.variants[state.variant],p=`variants.${state.variant}`;
 shell(`<div class="recipe-toolbar"><div><div class="recipe-eyebrow">${state.record?`Version ${state.record.version} · changes create a new version`:'New recipe'}</div><h1>${esc(d.name||'Untitled recipe')}</h1></div><div class="recipe-actions">${state.record?button('View saved recipe','view-saved'):''}${button('View cost summary','cost-preview')}${button(state.tab==='costing'?'Back to costing':state.libraryView?'Back to results':'Back to library',state.tab==='costing'?'return-costing':'library')}</div></div>
  <form id="recipe-editor">${d.import_review?`<section class="recipe-card"><h2>Review imported recipe</h2><p class="recipe-muted">Check quantities, units, yield and methods against the original source before marking this recipe Final.</p><label class="recipe-inline-check"><input type="checkbox" data-import-reviewed ${d.import_review.reviewed?'checked':''}>I have reviewed this imported formula and its yield.</label>${d.import_review.source_text?`<div class="recipe-actions">${button("Rebuild components from original import","rebuild-import")}</div>`:""}<details><summary>Original extracted text</summary><pre class="recipe-source-text">${esc(d.import_review.source_text)}</pre></details></section>`:''}<section class="recipe-card"><h2>Recipe details</h2><div class="recipe-fields">
  ${field('Recipe name','name',{wide:true})}${field('Category','category_id',{options:[['','Uncategorized'],...state.categories.filter(c=>c.active&&!c.deleted_at||c.id===state.doc.category_id).map(c=>[c.id,c.name])]})}${field('Flavor','flavor')}${field('Product line','product_line')}${field('Tags · separated by commas','tags',{wide:true})}${field('Short description','description',{type:'textarea',wide:true})}
  </div><details class="recipe-advanced"><summary>Allergens, critical notes and private notes</summary><div class="recipe-fields">
 ${field('Allergens · manual additions / override','allergens',{wide:true})}${field('Critical production notes','critical_notes',{type:'textarea',wide:true})}${field('Private notes · hidden in kitchen view','private_notes',{type:'textarea',wide:true})}</div><label class="recipe-inline-check"><input type="checkbox" data-allergen-override ${d.allergen_override?'checked':''}>Use only my manual allergen list</label><p class="recipe-muted">Otherwise, allergens from linked ingredients and components are included on save. Review the list; it is a kitchen reference, not a compliance certification.</p></details>
  <div class="recipe-section-head"><h3>Finished product photos</h3>${button('+ Photo','upload', 'data-purpose="product"')}</div>${photoMarkup(d.photos)}
  </section><section class="recipe-card"><div class="recipe-section-head"><h2>Size variants</h2><div class="recipe-actions">${button('+ Size','add-variant')}${button('Duplicate size','duplicate-variant')}${d.variants.length>1?button('Remove size','remove-variant','','danger'):''}</div></div>
  <label>Working size<select data-editor-variant>${d.variants.map((v,i)=>`<option value="${i}" ${i===state.variant?'selected':''}>${esc(v.name)}</option>`).join('')}</select></label><div class="recipe-fields two" style="margin-top:16px">${field('Size name',`${p}.name`)}${field('Base yield',`${p}.yield.quantity`)}${field('Yield unit',`${p}.yield.unit`)}${field('Pan / mold size',`${p}.yield.pan_size`)}</div><details class="recipe-yield-extra"><summary>Portions, weights & batch details</summary><div class="recipe-fields">${field('Number of portions',`${p}.yield.portions`)}${field('Portion weight · g',`${p}.yield.portion_weight`)}${field('Batch weight · g',`${p}.yield.batch_weight`)}${field('Finished weight · g',`${p}.yield.finished_weight`)}${field('Number of pans / molds',`${p}.yield.pans`)}${field('Expected loss · %',`${p}.yield.loss_percent`)}</div></details>${scalingEditor(v,p)}</section>
  ${yieldReviewMarkup(v)}${componentEditor(v,p,{field,button,ingredientEditor,photoMarkup})}
  <section class="recipe-card recipe-optional"><details ${v.components.length?'open':''}><summary>Reuse a saved component recipe <span class="recipe-muted">· optional</span></summary><div class="recipe-section-head"><h2>Linked components</h2>${button('+ Link recipe','link-component')}</div><p class="recipe-muted">Each component uses a saved version. New component versions must be adopted explicitly.</p>${v.components.map((c,i)=>`<div class="recipe-fields"><label>Component<input value="${esc(c.name||c.version_id)}" readonly></label>${field('Amount of component yield needed',`${p}.components.${i}.quantity`)}${field('Version tracking',`${p}.components.${i}.mode`,{options:[['pinned','Keep this version'],['latest','Show when a newer version is available']]})}</div><div class="recipe-actions">${button('Remove link','remove-component',`data-index="${i}"`,'danger')}${button('Check newer version','update-component',`data-index="${i}"`)}</div>`).join('')}</details></section>
  <section class="recipe-card recipe-optional"><details ${v.baking.length?'open':''}><summary>Baking & temperature settings <span class="recipe-muted">· optional</span></summary><div class="recipe-section-head"><h2>Baking & temperature stages</h2>${button('+ Stage','add-stage')}</div>${v.baking.map((s,i)=>`<div class="recipe-fields">${[['Stage name','name'],['Top heat · °C','top'],['Bottom heat setting · °C','bottom'],['Actual bottom heat · °C','actual_bottom'],['Fan setting','fan'],['Time · minutes','minutes'],['Core temperature · °C','core'],['Ingredient temperature · °C','ingredient_temperature'],['Batter temperature · °C','batter_temperature'],['Resting temperature · °C','resting_temperature'],['Cooling time · minutes','cooling_minutes'],['Freezing time · minutes','freezing_minutes']].map(([label,key])=>field(label,`${p}.baking.${i}.${key}`)).join('')}${field('Stage notes',`${p}.baking.${i}.notes`,{wide:true,type:'textarea'})}</div>${button('Remove stage','remove-stage',`data-index="${i}"`,'danger')}`).join('')}</details></section>
  <section class="recipe-card recipe-packaging-editor"><h2>Packaging, special equipment & notes</h2>${packagingEditor(v,p,{field,button,photoMarkup})}
  <div class="recipe-section-head"><h3>Special equipment</h3>${button('+ Equipment','add-equipment')}</div>${v.equipment.map((e,i)=>`<div class="recipe-fields two">${field('Equipment',`${p}.equipment.${i}.name`)}${field('Notes',`${p}.equipment.${i}.notes`)}</div>${button('Remove equipment','remove-equipment',`data-index="${i}"`,'danger')}`).join('')}
  ${field('Production notes',`${p}.production_notes`,{type:'textarea'})}</section>${costingEditor(v,p,{field,button,allowance:state.global_allowance})}
  <footer class="recipe-sticky-save"><span class="recipe-status-text" data-save-status>${state.dirty?'Unsaved changes':state.record?`Saved. ${state.record.production_version_id&&['draft','testing'].includes(state.saveStatus)?'Kitchen still uses the last Final. Choose Hidden to withdraw it.':'Continue editing, or view the recipe.'}`:'Save when ready. You can keep editing afterward.'}</span><div class="recipe-actions"><label>Status<select id="recipe-save-status">${statusOptions(state.saveStatus,isOwner())}</select></label>${button('Keep draft & close','keep-draft')}${button('Save','save','','primary')}</div></footer></form>`,{tabs:false});

 if(state.testWorkspace){
  const w=state.testWorkspace;root.querySelector('.recipe-toolbar .recipe-eyebrow').textContent=`R&D · ${w.record?`Test #${w.record.number}`:'New test'} · Source version ${w.source.version}`;
  const back=root.querySelector('[data-action="view-saved"]');if(back){back.dataset.action='exit-test';back.textContent='Back to recipe';}
  const footer=root.querySelector('.recipe-sticky-save');footer.innerHTML=`<span class="recipe-status-text" data-save-status>${state.dirty?'Unsaved test changes':w.record?'Saved test. Continue editing formula and observations.':'Separate test draft. Save test when ready.'}</span><div class="recipe-actions">${button('Save test','save','','primary')}</div>`;
  mountTestWorkspace(root,w,{button});renderTestPhotos().catch(showError);
 }
 if(!state.testWorkspace)arrangeEditor(root,state,{api,onError:showError});
 hydratePhotos();ingredientPicker.hydrate();
}
function ingredientEditor(p,gi,ri){
 const prefix=`${p}.groups.${gi}.ingredients.${ri}`,row=state.doc.variants[state.variant].groups[gi].ingredients[ri];
 return `<div class="recipe-ingredient-editor recipe-ingredient-compact" data-ingredient-row="${ri}" data-group="${gi}"><button type="button" class="recipe-drag" draggable="true" aria-label="Drag ingredient">⠿</button>${ingredientPickerMarkup(row,prefix)}${field('Quantity',`${prefix}.quantity`)}${field('Unit',`${prefix}.unit`)}<div class="recipe-row-buttons">${button('↑','move-ingredient',`data-group="${gi}" data-row="${ri}" data-direction="-1" aria-label="Move ingredient up" ${ri===0?'disabled':''}`)}${button('×','remove-ingredient',`data-group="${gi}" data-row="${ri}" aria-label="Remove ingredient"`,'danger')}</div><details class="recipe-ingredient-details"><summary>Details${row.notes?' · notes':''}</summary><div class="recipe-fields two">${field('Brand specified · reselect ingredient to change a linked brand',`${prefix}.brand`,{readonly:Boolean(row.ingredient_id)})}${field('Notes',`${prefix}.notes`)}${field('Rounding increment · optional',`${prefix}.rounding_step`)}</div></details></div>`;
}
function photoMarkup(photos=[],{editable=state.editing}={}){return `<div class="recipe-photos">${photos.map(p=>`<figure><img data-file-id="${esc(p.file_id)}" ${p.path?`data-file-path="${esc(p.path)}"`:''} alt="${esc(p.caption||p.purpose||'Recipe photo')}"><figcaption>${editable?`<label>Caption<input data-photo-caption="${esc(p.id)}" value="${esc(p.caption||'')}"></label>`:esc(p.caption||'')}${editable?button('Remove','remove-photo',`data-file-id="${esc(p.file_id)}"`):''}</figcaption></figure>`).join('')}</div>`;}
async function hydratePhotos(){
 const epoch=state.authEpoch||0,staff=state.role==='kitchen',record=state.record;
 for(const link of root.querySelectorAll('[data-attachment]')){const file=state.record?.files.find(f=>f.id===link.dataset.attachment);if(file)try{link.href=await recipeFileUrl(file.path);}catch(error){link.textContent+=' · could not load';}}
 for(const img of root.querySelectorAll('img[data-file-id]')) {
  const file=[...(record?.files||[]),...(state.doc?.files||[])].find(f=>f.id===img.dataset.fileId)||(img.dataset.filePath?{id:img.dataset.fileId,path:img.dataset.filePath}:null);if(!file||(staff?!file.id:!file.path))continue;
  try{let item=state.fileUrls.get(file.id);if(!item||performance.now()>item.expires){const url=await recipeFileUrl(staff?file.id:file.path,staff?{recipe_id:record.id,version_id:record.version_id,root_id:record.root_id,root_version:record.root_version,rd:state.rd}:null);if(epoch!==(state.authEpoch||0)||!img.isConnected){if(url.startsWith('blob:'))URL.revokeObjectURL(url);continue;}item={url,expires:performance.now()+12*60*1000};state.fileUrls.set(file.id,item);}if(img.isConnected&&epoch===(state.authEpoch||0))img.src=item.url;}catch{if(img.isConnected)img.alt='Photo could not be loaded. Reopen the recipe to retry.';}
 }
}
async function openRecipe(id){
 if(state.role==='kitchen'){clearFileUrls();state.resumeKitchen=null;}
 rememberLibrary();
 const request=++state.request;shell('<p role="status">Opening recipe…</p>',{tabs:false});
 const record=await api('get',{id,kitchen:state.kitchen,rd:state.rd});if(request!==state.request)return;state.record=record;state.doc=model.normalizeRecipe(record.document);state.variant=0;state.editing=false;state.scale=initialScale(state.doc.variants[0].yield);state.kitchenSection=null;state.kitchenPane='ingredients';renderRecipe();
}
function checkKey(row){return `tlb-recipe-check:${state.record.version_id}:${state.variant}:${row}`;}
function checked(row){try{return sessionStorage.getItem(checkKey(row))==='1';}catch{return false;}}
function readIngredientTable(g){
 return `<div class="recipe-table-wrap"><table class="recipe-table"><thead><tr><th>Ingredient</th><th class="numeric">Quantity needed</th></tr></thead><tbody>${g.ingredients.map(row=>{
  const shown=displayQuantity(row.scaled_quantity,{mode:state.scale.rounding==='whole'&&!['g','gram','grams'].includes(row.unit.toLowerCase())?'exact':state.scale.rounding,step:row.rounding_step||state.scale.step});
  return `<tr><td><label class="recipe-check"><input type="checkbox" data-check="${esc(row.id)}" ${checked(row.id)?'checked':''}><span>${esc(row.name)}${row.brand?`<small class="recipe-muted"> · ${esc(row.brand)}</small>`:''}${row.notes?`<small class="recipe-muted" style="display:block">${esc(row.notes)}</small>`:''}</span></label></td><td class="numeric" title="Exact: ${esc(exact(row.scaled_quantity))}">${shown.rounded?'≈ ':''}${esc(shown.text)} ${esc(row.unit)}</td></tr>`;
 }).join('')}</tbody></table></div>`;
}
function readProcedure(m,heading='h3'){
 const stepKey=(s,i)=>s.id||'legacy-step-'+state.doc.variants[state.variant].methods.indexOf(m)+'-'+i;
 return `<div class="recipe-procedure-view"><${heading}>${esc(m.name||'Procedure')}</${heading}>${m.steps.map((s,i)=>`<div class="recipe-method-step"><label class="recipe-check"><input type="checkbox" data-check="${esc(stepKey(s,i))}" ${checked(stepKey(s,i))?'checked':''}><span><strong>${i+1}.</strong> ${esc(s.instruction).replaceAll('\n','<br>')}</span></label>${s.timer_minutes||s.temperature||s.equipment?`<p class="recipe-step-meta">${[s.timer_minutes?`${s.timer_minutes} min`:'',s.temperature,s.equipment].filter(Boolean).map(esc).join(' · ')}</p>`:''}${s.warning?`<p class="recipe-step-meta">${esc(s.warning)}</p>`:''}${s.image_id?photoMarkup([{file_id:s.image_id,purpose:'Process photo'}]):''}</div>`).join('')}</div>`;
}

function renderRecipe(){
 const previousControls=root.querySelector('.recipe-kitchen-production');if(previousControls)state.kitchenQuantityOpen=previousControls.open;const previousRounding=root.querySelector('.recipe-kitchen-adjustments');if(previousRounding)state.kitchenRoundingOpen=previousRounding.open;
 const r=state.record,d=state.doc,v=d.variants[state.variant];let f=quantity('1'),scalingError='';
 try{f=scaleFactor(v.yield,state.scale.mode,state.scale.target);displayQuantity('1',{mode:state.scale.rounding,step:state.scale.step});}catch(error){scalingError=error.message;}
 const groups=scaleIngredients(v.groups,f);
 shell(`<div class="recipe-toolbar"><div><div class="recipe-eyebrow">${esc(r.code)} · Version ${r.version} · ${date(r.updated_at)}</div><h1>${esc(d.name)}</h1><span class="recipe-badge ${esc(r.status)}">${recipeStatusLabel(r.status)}</span></div><div class="recipe-actions">${button(state.tab==='costing'?'Back to costing':state.libraryView?'Back to results':'Library',state.tab==='costing'?'return-costing':'library')}${canEditRecord()?button('Edit recipe','edit'):''}${canEditRecord()&&canRD()?button('New test','add-test'):''}${state.role!=='kitchen'?button('Print / PDF','export',scalingError?'disabled':'')+button('Ingredient CSV','csv',scalingError?'disabled':''):''}${isOwner()&&!r.deleted_at?`<div class="recipe-status-control"><label>Status<select data-recipe-status>${statusOptions(r.status)}</select></label>${button('Set status','set-status')}</div>`:''}</div></div>
  ${r.status==='testing'?`<p class="recipe-notice">R&D recipe · ${r.production_version_id?'Production continues using the last Final recipe.':'Available for production after the owner marks it Final.'} Testing logs are kept separately.</p>`:''}
  ${r.deleted_at?`<div class="recipe-notice">This recipe is in Recently deleted. Its history remains available. ${button('Restore recipe','undelete')}</div>`:''}
  <div class="recipe-reader-reference"><p>${esc(d.description)}</p>${(d.allergen_override?d.allergens:[...(d.allergens||[]),...(d.detected_allergens||[])]).length?`<p class="recipe-muted recipe-allergens">Allergens: ${[...new Set(d.allergen_override?d.allergens:[...(d.allergens||[]),...(d.detected_allergens||[])])].map(esc).join(', ')}</p>`:''}${d.base?`<p class="recipe-muted">Variation of ${esc(d.base.name)} · saved base version ${button('Compare with base','compare-base')}</p>`:''}${photoMarkup(d.photos)}</div>
  <section class="recipe-card recipe-scale-card"><div class="recipe-scale"><label>Size<select data-view-variant>${d.variants.map((v,i)=>`<option value="${i}" ${i===state.variant?'selected':''}>${esc(v.name)}</option>`).join('')}</select></label><label>Scale by<select data-scale="mode">${scalingOptions(v.yield).map(([key,label])=>`<option value="${key}" ${state.scale.mode===key?'selected':''}>${label}</option>`).join('')}</select></label><label>${esc(v.yield.scale_options?.find(option=>'custom:'+option.id===state.scale.mode)?.unit?'Target · '+v.yield.scale_options.find(option=>'custom:'+option.id===state.scale.mode).unit:'Production quantity')}<input data-scale="target" inputmode="decimal" value="${esc(state.scale.target)}"></label><label>Display rounding<select data-scale="rounding">${[['exact','Exact quantities'],['whole','Whole grams'],['practical','Custom increment']].map(([key,label])=>`<option value="${key}" ${state.scale.rounding===key?'selected':''}>${label}</option>`).join('')}</select></label>${state.scale.rounding==='practical'?`<label>Rounding increment<input data-scale="step" value="${esc(state.scale.step)}"></label>`:''}</div>
  ${scalingError?`<p class="recipe-error">${esc(scalingError)}</p>`:''}<div class="recipe-yield" ${scalingError?'hidden':''}><span>Prepare: ${esc(scalingError?'':scaledYield(v.yield,f,state.scale).quantity)} ${esc(v.yield.unit)}</span><span>Multiplier ×${esc(exact(f))}</span>${state.scale.mode==='portion'?`<span>${esc(state.scale.target)} g per portion</span>`:''}${v.yield.pan_size?`<span>${esc(v.yield.pan_size)}</span>`:''}</div><p class="recipe-muted">Temporary production scaling leaves the saved formula unchanged. Temperatures and baking times stay the same. ≈ marks a rounded display.</p><div class="recipe-actions">${button('Ingredient totals','production-totals',scalingError?'disabled':'')}${button('Reset checkoffs','reset-checks')}${canEdit()?button('Save scaled copy','scaled-copy',scalingError?'disabled':''):''}</div></section>
  ${d.critical_notes?`<div class="recipe-notice">${esc(d.critical_notes).replaceAll('\n','<br>')}</div>`:''}
  ${model.recipeSections({...v,groups}).components.map(({group:g,methods})=>`<section class="recipe-card recipe-component-view" data-component-view="${esc(g.id)}" data-kitchen-panel="component:${esc(g.id)}" ${scalingError?'hidden':''}><h2>${esc(g.name)}</h2>${scalingError?'':readIngredientTable(g)}${methods.map(({method:m})=>readProcedure(m)).join('')}</section>`).join('')}
  ${model.recipeSections(v).standalone.map(({method:m})=>`<section class="recipe-card recipe-overall-procedure" data-kitchen-panel="method:${esc(m.id||m.name)}" ${scalingError?'hidden':''}>${readProcedure(m,'h2')}</section>`).join('')}
  ${v.components.length?`<section class="recipe-card" data-kitchen-panel="linked" ${scalingError?'hidden':''}><h2>Linked components</h2><label class="recipe-inline-check"><input type="checkbox" data-whole-components ${state.wholeComponents?'checked':''}>Prepare whole batches; show leftovers</label>${v.components.map((c,i)=>{const link=r.links.find(l=>l.version_id===c.version_id);return `<div class="recipe-resource-row"><span>${esc(link?.name||c.name||'Component')}<small class="recipe-muted" style="display:block">Version ${link?.number||'—'} · ${esc(exact(multiply(quantity(c.quantity),f)))} ${esc(c.unit||'yield needed')}${link?.update_available?' · New version available':''}</small></span>${button('View','open-component',`data-id="${link?.recipe_id||''}" data-version="${c.version_id}" data-index="${i}"`)}</div>`;}).join('')}</section>`:''}
  ${v.baking.length?`<section class="recipe-card" data-kitchen-panel="baking"><h2>Baking & temperature settings</h2>${v.baking.map(s=>`<h3>${esc(s.name)}</h3><p>${[['Top',s.top,'°C'],['Bottom setting',s.bottom,'°C'],['Actual bottom',s.actual_bottom,'°C'],['Time',s.minutes,'min'],['Core',s.core,'°C'],['Fan',s.fan,''],['Ingredient',s.ingredient_temperature,'°C'],['Batter',s.batter_temperature,'°C'],['Resting',s.resting_temperature,'°C'],['Cool',s.cooling_minutes,'min'],['Freeze',s.freezing_minutes,'min']].filter(([,value])=>value).map(([label,value,unit])=>`${label}: <strong>${esc(value)} ${unit}</strong>`).join(' · ')}</p>${s.notes?`<p class="recipe-muted">${esc(s.notes)}</p>`:''}`).join('')}</section>`:''}
  <section class="recipe-card" data-kitchen-panel="packaging" ${scalingError?'hidden':''}><h2>Packaging & special equipment</h2>${packagingReferenceMarkup(v,exact(f))}${packagingItems(v).length?'':`<p>${esc(packagingLegacyText(v))}</p>`}<p>${esc(v.packaging.notes)}</p>${photoMarkup(packagingPhotos(v))}${v.equipment.map(e=>`<p><strong>${esc(e.name)}</strong>${e.notes?` · ${esc(e.notes)}`:''}</p>`).join('')}${v.production_notes?`<h3>Production notes</h3><p>${esc(v.production_notes).replaceAll('\n','<br>')}</p>`:''}</section>
  ${canEdit()?`<section class="recipe-card"><div class="recipe-section-head"><h2>Costing & profitability</h2>${button('View cost details','cost-preview')}</div>${scalingError?'<p class="recipe-muted">Enter valid production quantities before calculating costs.</p>':'<div data-saved-cost-card><p role="status">Calculating current costing…</p></div>'}</section><section class="recipe-card"><div class="recipe-actions">${canRD()?button('Testing / R&D','tests'):''}${button('Production history','runs')}${button('Version history','versions')}${button('Duplicate','duplicate')}${button('New variation','variation')}${isOwner()?button('Move to recently deleted','delete','','danger'):''}</div>${(r.files||[]).filter(f=>f.visibility==='private'||!f.mime_type.startsWith('image/')).length?`<h3>Private source files</h3><ul>${r.files.filter(f=>f.visibility==='private'||!f.mime_type.startsWith('image/')).map(f=>`<li><a data-attachment="${f.id}" target="_blank" rel="noopener noreferrer">${esc(f.filename)}</a></li>`).join('')}</ul>`:''}${d.private_notes?`<h3>Private notes</h3><p>${esc(d.private_notes).replaceAll('\n','<br>')}</p>`:''}</section>`:''}`,{tabs:false});
 if(state.kitchen){
  const reference=root.querySelector('.recipe-reader-reference');
  const allergens=reference?.querySelector('.recipe-allergens');if(allergens)reference.before(allergens);
  if(reference?.textContent.trim()||reference?.querySelector('img')){
   const details=document.createElement('details');details.className='recipe-kitchen-reference';
   const summary=document.createElement('summary');summary.textContent='Photos & recipe details';reference.before(details);details.append(summary,reference);
  }else reference?.remove();
  const scale=root.querySelector('.recipe-scale-card'),extra=document.createElement('details');extra.className='recipe-kitchen-adjustments';extra.open=Boolean(state.kitchenRoundingOpen);
  const summary=document.createElement('summary');summary.textContent='Rounding & tools';extra.append(summary);
  for(const el of scale.querySelectorAll('.recipe-scale>label:nth-child(n+4),:scope>.recipe-muted,:scope>.recipe-actions'))extra.append(el);scale.append(extra);
  const controls=document.createElement('details');controls.className='recipe-kitchen-production';controls.open=Boolean(state.kitchenQuantityOpen||scalingError);
  const quantitySummary=document.createElement('summary');quantitySummary.innerHTML=`<span><strong>${scalingError?'Check production quantity':`Prepare ${esc(scaledYield(v.yield,f,state.scale).quantity)} ${esc(v.yield.unit)}`}</strong><small>${[v.name,v.yield.pan_size,scalingError?'':'×'+exact(f)].filter(Boolean).map(esc).join(' · ')}</small></span><span class="recipe-kitchen-adjust-label">Adjust quantity</span>`;
  const fields=document.createElement('div');fields.className='recipe-kitchen-production-fields';fields.append(...scale.childNodes);controls.append(quantitySummary,fields);scale.append(controls);
  const quick=document.createElement('div');quick.className='recipe-quick-quantity';quick.setAttribute('role','group');quick.setAttribute('aria-label','Production multiplier');quick.innerHTML=`<span>Quantity</span>${['1','2','3'].map(n=>button('×'+n,'quick-scale',`data-factor="${n}" aria-pressed="${state.scale.mode==='multiplier'&&state.scale.target===n}"`)).join('')}${button('Custom','custom-scale',`aria-expanded="${controls.open}"`)}`;scale.prepend(quick);
  controls.addEventListener('toggle',()=>{if(controls.isConnected)state.kitchenQuantityOpen=controls.open;});
  if(!scalingError)mountKitchenReader(root,state);
 }
 if(canEdit())arrangeReader(root);
 if(canEdit()&&!scalingError)loadCurrentCostCard(f,state.scale.mode);
 hydratePhotos();
}

const resourceLabels={ingredient:'Ingredients',packaging:'Packaging',supplier:'Suppliers',equipment:'Equipment',categories:'Categories & subcategories'};
const catalogKinds=['ingredient','packaging','supplier','equipment'];
const tableKinds=[...catalogKinds,'categories'],listKinds=[...tableKinds,'library','costing'];
function persistResourceView(active=state.tab){
 if(!state.userId||state.role==='kitchen')return;
 if(tableKinds.includes(state.tab))state.resourceViews[state.tab]={query:state.resourceQuery||'',sort:state.resourceSort,offset:state.resourceOffset,deleted:!!state.resourceDeleted,scroll:window.scrollY};
 if(state.tab==='library'&&root.querySelector('.recipe-library'))state.listViews.library={filters:{...state.filters},offset:state.offset,scroll:window.scrollY};
 if(state.tab==='costing'&&root.querySelector('.recipe-cost-overview'))state.listViews.costing={filters:{...state.costFilters},scroll:window.scrollY};
 if(listKinds.includes(active))state.lastListTab=active;
 try{sessionStorage.setItem('tlb-recipe-catalog:'+state.userId,JSON.stringify({active:state.lastListTab||'library',views:state.resourceViews,lists:state.listViews}));}catch{}
}
function restoreListFilters(value){return Object.fromEntries(Object.entries(value&&typeof value==='object'?value:{}).filter(([key,v])=>['query','category_id','status','favorites','pinned','recent','deleted','author','tag','flavor','version','updated_after','from','to','product_line','mode','condition','sort','basis','offset'].includes(key)&&['string','boolean','number'].includes(typeof v)).map(([key,v])=>[key,key==='offset'?(Number.isInteger(v)&&v>=0?Math.min(v,1000000):0):typeof v==='string'?v.slice(0,200):v]));}
function restoreResourceView(kind){
 const view=state.resourceViews[kind]||{};
 state.resourceQuery=typeof view.query==='string'?view.query.slice(0,200):'';state.resourceSort=view.sort==='cost'?'cost':'az';
 state.resourceOffset=Number.isInteger(view.offset)&&view.offset>=0?Math.min(view.offset,1000000):0;state.resourceDeleted=isOwner()&&view.deleted===true;
 return Number.isFinite(view.scroll)?Math.max(0,view.scroll):0;
}
window.addEventListener('pagehide',()=>persistResourceView());

function sectionLoadError(error){if(state.role==='kitchen'&&kitchenGuard.locked)return;shell(`<section class="recipe-card recipe-empty" role="alert"><h2>This section could not load</h2><p>${esc(error.message||'Check your connection and try again.')}</p>${button('Try again','reload-section','','primary')}</section>`);}
function renderResourceResults(){
 const container=root.querySelector('[data-resource-results]');if(!container)return;
 container.innerHTML=resourceTableMarkup(state.resources,{kind:state.tab,sort:tableKinds.includes(state.tab)?'server':state.resourceSort,canDelete:isOwner()});
 const count=root.querySelector('[data-resource-count]'),paged=tableKinds.includes(state.tab);
 if(count)count.textContent=paged?`${state.resourceTotal?state.resourceOffset+1:0}–${state.resourceOffset+state.resources.length} of ${state.resourceTotal} ${resourceLabels[state.tab].toLowerCase()} · Page ${Math.floor(state.resourceOffset/state.resourceLimit)+1} of ${Math.max(1,Math.ceil(state.resourceTotal/state.resourceLimit))}`:`${state.resources.length} matching ${resourceLabels[state.tab]?.toLowerCase()||'records'}`;
 const pages=root.querySelector('[data-resource-pagination]');if(pages)pages.innerHTML=paged?`${button('Previous','resource-page',`data-offset="${Math.max(0,state.resourceOffset-state.resourceLimit)}" ${state.resourceOffset===0?'disabled':''}`)}${button('Next','resource-page',`data-offset="${state.resourceOffset+state.resourceLimit}" ${state.resourceOffset+state.resources.length>=state.resourceTotal?'disabled':''}`)}`:'';
}
function renderResourceTable(kind){
 const priced=['ingredient','packaging'].includes(kind),category=kind==='categories',label=resourceLabels[kind];
 shell(`<section class="recipe-resource-card" data-resource-kind="${kind}" data-density="${state.resourceDensity}"><header class="recipe-resource-heading"><div><h2>${label}</h2><p>${state.resourceDeleted?'Deleted records · restore them whenever you need.':priced?'Purchase prices and comparable unit costs, together.':'Find and manage your records in one place.'}</p></div><div class="recipe-actions">${isOwner()?button(state.resourceDeleted?'Back to records':'Deleted records','toggle-deleted',`aria-pressed="${!!state.resourceDeleted}"`):''}${state.resourceDeleted?'':`${['ingredient','packaging','supplier'].includes(kind)?button('Record purchase','record-purchase','','primary'):''}${button(category?'+ Category':`+ Add ${kind}`,category?'add-category':'add-resource')}`}</div></header><div class="recipe-resource-toolbar"><label class="recipe-resource-search"><span class="recipe-resource-sr">Search ${label.toLowerCase()}</span><input data-resource-search type="search" placeholder="Search ${label.toLowerCase()}…" value="${esc(state.resourceQuery||'')}"></label>${priced?`<label class="recipe-resource-sort"><span class="recipe-resource-sr">Sort matching records</span><select data-resource-sort><option value="az" ${state.resourceSort==='az'?'selected':''}>Name: A–Z</option><option value="cost" ${state.resourceSort==='cost'?'selected':''}>Unit cost: grouped by unit</option></select></label>`:''}<div class="recipe-resource-density" role="group" aria-label="Row spacing">${['compact','comfortable'].map(value=>button(value==='compact'?'Compact':'Comfortable','resource-density',`data-density="${value}" aria-pressed="${state.resourceDensity===value}"`)).join('')}</div></div><div data-resource-results aria-busy="false"></div><footer class="recipe-resource-footer"><span data-resource-count role="status"></span><nav class="recipe-actions" data-resource-pagination aria-label="Catalog pages"></nav><span>${priced?'Unit costs: per g, ml, pc, or the applicable unit':'Sorted A–Z'}</span></footer></section>`);
 renderResourceResults();
}
async function resources(kind,{refresh=false,scroll=null}={}){
 const request=++state.resourceRequest,query=state.resourceQuery||'',offset=state.resourceOffset,sort=state.resourceSort,deleted=!!state.resourceDeleted;
 state.tab=kind;state.record=null;state.editing=false;persistResourceView();
 const existing=root.querySelector(`[data-resource-kind="${kind}"]`),previousScroll=scroll??window.scrollY;
 if(existing){existing.querySelector('[data-resource-results]').setAttribute('aria-busy','true');existing.querySelectorAll('[data-action="resource-page"]').forEach(b=>b.disabled=true);}else shell(recipeLoadingMarkup({rows:true}));
 let result;
 try{result=await api('resources',{kind,query,limit:state.resourceLimit,offset,sort,paginate:true,include_inactive:true,deleted});}
 catch(error){if(request===state.resourceRequest&&state.tab===kind){if(existing){const loaded=state.resourceLoadedView;if(loaded?.kind===kind){state.resourceQuery=loaded.query;state.resourceSort=loaded.sort;state.resourceOffset=loaded.offset;state.resourceDeleted=loaded.deleted;existing.querySelector('[data-resource-search]').value=loaded.query;const order=existing.querySelector('[data-resource-sort]');if(order)order.value=loaded.sort;}renderResourceResults();persistResourceView();showError(error);}else sectionLoadError(error);}return;}
 finally{if(request===state.resourceRequest)existing?.querySelector('[data-resource-results]')?.setAttribute('aria-busy','false');}
 if(request!==state.resourceRequest||state.tab!==kind||query!==(state.resourceQuery||'')||sort!==state.resourceSort||deleted!==!!state.resourceDeleted||state.editing)return;
 state.resources=result.rows;state.resourceTotal=Number.isInteger(result.total)?result.total:result.rows.length;
 state.resourceOffset=Number.isInteger(result.offset)?result.offset:offset;
 state.resourceLoadedView={kind,query,sort,offset:state.resourceOffset,deleted};
 if(existing?.isConnected)renderResourceResults();else renderResourceTable(kind);
 if(scroll!==null||existing)await new Promise(resolve=>requestAnimationFrame(()=>{window.scrollTo(0,previousScroll);resolve();}));
 persistResourceView();
}
async function resourceEditor(record=null){
 const kind=state.tab,data=record?.data||{},price=record?.price||{};state.resourceEditing=record;state.resourcePhotos=structuredClone(data.photos||[]);const suppliers=['ingredient','packaging'].includes(kind)?await allRecipeSuppliers(api):[];
 const input=(label,key,value,type='text')=>`<label>${label}${key==='default_unit'?`<select name="${key}">${unitOptionsMarkup(value)}</select>`:`<input name="${key}" type="${type}" value="${esc(value)}">`}</label>`;
 const fields=kind==='supplier'?[['Supplier type','type'],['Contact name','contact_name'],['Email','email'],['Phone','phone'],['Address','address'],['Payment terms','payment_terms']]:
 kind==='ingredient'?[['Default unit','default_unit'],['Brand','brand'],['Category','category'],['Allergens · comma separated','allergens']]:
 kind==='packaging'?[['Packaging type','type'],['Dimensions','dimensions'],['Default unit','default_unit'],['Minimum order quantity','minimum_order_quantity'],['Product associations','product_associations']]:[['Equipment type','type']];
 setDialog(`${record?'Edit':'Add'} ${kind}`,`<form id="recipe-resource-form"><div class="recipe-fields two">${input('Name','name',record?.name||'')}${fields.map(([label,key])=>input(label,key,Array.isArray(data[key])?data[key].join(', '):data[key]||'')).join('')}<label class="wide">Notes<textarea name="notes">${esc(data.notes)}</textarea></label></div>
  ${kind==='packaging'?'<section class="recipe-form-section"><h3>Packaging photos · optional</h3><p class="recipe-muted">Add a photo of the box, bag or other packaging. Photos are private and included in recipe backups.</p><label>Add packaging photo<input data-resource-photo type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"></label><p data-resource-photo-status role="status"></p><div class="recipe-photos" data-resource-photos></div></section>':''}
  ${['ingredient','packaging'].includes(kind)?`<h3 class="recipe-form-section">Suppliers & purchase prices · optional</h3><p class="recipe-muted">Keep alternative suppliers and compare pack prices. Automatic costing uses the highest comparable unit cost, unless you choose a preferred supplier. All linked recipes use updated prices automatically. Historical snapshots retain the prices recorded at the time.</p><div data-supplier-editor></div>${record?button('Price history','price-history',`data-id="${record.id}"`):''}`:''}  <label class="recipe-inline-check"><input name="active" type="checkbox" ${record?.active!==false?'checked':''}>Active</label><div class="recipe-actions"><button class="primary" type="submit">Save ${kind}</button>${record&&isOwner()?button('Delete','delete-resource',`data-id="${record.id}"`,'danger'):''}</div></form>`);
 state.resourceQuotes=dialogBody.querySelector('[data-supplier-editor]')?mountSupplierQuotes(dialogBody.querySelector('[data-supplier-editor]'),{record,suppliers,defaultUnit:data.default_unit||(kind==='packaging'?'pc':'g')}):null;
 await renderResourcePhotos();
}
async function renderResourcePhotos(){
 const container=dialogBody.querySelector('[data-resource-photos]');if(!container)return;
 container.innerHTML=state.resourcePhotos.map((p,i)=>`<figure><img alt="${esc(p.caption||'Packaging photo')}" data-resource-image="${i}"><figcaption><label>Caption<input data-resource-caption="${i}" value="${esc(p.caption||'')}"></label>${button('Remove photo','remove-resource-photo',`data-index="${i}"`)}</figcaption></figure>`).join('');
 await Promise.all(state.resourcePhotos.map(async(p,i)=>{const img=container.querySelector(`[data-resource-image="${i}"]`);try{img.src=await recipeFileUrl(p.path);}catch{img.alt='Photo unavailable. Reopen this record to retry.';}}));
}
async function categories({refresh=false,scroll=null}={}){
 const existing=root.querySelector('[data-resource-kind="categories"]'),previousScroll=scroll??(existing?window.scrollY:0);
 state.tab='categories';state.record=null;state.editing=false;const matches=sortResourceRows(state.categories.filter(c=>!!c.deleted_at===!!state.resourceDeleted&&c.name.toLowerCase().includes((state.resourceQuery||'').toLowerCase())).map(c=>({...c,parent_name:state.categories.find(p=>p.id===c.parent_id)?.name})));
 state.resourceTotal=matches.length;state.resourceOffset=Math.min(state.resourceOffset,Math.max(0,Math.floor((matches.length-1)/state.resourceLimit)*state.resourceLimit));state.resources=matches.slice(state.resourceOffset,state.resourceOffset+state.resourceLimit);
 if(existing)renderResourceResults();else renderResourceTable('categories');
 window.scrollTo(0,previousScroll);persistResourceView();
}
function categoryEditor(c={}){state.categoryEditing=c;setDialog(c.id?'Edit category':'Add category',`<form id="recipe-category-form"><div class="recipe-fields two"><label>Category name<input name="name" value="${esc(c.name)}" required maxlength="100"></label><label>Parent category<select name="parent_id"><option value="">Top-level category</option>${state.categories.filter(p=>p.id!==c.id&&!p.deleted_at).map(p=>`<option value="${p.id}" ${c.parent_id===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label></div><label class="recipe-inline-check"><input name="active" type="checkbox" ${c.active!==false?'checked':''}>Available for new recipes</label><div class="recipe-actions"><button class="primary" type="submit">Save category</button>${c.id?button('Delete','delete-category',`data-id="${c.id}"`,'danger'):''}</div></form>`);}
async function access(){
 state.tab='staff-access';const people=await api('access');state.accessPeople=people;
 shell(`<div class="recipe-actions">${button('Back to Staff Access','staff-access')}</div><section class="recipe-card"><h2>Add recipe access</h2><p class="recipe-muted">Invite someone with their email address. This gives recipe access only; shop administration stays separate.</p><form id="recipe-access-form"><div class="recipe-fields two"><label>Email address<input type="email" name="email" required maxlength="254" autocomplete="email" placeholder="name@example.com"></label><label>Permission<select name="permission"><option value="kitchen">Kitchen · view production</option><option value="chef">Chef · edit drafts</option></select></label></div><p class="recipe-muted">Kitchen accounts follow their Staff Access hours, calendar and recipe scope, and can use temporary scaling. Printing and exports are disabled. Chef accounts can edit drafts and costing. Enable Can view R&D separately to show research recipes and allow Chef accounts to use testing logs. Only you can mark recipes Final, Hidden or Archive.</p><button type="submit" class="primary">Add account & send invitation</button><p data-access-message role="status"></p></form></section><section class="recipe-card"><h2>Accounts & permissions</h2><p class="recipe-muted">Can view R&D enables research formulas. Kitchen accounts remain subject to their Staff Access recipe scope, hours and blocking rules. Chef accounts can also edit research recipes and their logs. Only you can change this permission. New accounts start with R&D off.</p>${people.map(p=>`<div class="recipe-resource-row recipe-access-row"><div><strong>${esc(p.email)}</strong><small class="recipe-muted" style="display:block">${p.role==='owner'?'Owner · full access':esc(p.status||'Active')}${p.email_status?` · Email ${esc(({pending:'queued',sending:'sending',sent:'accepted for delivery',failed:'failed',skipped:'cancelled'})[p.email_status]||p.email_status)}`:''}</small></div>${p.role==='owner'?'':`<div class="recipe-actions"><label>Recipe access<select ${p.invitation_id?`data-access-invitation="${p.invitation_id}"`:`data-access-user="${p.user_id}"`}><option value="">Remove access</option><option value="kitchen" ${p.recipe_permission==='kitchen'?'selected':''}>Kitchen · view production</option><option value="chef" ${p.recipe_permission==='chef'?'selected':''}>Chef · edit drafts</option></select></label>${!p.invitation_id&&p.recipe_permission?`<label class="recipe-inline-check"><input type="checkbox" data-access-rd="${p.user_id}" ${p.can_view_rd?'checked':''}>Can view R&D</label>`:''}${p.invitation_id?button('Resend invitation','resend-invitation',`data-id="${p.invitation_id}"`):''}</div>`}</div>`).join('')}</section>`);
}
async function staffAccess(){
 state.staffAccessController?.dispose();state.staffAccessController=null;state.tab='staff-access';state.record=null;state.doc=null;
 shell('<p role="status">Loading staff access…</p>');
 const {openStaffAccess}=await import('./recipe-staff-access.js?v=staff-header-1');
 state.staffAccessState??={};state.staffAccessController=await openStaffAccess({root,api,shell,dialog:setDialog,closeDialog,confirm:confirmDialog,notify,openAccounts:access,state:state.staffAccessState,isActive:()=>state.tab==='staff-access'});
}
async function versions(offset=0){
 state.historyOffset=offset;const rows=await api('versions',{id:state.record.id,limit:100,offset});state.versions=rows;
 setDialog('Version history',`<p class="recipe-muted">Restoring creates a new draft. Every previous formula stays available.</p>${rows.map(v=>`<div class="recipe-resource-row"><div><strong>Version ${v.number}</strong> · ${recipeStatusLabel(v.status)}<p class="recipe-muted">${date(v.created_at)} · ${esc(v.author||'Former account')} · ${esc(v.reason||'No change note')}</p></div><div class="recipe-actions">${button('Compare','compare-version',`data-version="${v.id}"`)}${button('Restore','restore-version',`data-version="${v.id}"`)}${button('Duplicate','duplicate-version',`data-version="${v.id}"`)}</div></div>`).join('')}<div class="recipe-actions">${button('Newer versions','history-page',`data-offset="${Math.max(0,offset-100)}" ${offset===0?'disabled':''}`)}${button('Older versions','history-page',`data-offset="${offset+100}" ${rows.length<100?'disabled':''}`)}</div>`);
}
async function tests(){
 const rows=await api('tests',{id:state.record.id,limit:100});state.tests=rows;
 setDialog('Testing & R&D',`<div class="recipe-actions">${button('+ New test','add-test')}</div>${rows.map(t=>`<div class="recipe-resource-row"><div><strong>Test #${t.number}</strong> · ${esc(t.data.date||date(t.created_at))}<p>${esc(t.data.result||t.data.observations||'No result entered')}</p><small class="recipe-muted">${t.promoted_version_id?'Promoted to a saved recipe version':'Separate from the saved production recipe'}</small></div><div class="recipe-actions">${button('View / edit','edit-test',`data-id="${t.id}"`)}${isOwner()&&!t.promoted_version_id?button('Promote','promote-test',`data-id="${t.id}"`):''}</div></div>`).join('')||'<p class="recipe-empty">Record your first test without changing the approved formula.</p>'}`);
}
async function testEditor(t=null){
 if(!t?.promoted_version_id){
  const source=t&&t.version_id!==state.record.version_id?await api('get',{id:state.record.id,version_id:t.version_id}):state.record;
  const data=structuredClone(t?.data||{});data.date||=new Date().toLocaleDateString('en-CA');state.testDraftPhotos=structuredClone(data.photos||[]);
  closeDialog();beginEdit(source,t?.proposed_document||source.document,{record:t,source,data,pane:'formula'});window.scrollTo(0,0);return;
 }
 state.testEditing=t;const d=t?.data||{},locked=Boolean(t?.promoted_version_id);state.testDraftPhotos=structuredClone(d.photos||[]);
 setDialog(t?`Test #${t.number}`:'New test',`<form id="recipe-test-form"><div class="recipe-fields two"><label>Test date<input name="date" type="date" value="${esc(d.date||new Date().toLocaleDateString('en-CA'))}" ${locked?'disabled':''}></label><label>Rating · 0 to 5<input name="rating" type="number" min="0" max="5" step="0.5" value="${esc(d.rating??'')}" ${locked?'disabled':''}></label>${[['Changes made','changes'],['Bake settings','bake_settings'],['Ingredient changes','ingredient_changes'],['Observations','observations'],['Result','result'],['Next test','next_test']].map(([label,key])=>`<label class="wide">${label}<textarea name="${key}" ${locked?'disabled':''}>${esc(d[key])}</textarea></label>`).join('')}</div><p class="recipe-muted">This promoted test is preserved with its source version and observations. Create a new test for further changes.</p><div class="recipe-photos" data-test-photos></div>${locked?'':button('+ Test photo','test-photo')}${locked?'':`<div class="recipe-actions"><button class="primary" type="submit">Save test log</button>${t?button('Edit tested formula','edit-test-formula',`data-id="${t.id}"`):''}</div>`}</form>`);renderTestPhotos().catch(showError);
}
let packagingRequest=0,packagingTimer;
async function findPackaging(query){
 const target=dialogBody.querySelector('[data-packaging-results]');if(!target)return;const request=++packagingRequest;target.innerHTML='<p role="status">Loading packaging…</p>';
 try{const result=await api('resources',{kind:'packaging',query,limit:100});if(request!==packagingRequest||!target.isConnected)return;state.packagingChoices=result.rows.filter(r=>r.active!==false&&!r.deleted_at);target.innerHTML=state.packagingChoices.map(r=>`<div class="recipe-resource-row"><div><strong>${esc(r.name)}</strong>${r.data?.dimensions?`<p class="recipe-muted">${esc(r.data.dimensions)}</p>`:''}<p class="recipe-muted">${r.price?`${money(r.price.amount)} / ${esc(r.price.quantity)} ${esc(r.price.unit)}`:'Price not set'}</p></div>${button('Use item','choose-packaging-cost',`data-id="${r.id}" aria-label="Use ${esc(r.name)}"`)}</div>`).join('')||'<p class="recipe-muted">No matching packaging. Add items in your Packaging list.</p>';}
 catch(error){if(request===packagingRequest&&target.isConnected)target.innerHTML=`<p class="recipe-error">${esc(error.message)} Type again to retry.</p>`;}
}
async function costPreview(){
 const v=state.doc.variants[state.variant],factor=state.editing?'1':exact(scaleFactor(v.yield,state.scale.mode,state.scale.target));
 return openCosting({record:state.record,document:state.doc,variant:state.variant,editing:state.editing,factor,scalingMode:state.editing?'multiplier':state.scale.mode,api,dialog:setDialog,host:dialogBody});
}
async function uploadPhoto(attrs){
 const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';
 input.addEventListener('change',async()=>{try{
  if(!input.files[0])return;notify('Preparing and uploading photo…');const file=await prepareProductImage(input.files[0]);const record=await uploadRecipeFile(file);
  const photo={id:model.id(),file_id:record.id,purpose:attrs.purpose,caption:''};state.doc.files.push({...record,visibility:'kitchen'});
  if(attrs.purpose==='product')state.doc.photos.push(photo);
  else if(attrs.purpose==='packaging')replacePackagingPhotos(state.doc,state.doc.variants[state.variant],[photo]);
  else {state.doc.variants[state.variant].methods[Number(attrs.method)].steps[Number(attrs.step)].image_id=record.id;state.doc.variants[state.variant].photos.push(photo);}
  markDirty();renderEditor();notify('Photo uploaded. Save the recipe to attach it to this version.');
 }catch(error){showError(error);}});input.click();
}
async function saveRecipe(){
 if(state.saving)return;
 const errors=model.validateRecipe(state.doc);if(errors.length){setDialog('Check these recipe fields',`<ul>${errors.map(e=>`<li>${esc(e)}</li>`).join('')}</ul>`);return;}
 for(const v of state.doc.variants)for(const g of v.groups)for(const row of g.ingredients)if(row.cost_snapshot&&!Object.values(row.cost_snapshot).some(Boolean))delete row.cost_snapshot;
 if(state.testWorkspace)return saveTestWorkspace();
 state.saving=true;clearTimeout(autosaveTimer);
 const form=root.querySelector('#recipe-editor'),scroll=window.scrollY;form.inert=true;
 const status=root.querySelector('#recipe-save-status').value;state.saveStatus=status;
 try{
  await pendingAutosave.catch(()=>{});
  const record=await api(state.record?'save':'create',{id:state.record?.id,revision:state.record?.revision,document:state.doc,status,reason:''});
  await api('remove_draft',{draft_id:state.draftId}).catch(()=>{});
  state.record=record;state.doc=model.normalizeRecipe(record.document);state.dirty=false;state.draftId=model.id();
  notify(`Version ${record.version} saved · ${recipeStatusLabel(record.status)}.`);
  renderEditor();window.scrollTo(0,scroll);
 }finally{state.saving=false;form.inert=false;}
}
async function saveTestWorkspace(){
 const workspace=state.testWorkspace,form=root.querySelector('#recipe-editor'),notes=root.querySelector('.recipe-test-notes'),submit=root.querySelector('[data-action="save"]');
 const invalid=[...notes.querySelectorAll('input')].find(input=>!input.checkValidity());if(invalid){root.querySelector('[data-test-pane="notes"]').click();invalid.reportValidity();return;}
 state.saving=true;form.inert=true;notes.inert=true;submit.disabled=true;
 try{
  const t=workspace.record,photos=structuredClone(state.testDraftPhotos),sourceFiles=new Set((workspace.source.files||[]).map(f=>f.id));
  // Formula uploads in a test receive private R&D links until explicit promotion.
  for(const file of state.doc.files||[])if(!sourceFiles.has(file.id)&&!photos.some(p=>p.id===file.id))photos.push({...file,test_formula:true});
  const saved=await api('save_test',{id:t?.id,revision:t?.revision,recipe_id:workspace.source.id,version_id:t?.version_id||workspace.source.version_id,data:{...workspace.data,photos},proposed_document:state.doc});
  workspace.record=saved;workspace.data=structuredClone(saved.data);state.testDraftPhotos=structuredClone(saved.data.photos||[]);state.dirty=false;renderEditor();notify('Test formula and observations saved. The Final recipe is unchanged.');
 }finally{state.saving=false;form.inert=false;notes.inert=false;if(submit.isConnected)submit.disabled=false;}
}
function move(array,from,to){if(to<0||to>=array.length)return;const [item]=array.splice(from,1);array.splice(to,0,item);}
async function action(name,a={}){
 if(name==='verify-kitchen-access')return kitchenGuard.check();
 if(name==='staff-access')return staffAccess();
 if(name==='kitchen-scope'){
  if(state.role!=='kitchen'||!canRD())return;state.rd=a.view==='rd';state.filters={};state.offset=0;state.record=null;state.doc=null;state.resumeKitchen=null;closeDialog();
  await api('access_check',{rd:state.rd});history.replaceState(null,'',`recipes.html${state.rd?'?view=rd':''}`);return library();
 }
 if(state.role==='kitchen'&&kitchenGuard.locked)return;
 const v=state.doc?.variants[state.variant];
 if(name==='quick-scale'){if(state.role==='kitchen')await api('scale',kitchenGuard.context());state.scale.mode='multiplier';state.scale.target=a.factor;renderRecipe();root.querySelector(`[data-action="quick-scale"][data-factor="${a.factor}"]`)?.focus({preventScroll:true});return;}
 if(name==='overview-basis'){state.costFilters.basis=a.basis==='unit'?'unit':'batch';root.querySelector('[data-cost-overview-rows]').innerHTML=costingOverviewRows(state.costOverviewData,{button,basis:state.costFilters.basis});root.querySelectorAll('[data-action="overview-basis"]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.basis===state.costFilters.basis)));root.querySelector('[data-overview-basis-label]').textContent=state.costFilters.basis==='unit'?'All money columns are per saleable unit; the unit is shown below each product. Products without a saleable unit show —.':'All money columns are for one base batch; batch yield is shown below each product.';return;}
 if(name==='custom-scale'){const controls=root.querySelector('.recipe-kitchen-production');controls.open=true;root.querySelector('[data-action="custom-scale"]').setAttribute('aria-expanded','true');root.querySelector('[data-scale="target"]')?.focus();return;}
 if(name==='exit-test'){const id=state.testWorkspace.source.id;if(await leaveEditor())return openRecipe(id);return;}
 if(name==='return-costing'){if(await leaveEditor())return costingOverview();return;}
 if(name==='keep-draft'){clearTimeout(autosaveTimer);if(!await saveDraft())return;state.editing=false;state.dirty=false;return state.tab==='costing'?costingOverview():library();}
 if(name==='missing-prices'){state.resourceQuery='';state.resourceOffset=0;return resources('ingredient');}
 if(name==='refresh-library')return library();
 if(name==='costing-page'){state.costFilters.offset=Number(a.offset);return costingOverview({scroll:0});}
 if(name==='open-costing-product'){await openRecipe(a.id);state.variant=Math.max(0,state.doc.variants.findIndex(v=>v.id===a.variant));renderRecipe();return costPreview();}
 if(name==='add-direct-cost'){v.additional_costs.push({id:model.id(),name:'',amount:'0',kind:'direct',per_batch:true});markDirty();renderEditor();return;}
 if(name==='reload-section')return state.tab==='costing'?costingOverview():state.tab==='library'?library():state.tab==='categories'?categories():resources(state.tab);
 if(name==='resource-page'){if(root.querySelector('[data-resource-results]')?.getAttribute('aria-busy')==='true')return;state.resourceOffset=Math.max(0,Number(a.offset)||0);return state.tab==='categories'?categories({refresh:true,scroll:0}):resources(state.tab,{refresh:true,scroll:0});}
 if(name==='toggle-deleted'){state.resourceDeleted=!state.resourceDeleted;state.resourceOffset=0;state.resourceQuery='';return state.tab==='categories'?categories():resources(state.tab);}
 if(['delete-resource','restore-resource','delete-category','restore-category'].includes(name)){
  const category=name.endsWith('category'),restore=name.startsWith('restore'),record=state.resources.find(r=>r.id===a.id)||(state.resourceEditing?.id===a.id?state.resourceEditing:null);
  if(!record)return;const kind=state.tab;
  if(!restore&&!await confirmDialog(`Delete “${record.name}”? It will move to Deleted records. Saved recipes, price history and photos will be kept.${kind==='supplier'?' New costing will use another available supplier when possible.':''}`,{confirmLabel:'Delete record',danger:true}))return;
  await api(name.replace('-','_'),{id:record.id,revision:record.revision});closeDialog();
  if(category){state.categories=(await api('bootstrap')).categories;await categories();}else await resources(kind);
  notify(restore?'Record restored.':'Moved to Deleted records.');return;
 }
 if(name==='resource-density'){
  state.resourceDensity=a.density==='comfortable'?'comfortable':'compact';
  const card=root.querySelector('.recipe-resource-card');if(card)card.dataset.density=state.resourceDensity;
  root.querySelectorAll('[data-action="resource-density"]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.density===state.resourceDensity)));
  try{localStorage.setItem('tlb-recipe-resource-density-v1',state.resourceDensity);}catch{}return;
 }
 if(name==='remove-resource-photo'){state.resourcePhotos.splice(Number(a.index),1);await renderResourcePhotos();return;}
 if(name==='record-purchase'){if(state.editing&&!await leaveEditor())return;const {openPurchase}=await import('./recipe-purchase.js?v=refinement-20261002-1');return openPurchase({userId:state.userId,api,dialog:setDialog,body:dialogBody,close:closeDialog,kind:state.tab==='packaging'?'packaging':'ingredient',onSaved:async kind=>{await resources(kind);notify('Purchase saved. Ingredient or packaging and supplier records are up to date.');}});}
 if(name==='record-item-price'){const record=state.resources.find(r=>r.id===a.id);if(!record)return;const {openItemPrice}=await import('./recipe-purchase.js?v=refinement-20261002-1');return openItemPrice({api,dialog:setDialog,body:dialogBody,close:closeDialog,record,onSaved:async()=>{ingredientPicker.clear();await resources(record.kind,{refresh:true});notify('Price recorded. Saved recipe costs are unchanged.');}});}
 if(name==='tab'){if(!await leaveEditor())return;persistResourceView(a.tab);const restoreScroll=tableKinds.includes(a.tab)?restoreResourceView(a.tab):null;state.staffAccessController?.dispose();state.staffAccessController=null;if(!tableKinds.includes(a.tab)){state.resourceQuery='';state.resourceDeleted=false;state.resourceOffset=0;}state.resourceRequest++;if(a.tab==='manage')return manage();if(a.tab==='units')return manageUnits();if(a.tab==='costing')return costingOverview();if(a.tab==='library')return library();if(a.tab==='categories')return categories({scroll:restoreScroll});if(a.tab==='access')return access();if(a.tab==='staff-access')return staffAccess();if(a.tab==='backups'){state.tab='backups';shell('<div id="recipe-backups"></div>');const m=await import('./recipe-backups.js?v=final-backups-20261003-1');return m.mountRecipeBackups(root.querySelector('#recipe-backups'));}return resources(a.tab,{scroll:restoreScroll});}
 if(name==='library'){if(await leaveEditor())return library({reuse:true});return;}
 if(name==='new'){if(await leaveEditor()){beginEdit();}return;}
 if(name==='open')return openRecipe(a.id);
 if(name==='edit'){beginEdit(state.record);return;}
 if(name==='edit-open'){rememberLibrary();const request=++state.request,record=await api('get',{id:a.id});if(request!==state.request)return;beginEdit(record);return;}
 if(name==='view-saved'){if(await leaveEditor()){state.doc=model.normalizeRecipe(state.record.document);state.variant=Math.min(state.variant,state.doc.variants.length-1);state.scale=initialScale(state.doc.variants[state.variant].yield);renderRecipe();}return;}
 if(name==='set-status'){const status=root.querySelector('[data-recipe-status]').value;const record=await api('set_status',{id:state.record.id,revision:state.record.revision,status});state.record=record;state.doc=model.normalizeRecipe(record.document);renderRecipe();notify(`Recipe is now ${recipeStatusLabel(record.status)}.`);return;}
 if(name==='page'){state.offset=Number(a.offset);return library({scroll:0});}
 if(name==='favorite'||name==='pin'){await api('favorite',{id:a.id,favorite:a.favorite==='true',pinned:a.pinned==='true'});return library();}
 if(name==='save')return saveRecipe();
 if(name==='upload')return uploadPhoto(a);
 if(name==='add-scaling-option'){v.yield.scale_options??=[];if(v.yield.scale_options.length>=12)return;const option={id:model.id(),label:'',quantity:v.yield.quantity||'1',unit:v.yield.unit||'pcs'};v.yield.scale_options.push(option);v.yield.scale_default||='custom:'+option.id;}
 else if(name==='remove-scaling-option'){const removed=v.yield.scale_options.splice(Number(a.index),1)[0];if(v.yield.scale_default==='custom:'+removed?.id)v.yield.scale_default=v.yield.scale_options.length?'custom:'+v.yield.scale_options[0].id:'multiplier';}
 else if(name==='add-variant'){state.doc.variants.push(model.variant(`Size ${state.doc.variants.length+1}`));state.variant=state.doc.variants.length-1;}
 else if(name==='duplicate-variant'){state.doc.variants.push(model.freshVariant(v));state.variant=state.doc.variants.length-1;}
 else if(name==='remove-variant'){if(!await confirmDialog('Remove this size from the working draft?',{danger:true,confirmLabel:'Remove size'}))return;state.doc.variants.splice(state.variant,1);state.variant=0;}
 else if(name==='add-group')model.addComponent(v);
 else if(name==='remove-group'){if(!await confirmDialog(`Remove ${v.groups[Number(a.group)].name}, its ingredients and its procedures from this draft?`,{danger:true,confirmLabel:'Remove component'}))return;model.removeComponent(v,Number(a.group));}
 else if(name==='move-group')move(v.groups,Number(a.group),Number(a.group)+Number(a.direction));
 else if(name==='add-ingredient')v.groups[Number(a.group)].ingredients.push(model.ingredient());
 else if(name==='remove-ingredient'){const row=v.groups[Number(a.group)].ingredients[Number(a.row)];if(row.name&&!await confirmDialog(`Remove ${row.name} from this draft?`,{confirmLabel:'Remove ingredient',danger:true}))return;v.groups[Number(a.group)].ingredients.splice(Number(a.row),1);}
 else if(name==='move-ingredient')move(v.groups[Number(a.group)].ingredients,Number(a.row),Number(a.row)+Number(a.direction));
 else if(name==='add-method'){const m=model.method(a.group!=null?v.groups[Number(a.group)].id:'');if(a.group==null)m.name='Assembly';v.methods.push(m);}
 else if(name==='remove-method'){if(!await confirmDialog('Remove this method section?',{danger:true,confirmLabel:'Remove section'}))return;v.methods.splice(Number(a.method),1);}
 else if(name==='add-step')v.methods[Number(a.method)].steps.push(model.step());
 else if(name==='remove-step')v.methods[Number(a.method)].steps.splice(Number(a.step),1);
 else if(name==='move-step')move(v.methods[Number(a.method)].steps,Number(a.step),Number(a.step)+Number(a.direction));
 else if(name==='add-stage')v.baking.push(model.stage());
 else if(name==='remove-stage')v.baking.splice(Number(a.index),1);
 else if(name==='add-equipment')v.equipment.push({id:model.id(),name:'',notes:''});
 else if(name==='remove-equipment')v.equipment.splice(Number(a.index),1);
 else if(name==='link-packaging-cost'){setDialog('Choose packaging','<label>Search packaging<input type="search" data-packaging-search placeholder="Box, board, size…"></label><div data-packaging-results></div>');await findPackaging('');return;}
 else if(name==='choose-packaging-cost'){const r=state.packagingChoices.find(r=>r.id===a.id);if(!r)throw Error('Choose a packaging item from the current results.');const selected=addRecipePackaging(v,r);closeDialog();if(selected.added)markDirty();renderEditor();root.querySelector(`[data-path="variants.${state.variant}.additional_costs.${selected.index}.quantity"]`)?.focus();if(!selected.added)notify('This packaging is already included. Adjust its quantity here.');return;}
 else if(name==='remove-cost'){v.additional_costs.splice(Number(a.index),1);}
 else if(name==='reset-packaging-photo')replacePackagingPhotos(state.doc,v,[]);
 else if(name==='remove-component'){if(!await confirmDialog('Remove this component link from the working draft?',{confirmLabel:'Remove component',danger:true}))return;v.components.splice(Number(a.index),1);}
 else if(name==='remove-photo'){
  state.doc.photos=state.doc.photos.filter(p=>p.file_id!==a.fileId);
  v.photos=v.photos.filter(p=>p.file_id!==a.fileId);v.packaging.photos=v.packaging.photos.filter(p=>p.file_id!==a.fileId);for(const m of v.methods)for(const step of m.steps)if(step.image_id===a.fileId)delete step.image_id;
  const used=state.doc.photos.some(p=>p.file_id===a.fileId)||state.doc.variants.some(size=>size.photos.some(p=>p.file_id===a.fileId)||size.packaging.photos.some(p=>p.file_id===a.fileId)||size.methods.some(m=>m.steps.some(step=>step.image_id===a.fileId)));
  if(!used)state.doc.files=state.doc.files.filter(f=>f.id!==a.fileId);
 }
 else if(name==='link-component'){
  setDialog('Link a component recipe','<p class="recipe-muted">Choose a Final recipe. Its exact version is retained until you adopt a newer one.</p><label>Search components<input type="search" data-component-search></label><div data-component-results></div>');await findComponents('');return;
 }else if(name==='choose-component'){
  const r=await api('get',{id:a.id,kitchen:true});state.componentChoice=r;setDialog('Choose component size',r.document.variants.map(size=>`<div class="recipe-resource-row"><span>${esc(size.name)} · ${esc(size.yield.quantity)} ${esc(size.yield.unit)}</span>${button('Use size','attach-component',`data-variant="${esc(size.id)}"`)}</div>`).join(''));return;
 }else if(name==='attach-component'){const r=state.componentChoice,size=r.document.variants.find(v=>v.id===a.variant);v.components.push({id:model.id(),name:r.document.name,version_id:r.version_id,variant_id:size.id,quantity:size.yield.quantity,unit:size.yield.unit,mode:'pinned'});closeDialog();
 }else if(name==='update-component'){
  const c=v.components[Number(a.index)],related=state.record?.links.find(l=>l.version_id===c.version_id);if(!related)throw Error('Save this link first to check for an update.');const latest=await api('get',{id:related.recipe_id,kitchen:true});if(latest.version_id===c.version_id){notify('This component already uses the current production version.');return;}if(!latest.document.variants.some(size=>size.id===c.variant_id))throw Error('The original size was removed. Link the new component size explicitly.');if(!await confirmDialog(`Adopt ${latest.document.name} version ${latest.version} in this working draft? Save a new recipe version to publish the change.`,{confirmLabel:'Adopt version'}))return;c.version_id=latest.version_id;
 }else if(name==='open-component'){
  const link=v.components[Number(a.index)],r=await api('get',{id:a.id,version_id:a.version,kitchen:state.kitchen,rd:state.rd,...(state.role==='kitchen'?{root_id:state.record.root_id||state.record.id,root_version:state.record.root_version||state.record.version_id}:{})});
  const size=r.document.variants.find(size=>size.id===link?.variant_id)||(!link?.variant_id?r.document.variants[0]:null);
  if(!link||!size)throw Error('This linked component size is unavailable.');
  const needed=multiply(quantity(link.quantity),scaleFactor(v.yield,state.scale.mode,state.scale.target)),plan=componentPlan(size.yield.quantity,needed,{wholeBatches:state.wholeComponents});
  setDialog(r.document.name,`<p>Version ${r.version} · ${esc(size.name)} · Prepare ${esc(exact(plan.produced))} ${esc(size.yield.unit)}${state.wholeComponents?` · ${esc(exact(plan.leftover))} ${esc(size.yield.unit)} left over`:''}</p>${scaleIngredients(size.groups,plan.batches).map(g=>`<h3>${esc(g.name)}</h3><table class="recipe-table"><thead><tr><th>Ingredient</th><th>Quantity needed</th></tr></thead><tbody>${g.ingredients.map(row=>`<tr><td>${esc(row.name)}</td><td class="numeric">${esc(displayQuantity(row.scaled_quantity).text)} ${esc(row.unit)}</td></tr>`).join('')}</tbody></table>`).join('')}${size.methods.map(m=>`<h3>${esc(m.name)}</h3><ol>${m.steps.map(step=>`<li>${esc(step.instruction)}${step.timer_minutes||step.temperature?`<p class="recipe-muted">${[step.timer_minutes?`${step.timer_minutes} min`:'',step.temperature].filter(Boolean).map(esc).join(' · ')}</p>`:''}</li>`).join('')}</ol>`).join('')}`);return;
 }else if(name==='cost-preview')return costPreview();
 else if(name==='versions')return versions();
 else if(name==='history-page')return versions(Number(a.offset));
 else if(name==='compare-version'){
  const old=await api('get',{id:state.record.id,version_id:a.version}),changes=model.differences(model.normalizeRecipe(old.document),state.doc);setDialog(`Version ${old.version} → ${state.record.version}`,`<div class="recipe-table-wrap"><table class="recipe-table recipe-diff"><thead><tr><th>Field</th><th>Earlier value</th><th>Current value</th></tr></thead><tbody>${changes.map(c=>`<tr><td>${esc(c.field)}</td><td>${esc(typeof c.before==='object'?JSON.stringify(c.before):c.before)}</td><td>${esc(typeof c.after==='object'?JSON.stringify(c.after):c.after)}</td></tr>`).join('')||'<tr><td colspan="3">No formula differences.</td></tr>'}</tbody></table></div>`);return;
 }else if(name==='restore-version'){
  if(!await confirmDialog('Restore this version as a new draft? The production recipe stays unchanged.',{confirmLabel:'Restore as draft'}))return;
  const r=await api('restore_version',{version_id:a.version,revision:state.record.revision,status:'draft',reason:'Restored historical version'});closeDialog();return openRecipe(r.id);
 }else if(['duplicate','variation','duplicate-version'].includes(name)){
  const r=await api('duplicate',{version_id:a.version||state.record.version_id,mode:name==='variation'?'variation':'exact'});closeDialog();beginEdit(r);notify('Created a separate draft with a new recipe ID.');return;
 }else if(name==='scaled-copy'){const doc=model.scaledCopy(state.doc,v.id,scaleFactor(v.yield,state.scale.mode,state.scale.target),state.scale);beginEdit(null,doc);notify('Review this scaled copy, then save it as a new recipe.');return;}
 else if(name==='reset-checks'){for(const g of v.groups)for(const row of g.ingredients)sessionStorage.removeItem(checkKey(row.id));for(const [mi,m]of v.methods.entries())for(const [si,s]of m.steps.entries())sessionStorage.removeItem(checkKey(s.id||'legacy-step-'+mi+'-'+si));renderRecipe();return;}
 else if(name==='test-photo')return uploadTestPhoto();
 else if(name==='tests')return tests();
 else if(name==='runs')return productionHistory();
 else if(name==='add-test')return testEditor();
 else if(name==='edit-test')return testEditor(state.tests.find(t=>t.id===a.id));
 else if(name==='edit-test-formula')return testEditor(state.tests.find(t=>t.id===a.id));
 else if(name==='promote-test'){
  if(!await confirmDialog('Publish this test’s saved formula as the new production version?',{confirmLabel:'Promote test'}))return;
  const r=await api('promote_test',{test_id:a.id,revision:state.record.revision,status:'production',reason:'Promoted successful R&D test'});closeDialog();return openRecipe(r.id);
 }else if(name==='delete'){
  if(!await confirmDialog('Move this recipe to Recently deleted? Historical versions and backups are retained.',{confirmLabel:'Remove recipe',danger:true}))return;
  await api('delete',{id:state.record.id,revision:state.record.revision});return library();
 }else if(name==='undelete'){await api('undelete',{id:state.record.id,revision:state.record.revision});return openRecipe(state.record.id);}
 else if(name==='add-resource')return resourceEditor();
 else if(name==='edit-resource')return resourceEditor(state.resources.find(r=>r.id===a.id));
 else if(name==='price-history'){const rows=await api('prices',{id:a.id,limit:100}),form=dialogBody.querySelector('#recipe-resource-form');let section=form?.querySelector('[data-price-history]');if(!section){section=document.createElement('section');section.dataset.priceHistory='';section.className='recipe-form-section';form?.append(section);}section.innerHTML=`<h3>Purchase price history</h3><div class="recipe-table-wrap"><table class="recipe-table"><thead><tr><th>Recorded</th><th>Supplier</th><th>Price</th><th>Purchase quantity</th></tr></thead><tbody>${rows.map(p=>`<tr><td>${date(p.created_at)}${p.notes?`<small class="recipe-muted" style="display:block">${esc(p.notes)}</small>`:''}</td><td>${esc(p.supplier_name||'Not specified')}</td><td>${money(p.amount)}</td><td>${esc(p.quantity)} ${esc(p.unit)}</td></tr>`).join('')}</tbody></table></div>`;section.scrollIntoView({block:'nearest'});return;}
 else if(name==='resend-invitation'){const person=state.accessPeople.find(p=>p.invitation_id===a.id);await api('invite_access',{email:person.email,permission:person.recipe_permission,resend:true,send_email:true});await access();notify('Invitation queued for delivery.');return;}
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
 else if(name==='csv'){await api('export_authorize',{kind:'csv'});await api('get',{id:state.record.id,version_id:state.record.version_id,kitchen:state.kitchen});const plan=await currentProductionPlan();download(model.csvTotals(plan.totals),`${state.doc.name}-ingredients.csv`,'text/csv;charset=utf-8');return;}
 else if(name==='production-totals')return showProductionTotals();
 else if(name==='compare-base'){const link=state.record.links.find(l=>l.kind==='variation');if(!link)throw Error('Variation base was not found.');const base=await api('get',{id:link.recipe_id,version_id:link.version_id});const changes=model.differences(model.normalizeRecipe(base.document),state.doc).filter(c=>!c.field.startsWith('base.')&&!c.field.startsWith('detected_allergens'));setDialog(`Changes from ${base.document.name} · version ${base.version}`,`<table class="recipe-table recipe-diff"><thead><tr><th>Field</th><th>Base</th><th>Variation</th></tr></thead><tbody>${changes.map(c=>`<tr><td>${esc(c.field)}</td><td>${esc(JSON.stringify(c.before))}</td><td>${esc(JSON.stringify(c.after))}</td></tr>`).join('')}</tbody></table>`);return;}
 else if(name==='export'||name==='export-library'){const m=await import('./recipe-print.js?v=approved-20261002-1');return m.openRecipeExport({record:name==='export'?state.record:null,production:name==='export'?{variant_id:v.id,factor:exact(scaleFactor(v.yield,state.scale.mode,state.scale.target)),mode:state.scale.mode,target:state.scale.target,wholeComponents:state.wholeComponents}:null,selection:[...state.selection],filters:state.filters,kitchen:state.kitchen,rd:state.rd,settings:state.settings,api,fileUrl:recipeFileUrl,dialog:setDialog});}
 else if(name==='rebuild-import'){if(!await confirmDialog(`Rebuild ingredients and procedures for ${v.name} from the original import? This replaces those sections in your working draft, including any manual edits there. Yield, photos, packaging and other details stay as they are. Your saved recipe will not change until you save a new version.`,{confirmLabel:'Rebuild draft'}))return;const {rebuildImportedSections}=await import('./recipe-import.js?v=approved-20261002-1');const rebuilt=rebuildImportedSections(state.doc,state.variant);state.doc=rebuilt.document;notify(`Rebuilt ${rebuilt.recognized} ingredient rows. Review each component before saving.`);}
 else if(name==='import'){const m=await import('./recipe-import.js?v=approved-20261002-1');return m.openRecipeImport({dialog:setDialog,close:closeDialog,beginEdit,upload:uploadRecipeFile,notify});}
 else return;
 markDirty();renderEditor();
 const focusPath=name==='add-group'?`variants.${state.variant}.groups.${v.groups.length-1}.name`:name==='add-step'?`variants.${state.variant}.methods.${a.method}.steps.${v.methods[Number(a.method)].steps.length-1}.instruction`:name==='add-method'?`variants.${state.variant}.methods.${v.methods.length-1}.steps.0.instruction`:null;
 if(focusPath)root.querySelector(`[data-path="${focusPath}"]`)?.focus();
}
function download(text,filename,type){const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}

// Event handlers are attached once; rendering does not accumulate listeners.
async function handleClick(event){
 const target=event.target.closest('[data-action]');if(!target||target.disabled||state.saving)return;
 target.disabled=true;try{await action(target.dataset.action,target.dataset);}catch(error){showError(error);}finally{target.disabled=false;}
}
root.addEventListener('click',handleClick);dialogBody.addEventListener('click',handleClick);document.querySelector('.recipe-header')?.addEventListener('click',handleClick);
root.addEventListener('submit',event=>{if(event.target.id==='recipe-editor'){event.preventDefault();saveRecipe().catch(showError);}});
root.addEventListener('input',event=>{
 const el=event.target;
 if(el.hasAttribute('data-test-field')){state.testWorkspace.data[el.dataset.testField]=el.value;markDirty();}
 else if(el.hasAttribute('data-cost-filter')&&el.tagName==='INPUT'){clearTimeout(state.costSearchTimer);state.costFilters[el.dataset.costFilter]=el.value;state.costFilters.offset=0;state.request++;state.costSearchTimer=setTimeout(()=>{if(el.isConnected&&state.tab==='costing'&&!state.editing&&!state.record)costingOverview().catch(showError);},350);}
 else if(el.dataset.photoCaption){for(const photo of [...state.doc.photos,...state.doc.variants.flatMap(v=>[...v.photos,...v.packaging.photos])])if(photo.id===el.dataset.photoCaption)photo.caption=el.value;markDirty();}
 else if(el.dataset.path){setPath(state.doc,el.dataset.path,el.dataset.array?el.value.split(',').map(s=>s.trim()).filter(Boolean):el.value);syncSectionName(el);markDirty();

 }else if(el.matches('[data-filter="query"]')){clearTimeout(state.searchTimer);state.filters.query=el.value;state.offset=0;state.request++;persistResourceView();state.searchTimer=setTimeout(()=>{if(el.isConnected&&state.tab==='library'&&!state.editing&&!state.record)library().catch(showError);},400);}
 else if(el.hasAttribute('data-resource-search')){const kind=state.tab;clearTimeout(state.searchTimer);state.resourceQuery=el.value;state.resourceOffset=0;state.resourceRequest++;persistResourceView();state.searchTimer=setTimeout(()=>{if(state.tab===kind)(kind==='categories'?categories({refresh:true}):resources(kind,{refresh:true})).catch(showError);},300);}
});
root.addEventListener('change',async event=>{const el=event.target;try{
 if(el.hasAttribute('data-cost-filter')&&el.tagName==='SELECT'){state.costFilters[el.dataset.costFilter]=el.dataset.costFilter==='recent'?el.value==='true':el.value;state.costFilters.offset=0;await costingOverview();}
 else if(el.hasAttribute('data-cost-fixed')){state.doc.variants[state.variant].additional_costs[Number(el.dataset.costFixed)].per_batch=!el.checked;markDirty();}
 else if(el.id==='recipe-save-status'){state.saveStatus=el.value;markDirty();}
 else if(el.hasAttribute('data-method-group')){state.doc.variants[state.variant].methods[Number(el.dataset.methodGroup)].group_id=el.value;markDirty();renderEditor();}
 else if(el.hasAttribute('data-resource-sort')){state.resourceSort=el.value==='cost'?'cost':'az';state.resourceOffset=0;await resources(state.tab,{refresh:true});}
 else if(el.dataset.photoCaption){for(const photo of [...state.doc.photos,...state.doc.variants.flatMap(v=>[...v.photos,...v.packaging.photos])])if(photo.id===el.dataset.photoCaption)photo.caption=el.value;markDirty();}
 else if(el.dataset.path){setPath(state.doc,el.dataset.path,el.dataset.array?el.value.split(',').map(s=>s.trim()).filter(Boolean):el.value);markDirty();if(el.dataset.path.endsWith('.costing.mode'))root.querySelector('[data-saleable-settings]').hidden=el.value!=='saleable';

 }else if(el.hasAttribute('data-whole-components')){if(state.role==='kitchen')await api('scale',kitchenGuard.context());state.wholeComponents=el.checked;}
 else if(el.hasAttribute('data-allergen-override')){state.doc.allergen_override=el.checked;markDirty();}
 else if(el.hasAttribute('data-import-reviewed')){state.doc.import_review.reviewed=el.checked;markDirty();}
 else if(el.dataset.filter&&el.dataset.filter!=='query'){const key=el.dataset.filter;if(key==='collection'){delete state.filters.favorites;delete state.filters.pinned;delete state.filters.recent;delete state.filters.deleted;if(el.value)state.filters[el.value]=true;}else state.filters[key]=el.value;state.offset=0;await library();}
 else if(el.dataset.select){if(el.checked)state.selection.add(el.dataset.select);else state.selection.delete(el.dataset.select);}
 else if(el.hasAttribute('data-editor-variant')){state.variant=Number(el.value);renderEditor();}
 else if(el.hasAttribute('data-view-variant')){if(state.role==='kitchen')await api('scale',kitchenGuard.context());state.variant=Number(el.value);state.scale=initialScale(state.doc.variants[state.variant].yield);renderRecipe();}
 else if(el.dataset.scale){if(state.role==='kitchen')await api('scale',kitchenGuard.context());state.scale[el.dataset.scale]=el.value;if(el.dataset.scale==='mode'){const option=state.doc.variants[state.variant].yield.scale_options?.find(option=>'custom:'+option.id===el.value);if(option)state.scale.target=String(option.quantity);}renderRecipe();const restored=root.querySelector(`[data-scale="${el.dataset.scale}"]`);restored?.focus({preventScroll:true});}
 else if(el.dataset.check){sessionStorage.setItem(checkKey(el.dataset.check),el.checked?'1':'0');}
 else if(el.dataset.accessRd){
  el.disabled=true;try{await api('save_rd_access',{user_id:el.dataset.accessRd,can_view_rd:el.checked});await access();notify('R&D access updated.');}catch(error){await access();throw error;}
 }else if(el.dataset.accessUser||el.dataset.accessInvitation){
  if(!el.value&&!await confirmDialog('Remove this account’s recipe access?',{confirmLabel:'Remove access',danger:true})){await access();return;}
  el.disabled=true;
  try{if(el.dataset.accessInvitation){const person=state.accessPeople.find(p=>p.invitation_id===el.dataset.accessInvitation);await api(el.value?'invite_access':'remove_invitation',el.value?{email:person.email,permission:el.value,send_email:true}:{invitation_id:person.invitation_id});}
   else await api('save_access',{user_id:el.dataset.accessUser,permission:el.value||null});await access();notify('Recipe access updated.');
  }catch(error){await access();throw error;}
 }
 }catch(error){showError(error);}});
root.addEventListener('submit',async event=>{const form=event.target;if(form.id!=='recipe-access-form')return;event.preventDefault();const submit=form.querySelector('[type=submit]');submit.disabled=true;const message=form.querySelector('[data-access-message]');try{const result=await api('invite_access',{...Object.fromEntries(new FormData(form)),send_email:true});await access();const target=root.querySelector('[data-access-message]');target.textContent=result.pending?'Invitation queued. Access begins after they sign in and verify the invited email.':'Recipe access added. The invitation is queued for delivery.';}catch(error){message.textContent=error.message;message.className='recipe-error';}finally{if(submit.isConnected)submit.disabled=false;}});
root.addEventListener('dragstart',event=>{const handle=event.target.closest('.recipe-drag'),row=handle?.closest('[data-ingredient-row]');if(!row)return;draggedRow={group:Number(row.dataset.group),row:Number(row.dataset.ingredientRow)};event.dataTransfer.setData('text/plain',String(draggedRow.row));event.dataTransfer.effectAllowed='move';row.classList.add('dragging');});
root.addEventListener('dragover',event=>{const row=event.target.closest('[data-ingredient-row]');if(row&&draggedRow?.group===Number(row.dataset.group)){event.preventDefault();row.classList.add('drag-over');}});
root.addEventListener('dragleave',event=>event.target.closest('[data-ingredient-row]')?.classList.remove('drag-over'));
root.addEventListener('drop',event=>{const row=event.target.closest('[data-ingredient-row]');if(!row||draggedRow?.group!==Number(row.dataset.group))return;event.preventDefault();move(state.doc.variants[state.variant].groups[draggedRow.group].ingredients,draggedRow.row,Number(row.dataset.ingredientRow));draggedRow=null;markDirty();renderEditor();});
root.addEventListener('dragend',()=>{draggedRow=null;root.querySelectorAll('.dragging,.drag-over').forEach(r=>r.classList.remove('dragging','drag-over'));});
dialogBody.addEventListener('input',event=>{if(event.target.hasAttribute('data-packaging-search')){packagingRequest++;clearTimeout(packagingTimer);const input=event.target;packagingTimer=setTimeout(()=>{if(input.isConnected)findPackaging(input.value);},200);}if(event.target.hasAttribute('data-resource-caption'))state.resourcePhotos[Number(event.target.dataset.resourceCaption)].caption=event.target.value;});
dialogBody.addEventListener('change',async event=>{
 const input=event.target;if(!input.hasAttribute('data-resource-photo')||!input.files?.[0])return;
 const form=input.closest('form'),submit=form.querySelector('[type=submit]'),status=form.querySelector('[data-resource-photo-status]');
 if(state.resourcePhotos.length>=10){status.textContent='Use up to 10 packaging photos.';input.value='';return;}
 input.disabled=true;submit.disabled=true;status.textContent='Preparing and uploading photo…';
 try{const file=await prepareProductImage(input.files[0]),record=await uploadRecipeFile(file);if(!form.isConnected)return;
  state.resourcePhotos.push({file_id:record.id,path:record.path,filename:record.filename,caption:''});await renderResourcePhotos();status.textContent='Photo uploaded. Save packaging to keep it with this item.';
 }catch(error){if(form.isConnected)status.textContent=error.message;}finally{if(form.isConnected){input.disabled=false;input.value='';submit.disabled=false;}}
});
dialogBody.addEventListener('submit',async event=>{
 const form=event.target;if(!['recipe-resource-form','recipe-category-form','recipe-test-form','recipe-filter-form','recipe-run-form'].includes(form.id))return;event.preventDefault();const submit=form.querySelector('[type=submit]');submit.disabled=true;
 try{const f=Object.fromEntries(new FormData(form));
  if(form.id==='recipe-resource-form'){
   const record=state.resourceEditing,data={...(record?.data||{})};for(const [key,value]of Object.entries(f))if(!['name','active','supplier_id','preferred_supplier_id'].includes(key)&&!key.startsWith('price_'))data[key]=key==='allergens'?value.split(',').map(s=>s.trim()).filter(Boolean):value;
   if(state.tab==='packaging')data.photos=state.resourcePhotos;
   const payload={id:record?.id,revision:record?.revision,kind:state.tab,name:f.name,data,active:f.active==='on'};
   if(state.resourceQuotes){const quotes=state.resourceQuotes.read();payload.suppliers=quotes.suppliers;data.supplier_id=quotes.suppliers[0]?.supplier_id||null;data.preferred_supplier_id=quotes.preferred_supplier_id;}
   await api('save_resource',payload);closeDialog();await resources(state.tab);notify('Record saved.');
  }else if(form.id==='recipe-category-form'){await api('save_category',{id:state.categoryEditing.id,revision:state.categoryEditing.revision,...f,active:f.active==='on'});state.categories=(await api('bootstrap')).categories;closeDialog();await categories();}
  else if(form.id==='recipe-test-form'){const t=state.testEditing;await api('save_test',{id:t?.id,revision:t?.revision,recipe_id:state.record.id,version_id:t?.version_id||state.record.version_id,data:{...(t?.data||{}),...f,photos:state.testDraftPhotos},proposed_document:t?.proposed_document||state.record.document});await tests();notify('Test log saved.');}
  else if(form.id==='recipe-run-form'){await api('record_run',{...f,scaling_mode:state.scale.mode,version_id:state.record.version_id,variant_id:state.doc.variants[state.variant].id,multiplier:exact(scaleFactor(state.doc.variants[state.variant].yield,state.scale.mode,state.scale.target))});await productionHistory();notify('Production quantity recorded.');}
  else if(form.id==='recipe-filter-form'){Object.assign(state.filters,f);state.offset=0;closeDialog();await library();}
 }catch(error){showError(error);}finally{if(submit.isConnected)submit.disabled=false;}
});
document.querySelector('[data-dialog-close]').addEventListener('click',closeDialog);
window.addEventListener('beforeunload',event=>{if(state.editing&&state.dirty){event.preventDefault();event.returnValue='';}});

export async function startRecipeLibrary({resume=null}={}){
 await ready;
 if(!auth){shell('<div class="recipe-empty"><h1>Recipe library unavailable</h1><p>Check your connection and reload.</p></div>',{tabs:false});return;}
 const {data:{session}}=await auth.getSession();
 if(!session){kitchenGuard.stop();state.role=null;state.can_view_rd=false;state.rd=false;shell('<div class="recipe-empty"><h1>Your private recipe library</h1><p>Sign in with an authorized account to continue.</p><a class="recipe-button" href="account.html?next=recipes.html">Sign in</a></div>',{tabs:false});return;}
 state.userId=session.user.id;
 try{const started=performance.now(),setup=await api('bootstrap');Object.assign(state,setup);configureRecipeUnits(setup.settings?.recipe_units);if(!canRD())state.rd=false;state.kitchen=state.role==='kitchen'||new URLSearchParams(location.search).get('view')==='kitchen';
  if(!kitchenGuard.start(setup,started))return;
  if(resume&&state.role==='kitchen'){state.rd=Boolean(resume.rd&&canRD());await openRecipe(resume.id);}
  else if(canEdit()&&!state.kitchen&&!state.rd){let saved;try{saved=JSON.parse(sessionStorage.getItem('tlb-recipe-catalog:'+state.userId)||'null');}catch{}
   state.resourceViews=saved?.views&&typeof saved.views==='object'?saved.views:{};state.listViews=saved?.lists&&typeof saved.lists==='object'?saved.lists:{};state.filters=restoreListFilters(state.listViews.library?.filters);state.offset=Math.max(0,Math.min(1000000,Number(state.listViews.library?.offset)||0));state.costFilters=restoreListFilters(state.listViews.costing?.filters);
   if(tableKinds.includes(saved?.active)){const scroll=restoreResourceView(saved.active);if(saved.active==='categories')await categories({scroll});else await resources(saved.active,{scroll});}else if(saved?.active==='costing')await costingOverview();else await library();
  }else await library();
 }catch(error){if(state.role==='kitchen'&&kitchenGuard.locked)return;shell(`<div class="recipe-empty"><h1>Recipe access required</h1><p>${esc(error.message)}</p><a class="recipe-button" href="account.html">My account</a></div>`,{tabs:false});}
}
ready.then(()=>auth?.onAuthStateChange?.((event,session)=>{
 if(['SIGNED_OUT','SIGNED_IN','TOKEN_REFRESHED','USER_UPDATED'].includes(event))invalidateLibrary();
 if(event==='SIGNED_OUT'||(event==='SIGNED_IN'&&state.userId&&session?.user?.id&&session.user.id!==state.userId)){
  kitchenGuard.stop();state.resumeKitchen=null;
  try{sessionStorage.removeItem('tlb-recipe-catalog:'+state.userId);}catch{}state.resourceViews={};state.listViews={};state.resourceLoadedView=null;state.lastListTab=null;
  clearPrivateView();state.role=null;state.userId=null;state.can_view_rd=false;state.rd=false;setTimeout(()=>startRecipeLibrary().catch(showError),0);
 }
}));

async function currentProductionPlan(){
 if(state.role==='kitchen')await api('scale',kitchenGuard.context());
 const v=state.doc.variants[state.variant];
 return model.productionPlan(state.record,v.id,scaleFactor(v.yield,state.scale.mode,state.scale.target),{wholeComponents:state.wholeComponents,loadRecipe:async(link,parent)=>{
  const related=parent.links.find(l=>l.version_id===link.version_id);if(!related)throw Error('A saved component link is missing.');return api('get',{id:related.recipe_id,version_id:link.version_id,kitchen:state.kitchen,rd:state.rd,...(state.role==='kitchen'?{root_id:state.record.root_id||state.record.id,root_version:state.record.root_version||state.record.version_id}:{})});
 }});
}
async function showProductionTotals(){
 const plan=await currentProductionPlan();
 setDialog('Production ingredient totals',`<p class="recipe-muted">Combined ingredients include linked component recipes. Quantities remain exact.</p><table class="recipe-table"><thead><tr><th>Ingredient</th><th>Prepare</th></tr></thead><tbody>${plan.totals.map(r=>`<tr><td>${esc(r.name)}${r.brand?` · ${esc(r.brand)}`:''}</td><td class="numeric">${esc(r.display)} ${esc(r.unit)}</td></tr>`).join('')}</tbody></table>${plan.components.length?`<h3>Component preparation</h3><table class="recipe-table"><thead><tr><th>Component</th><th>Required</th><th>Batches</th><th>Left over</th></tr></thead><tbody>${plan.components.map(c=>`<tr><td>${esc(c.name)} · v${c.version}</td><td>${esc(c.required)} ${esc(c.unit)}</td><td>${esc(c.batches)}</td><td>${esc(c.leftover)} ${esc(c.unit)}</td></tr>`).join('')}</tbody></table>`:''}`);
}

async function renderTestPhotos(){
 const target=state.testWorkspace?root.querySelector('[data-test-photos]'):dialogBody.querySelector('[data-test-photos]');if(!target)return;target.replaceChildren();
 for(const file of state.testDraftPhotos.filter(f=>!f.test_formula)){const img=document.createElement('img');img.alt='R&D test photo';img.src=await recipeFileUrl(file.path);if(target.isConnected)target.append(img);}
}
function uploadTestPhoto(){
 const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp,image/heic,image/heif';
 input.addEventListener('change',async()=>{try{if(!input.files[0])return;const file=await prepareProductImage(input.files[0]),uploaded=await uploadRecipeFile(file);state.testDraftPhotos.push(uploaded);if(state.testWorkspace)markDirty();await renderTestPhotos();notify('Photo ready. Save the testing log to attach it.');}catch(error){showError(error);}});input.click();
}

async function productionHistory(){
 const rows=await api('runs',{id:state.record.id,limit:100}),v=state.doc.variants[state.variant],factor=exact(scaleFactor(v.yield,state.scale.mode,state.scale.target));
 setDialog('Production history',`${['approved','production'].includes(state.record.status)?`<form id="recipe-run-form"><h3>Record a completed batch</h3><p>Version ${state.record.version} · ${esc(v.name)} · multiplier ×${factor}</p><div class="recipe-fields two"><label>Produced on<input name="produced_on" type="date" required value="${new Date().toLocaleDateString('en-CA')}"></label><label>Actual finished yield · ${esc(v.yield.unit)}<input name="actual_yield" inputmode="decimal" required></label><label class="wide">Production notes<textarea name="notes"></textarea></label></div><p class="recipe-muted">This adds a production record without changing the recipe.</p><button type="submit" class="primary">Record production</button></form>`:'<p class="recipe-muted">Open a Final version to record a completed batch.</p>'}<h3>Recorded batches</h3><table class="recipe-table"><thead><tr><th>Date</th><th>Planned</th><th>Actual</th><th>Notes</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.produced_on)}</td><td>${esc(r.planned_yield)} ${esc(r.yield_unit)}</td><td>${esc(r.actual_yield)} ${esc(r.yield_unit)}</td><td>${esc(r.notes)}</td></tr>`).join('')||'<tr><td colspan="4">No batches recorded yet.</td></tr>'}</tbody></table>`);
}

async function findComponents(query){
 const target=dialogBody.querySelector('[data-component-results]'),result=await api('list',{kitchen:true,query,limit:30});if(!target?.isConnected)return;
 target.innerHTML=result.rows.filter(r=>r.id!==state.record?.id).map(r=>`<div class="recipe-resource-row"><span>${esc(r.name)} · v${r.version}</span>${button('Link','choose-component',`data-id="${r.id}"`)}</div>`).join('')+`<p class="recipe-muted">${result.total} matches. Refine the search to find any Final recipe.</p>`;
}
let componentSearchTimer;
dialogBody.addEventListener('input',event=>{if(event.target.hasAttribute('data-component-search')){clearTimeout(componentSearchTimer);const query=event.target.value;componentSearchTimer=setTimeout(()=>findComponents(query).catch(showError),250);}});

root.addEventListener('keydown',event=>{if(event.altKey&&event.key==='Enter'&&event.target.closest('[data-ingredient-row]')){event.preventDefault();const gi=Number(event.target.closest('[data-ingredient-row]').dataset.group);state.doc.variants[state.variant].groups[gi].ingredients.push(model.ingredient());markDirty();renderEditor();root.querySelector(`[data-group="${gi}"][data-ingredient-row="${state.doc.variants[state.variant].groups[gi].ingredients.length-1}"] input`)?.focus();}});
