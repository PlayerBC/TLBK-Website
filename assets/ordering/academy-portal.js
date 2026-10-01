import {ready,auth,academyPortalApi as rawApi,academyPortalMedia,academyPortalUpload,escapeHtml as esc} from './client.js?v=academy-audit-1';
import {academyErrorMessage} from './academy-errors.js?v=academy-audit-1';
import {prepareProductImage,productImageAccept} from './product-image.js';
import {photoTrayMarkup,mountPhotoTray} from './academy-photo-tray.js?v=academy-ux-1';
import {renderBakingRecipe,bindBakingRecipe} from './academy-recipe-view.js?v=academy-ux-1';
import {mountAcademyGallery} from './academy-gallery-view.js?v=academy-ux-1';
const root=document.getElementById('academy-app'),isAdmin=location.pathname.includes('/academy/admin');
let user=null,dashboard=null,generation=0;const urls=new Set(),viewCleanups=new Set(),mediaCache=new Map(),mediaLoading=new Set(),mediaQueue=new Set();
let mediaEpoch=0,mediaObserver=null,activeThread=null,galleryController=null,galleryMemory=null;
async function api(action,payload={}){
 const epoch=generation,actor=user?.id;
 const result=await rawApi(action,payload);
 if(epoch!==generation||actor!==user?.id){const error=new Error('');error.code='ACADEMY_STALE';throw error;}
 return result;
}
const date=v=>v?new Intl.DateTimeFormat('en-PH',{dateStyle:'medium',timeZone:'Asia/Manila'}).format(new Date(v)):'';
const brand='<a class="ap-brand" href="/academy/dashboard" aria-label="TLB Academy by TLB Kitchen"><img src="/assets/img/brands/tlb-academy-logo.png" alt="TLB Academy" width="180" height="180"><small>by TLB Kitchen</small></a>';
const link=(text,href,secondary=false)=>`<a class="ap-button ${secondary?'secondary':''}" href="${esc(href)}">${esc(text)}</a>`;
const button=(text,action,secondary=false)=>`<button type="button" class="ap-button ${secondary?'secondary':''}" data-action="${esc(action)}">${esc(text)}</button>`;
const field=(label,name,value='',type='text',required=false)=>`<label>${esc(label)}<input name="${esc(name)}" type="${type}" value="${esc(value??'')}" ${required?'required':''}></label>`;
const area=(label,name,value='')=>`<label>${esc(label)}<textarea name="${esc(name)}">${esc(value??'')}</textarea></label>`;
const options=(items,selected)=>items.map(([value,label])=>`<option value="${esc(value)}" ${String(selected??'')===String(value)?'selected':''}>${esc(label)}</option>`).join('');
const select=(label,name,items,selected='',required=false)=>`<label>${esc(label)}<select name="${name}" aria-label="${esc(label)}" ${required?'required':''}>${options(items,selected)}</select></label>`;
const check=(label,name,checked=false)=>`<label class="ap-check"><input type="checkbox" name="${name}" ${checked?'checked':''}>${esc(label)}</label>`;
const empty=(title,copy='')=>`<div class="ap-empty"><h3>${esc(title)}</h3>${copy?`<p class="ap-muted">${esc(copy)}</p>`:''}</div>`;
const heading=(title,copy='',action='')=>`<div class="ap-section-head"><div><h2>${esc(title)}</h2>${copy?`<p>${esc(copy)}</p>`:''}</div>${action}</div>`;
const photo=(id,alt='',className='ap-photo')=>id?`<img class="${className}" data-media-id="${esc(id)}" alt="${esc(alt)}" loading="lazy">`:`<div class="${className} empty" aria-hidden="true">TLB Academy</div>`;
const safeHref=value=>{try{const u=new URL(value,location.origin);return u.protocol==='https:'||(u.origin===location.origin&&value.startsWith('/'))?u.href:'';}catch{return '';}};
function clearMedia(){
 mediaEpoch++;mediaObserver?.disconnect();mediaObserver=null;mediaQueue.clear();mediaLoading.clear();
 for(const url of urls)URL.revokeObjectURL(url);urls.clear();mediaCache.clear();
 document.querySelectorAll('.ap-dialog').forEach(d=>d.remove());
}
function cleanupView(){for(const cleanup of viewCleanups)cleanup();viewCleanups.clear();activeThread=null;galleryController=null;clearMedia();}
function registerCleanup(fn){viewCleanups.add(fn);}
function notice(message,error=false){if(!message)return;const n=document.getElementById('ap-notice');if(n){n.hidden=false;n.className='ap-banner'+(error?' error':'');n.textContent=message;n.focus();}}
function navigation(active,config){
 const enrolled=Boolean(dashboard?.classes?.length);
 const items=[['dashboard','Overview'],['classes','My classes'],['gallery','Student gallery'],['announcements','Announcements'],['upcoming','Upcoming classes'],...(enrolled?[['messages','My messages']]:[]),['preferences','Email preferences']];
 const primary=config?.primary|| (enrolled?['dashboard','classes','gallery','messages']:['dashboard','gallery','upcoming','announcements']);
 const groups=config?.groups||[['',items]];
 const all=groups.flatMap(([,links])=>links),prefix=config?'#':'/academy/dashboard#';
 const navLink=([id,title])=>`<a href="${prefix}${id}" data-nav-id="${id}" ${id===active?'aria-current="page"':''}>${esc(title)}</a>`;
 const utilities=`${!config&&(dashboard?.admin||dashboard?.instructor)?'<a href="/academy/admin">Academy admin ↗</a>':config?'<a href="/academy/dashboard">My Academy ↗</a>':''}<a href="/account.html">My TLB account</a><a href="/shop.html">Back to the kitchen ↗</a><button class="ap-button secondary" data-action="signout">Sign out</button>`;
 return {key:JSON.stringify([user?.id,groups,primary,Boolean(config),dashboard?.admin,dashboard?.instructor]),
  desktop:`${brand}<nav class="ap-nav" aria-label="${config?'Academy workspace':'Academy'}">${groups.map(([name,links])=>`<div class="ap-nav-group">${name?`<p>${esc(name)}</p>`:''}${links.map(navLink).join('')}</div>`).join('')}</nav><div class="ap-sidebar-bottom">${utilities}</div>`,
  mobile:`<div class="ap-mobile-brand">${brand}<a class="ap-pill" href="/account.html">My account</a></div><nav class="ap-mobile-nav" aria-label="${config?'Academy workspace':'Academy'}">${primary.map(id=>all.find(item=>item[0]===id)).filter(Boolean).map(navLink).join('')}<details class="ap-more"><summary>More</summary><div class="ap-more-links">${all.filter(([id])=>!primary.includes(id)).map(navLink).join('')}${utilities}</div></details></nav>`};
}
let chromeKey='';
function shell(content,active='dashboard',config={}){
 cleanupView();root.setAttribute('aria-busy','false');root.dataset.layout=config.focus||'';
 const nav=navigation(active,config.navigation);
 if(!root.querySelector('#ap-page-content')){
  root.innerHTML='<a class="ap-skip" href="#ap-page-content">Skip to content</a><aside class="ap-sidebar"></aside><header class="ap-mobile-header"></header><main class="ap-main"><div class="ap-top"><span>YOUR LITTLE CORNER OF THE ACADEMY</span><a class="ap-pill" href="/account.html">My account ↗</a></div><div id="ap-route-progress" class="ap-route-progress" role="status" hidden>Opening Academy…</div><div id="ap-notice" role="status" tabindex="-1" hidden></div><div id="ap-page-content" tabindex="-1"></div></main>';
  chromeKey='';
 }
 if(chromeKey!==nav.key){
  root.querySelector('.ap-sidebar').innerHTML=nav.desktop;root.querySelector('.ap-mobile-header').innerHTML=nav.mobile;chromeKey=nav.key;
  root.querySelectorAll('[data-action=signout]').forEach(b=>b.onclick=async()=>{generation++;galleryMemory=null;cleanupView();root.innerHTML='';await auth.signOut();location.href='/academy/dashboard';});
  root.querySelectorAll('.ap-more a').forEach(a=>a.addEventListener('click',()=>a.closest('details').open=false));
  root.querySelectorAll('.ap-more').forEach(more=>more.addEventListener('keydown',event=>{if(event.key==='Escape'){more.open=false;more.querySelector('summary').focus();}}));
 }
 root.querySelectorAll('[data-nav-id]').forEach(a=>{if(a.dataset.navId===active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
 const page=root.querySelector('#ap-page-content');page.inert=false;page.innerHTML=content;
 root.querySelector('#ap-notice').hidden=true;root.querySelector('#ap-route-progress').hidden=true;
 hydrate(page);
}
function showLoading(){
 root.setAttribute('aria-busy','true');
 const progress=root.querySelector('#ap-route-progress'),page=root.querySelector('#ap-page-content');
 if(progress){progress.hidden=false;progress.textContent='Opening Academy…';}if(page)page.inert=true;
}
function hydrate(scope){
 const nodes=[...scope.querySelectorAll('[data-media-id]')].filter(n=>!n.src);
 const enqueue=node=>{const ready=mediaCache.get(node.dataset.mediaId);if(ready){node.src=ready;return;}mediaQueue.add(node);queueMicrotask(flushMedia);};
 if(!('IntersectionObserver' in window)){nodes.forEach(enqueue);return;}
 mediaObserver ||= new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){mediaObserver.unobserve(entry.target);enqueue(entry.target);}},{rootMargin:'180px'});
 for(const node of nodes)mediaObserver.observe(node);
}
async function flushMedia(){
 const nodes=[...mediaQueue].filter(n=>n.isConnected&&!n.src);mediaQueue.clear();
 const ids=[...new Set(nodes.map(n=>n.dataset.mediaId))].filter(id=>!mediaLoading.has(id)&&!mediaCache.has(id));if(!ids.length)return;
 const epoch=generation,mediaVersion=mediaEpoch;ids.forEach(id=>mediaLoading.add(id));
 const current=()=>epoch===generation&&mediaVersion===mediaEpoch;
 const targets=id=>[...document.querySelectorAll('[data-media-id]')].filter(n=>n.dataset.mediaId===id&&n.isConnected);
 try{
  const records=await api('media',{ids});
  await Promise.all(records.map(async record=>{
   try{const blob=await academyPortalMedia(record.path);if(!current()||!targets(record.id).length)return;const url=URL.createObjectURL(blob);urls.add(url);mediaCache.set(record.id,url);targets(record.id).forEach(n=>n.src=url);}
   catch{if(current())targets(record.id).forEach(n=>n.alt='Photo unavailable');}
  }));
 }catch{if(current())ids.forEach(id=>targets(id).forEach(n=>n.alt='Photo unavailable'));}
 finally{if(current())ids.forEach(id=>mediaLoading.delete(id));}
}
function dialog(title,content){
 const el=document.createElement('dialog');el.className='ap-dialog';el.setAttribute('aria-labelledby','ap-dialog-'+crypto.randomUUID());
 el.innerHTML=`<button class="ap-dialog-close" aria-label="Close">×</button><h2 id="${el.getAttribute('aria-labelledby')}">${esc(title)}</h2>${content}`;
 document.body.append(el);el.querySelector('button').onclick=()=>el.close();el.addEventListener('close',()=>el.remove());el.showModal();hydrate(el);return el;
}
function fieldError(form,control,message){
 if(!control)return;const old=control.getAttribute('data-error-id');if(old)document.getElementById(old)?.remove();
 const id='ap-field-'+crypto.randomUUID(),n=document.createElement('p');n.id=id;n.className='ap-field-error';n.textContent=message;
 control.setAttribute('data-error-id',id);control.setAttribute('aria-invalid','true');control.setAttribute('aria-describedby',[control.getAttribute('aria-describedby'),id].filter(Boolean).join(' '));
 control.closest('label')?.after(n);
}
function formSubmit(form,handler){
 let busy=false;
 form.addEventListener('invalid',event=>fieldError(form,event.target,event.target.validationMessage),true);
 form.addEventListener('input',event=>{const control=event.target,id=control.getAttribute('data-error-id');if(id){document.getElementById(id)?.remove();control.removeAttribute('aria-invalid');control.removeAttribute('data-error-id');control.setAttribute('aria-describedby',(control.getAttribute('aria-describedby')||'').split(' ').filter(v=>v!==id).join(' '));} });
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;busy=true;const buttons=[...form.querySelectorAll('button[type=submit]')];buttons.forEach(b=>b.disabled=true);form.querySelector('[data-form-error]')?.remove();
  try{await handler(new FormData(form),form);}catch(error){
   if(error.code==='ACADEMY_STALE'||!form.isConnected)return;
   const message=academyErrorMessage(error);
   if(error.field==='photos'&&form.querySelector('[data-photo-error]')){const n=form.querySelector('[data-photo-error]');n.textContent=message;n.hidden=false;n.tabIndex=-1;form.elements.photos.setAttribute('aria-invalid','true');n.focus();return;}
   const n=document.createElement('p');n.dataset.formError='';n.role='alert';n.tabIndex=-1;n.className='ap-field-error';n.textContent=message;form.append(n);
   const name=error.field||(/(?:write|add).*(?:message|reply)/i.test(message)?'body':/title|subject/i.test(message)?'title':null),control=name?form.elements[name]:null;
   if(control?.tagName)fieldError(form,control,message);n.focus();
  }finally{busy=false;buttons.forEach(b=>b.disabled=false);form.dispatchEvent(new Event('ap:form-complete'));}
 });
}

function classCards(classes){return classes.length?`<div class="ap-grid two ap-class-grid">${classes.map(c=>`<article class="ap-card ap-class-card">${photo(c.thumbnail_id,c.name)}<div class="ap-card-content"><p class="ap-category">${c.module_count} modules · your class</p><h3>${esc(c.name)}</h3><p class="ap-small ap-muted">Instructor: ${esc(c.instructor||'To be assigned')}</p><p class="ap-class-description">${esc(c.description)}</p><div class="ap-actions">${link('Open class',`#class/${c.id}`)}${c.recipe_shortcut?`<a class="ap-link" href="#recipe/${c.id}/${c.recipe_shortcut.id}">${esc(c.recipe_shortcut.title)} →</a>`:''}</div>${c.unread&&c.reply_thread_id?`<a class="ap-reply-link" href="#thread/${c.reply_thread_id}">${c.unread} new ${c.unread===1?'reply':'replies'} · Read reply →</a>`:''}</div></article>`).join('')}</div>`:empty("You don't have any Academy classes linked to your account yet.",'Explore upcoming workshops, Academy updates, and what our students are baking.');}
function replyCards(classes){const unread=classes.filter(c=>c.unread&&c.reply_thread_id);return unread.length?`<section class="ap-reply-summary" aria-label="New instructor replies"><div><p class="ap-category">From your instructors</p><h2>${unread.reduce((sum,c)=>sum+Number(c.unread),0)} new ${unread.reduce((sum,c)=>sum+Number(c.unread),0)===1?'reply':'replies'}</h2></div><div>${unread.map(c=>`<a href="#thread/${c.reply_thread_id}">${esc(c.name)} · Read reply →</a>`).join('')}</div></section>`:'';}
function galleryCards(posts){return posts.length?`<div class="ap-grid gallery">${posts.map(p=>`<article class="ap-card"><button class="ap-gallery-open" data-post="${p.id}" aria-label="View ${esc(p.title)}">${photo(p.media[0]?.id,p.title)}${p.media.length>1?`<span class="ap-photo-count">${p.media.length} photos</span>`:''}</button><div class="ap-card-content"><p class="ap-category">${esc(p.category)}</p><h3>${esc(p.title)}</h3><p class="ap-small ap-muted">Made in: ${esc(p.class_name)}</p><p class="ap-small">Shared by ${esc(p.display_name)}</p></div></article>`).join('')}</div>`:empty('The gallery is warming up.','Approved student creations will appear here, from every Academy class.');}
function bindGallery(){root.querySelectorAll('[data-post]').forEach(b=>b.onclick=()=>{history.pushState({academyGalleryParent:location.hash||'#dashboard'},'','#gallery/'+b.dataset.post);route();});}
function upcomingCards(rows){return rows.length?`<div class="ap-grid two">${rows.map(c=>`<article class="ap-card ap-upcoming-card">${c.thumbnail_id?photo(c.thumbnail_id,c.title):''}<div class="ap-card-content"><p class="ap-schedule"><span>When</span><strong>${esc(c.schedule||date(c.starts_at)||'Schedule to be announced')}</strong></p><h3>${esc(c.title)}</h3><p class="ap-muted">${esc(c.description)}</p>${c.products.length?`<p class="ap-small"><strong>What you will make</strong></p><ul class="ap-product-list">${c.products.map(p=>`<li>${esc(p)}</li>`).join('')}</ul>`:''}${safeHref(c.inquiry_url)?link(c.cta||'Inquire about this class',safeHref(c.inquiry_url),true):''}</div></article>`).join('')}</div>`:empty('More time in the kitchen, coming soon.','New workshops will be announced here.');}
function announcements(rows){return rows.length?`<div class="ap-grid two">${[...rows].sort((a,b)=>Number(a.read)-Number(b.read)||new Date(b.publish_at)-new Date(a.publish_at)).map(a=>`<article class="ap-card ap-announcement ${a.read?'is-read':'is-unread'}"><div class="ap-card-content"><p class="ap-category">${date(a.publish_at)} <span class="ap-read-state">${a.read?'Read':'Unread'}</span></p><h3>${esc(a.title)}</h3><p>${esc(a.summary)}</p><button class="ap-button secondary small" data-announcement="${a.id}">Read announcement →</button></div></article>`).join('')}</div>`:empty('You’re all caught up.','Academy news and updates will appear here.');}
function bindAnnouncements(){root.querySelectorAll('[data-announcement]').forEach(b=>b.onclick=async()=>{try{const a=await api('announcement',{id:b.dataset.announcement});const card=b.closest('article');card.classList.remove('is-unread');card.classList.add('is-read');card.querySelector('.ap-read-state').textContent='Read';const current=dashboard.announcements?.find(x=>x.id===a.id);if(current)current.read=true;dialog(a.title,`${a.thumbnail_id?photo(a.thumbnail_id,a.title):''}<div class="ap-copy">${esc(a.content)}</div>${safeHref(a.cta_url)?link(a.cta||'Learn more',safeHref(a.cta_url),true):''}`);}catch(e){notice(academyErrorMessage(e),true);}});}

async function showGallery(postId){
 const state=galleryMemory?.actor===user.id&&Date.now()-galleryMemory.at<15*60*1000?galleryMemory:{};
 const actor=user.id;
 galleryController=await mountAcademyGallery({api,root,shell,heading,options,button,galleryCards,bindGallery,hydrate,dialog,photo,esc,notice,errorMessage:academyErrorMessage,
  closeGalleryPost:()=>{if(history.state?.academyGalleryParent?.startsWith('#gallery'))history.back();else{history.replaceState(null,'','#gallery');route();}}
 },{state,postId,onState:value=>{if(user?.id===actor)galleryMemory={...value,actor};}});
 registerCleanup(()=>galleryController?.dispose());
}
async function showClass(id){
 const c=await api('class',{id});
 const recipeLinks=recipes=>recipes.map(r=>`<a class="ap-recipe-link" href="#recipe/${id}/${r.id}"><span>${esc(r.title)}</span><span>Open recipe →</span></a>`).join('');
 shell(`<p class="ap-breadcrumb"><a href="#classes">← My classes</a></p><header class="ap-class-header"><p class="ap-category">Your Academy class</p><h1>${esc(c.name)}</h1><p>${esc(c.description)}</p><p>Instructor: <strong>${esc(c.instructor||'To be assigned')}</strong></p></header><section class="ap-section ap-learning-materials">${heading('Your class modules','Your recipes and notes, ready when you are.')}<p class="ap-copy">${esc(c.notes)}</p>${c.modules.map((m,i)=>`<article class="ap-module"><p class="ap-category">Module ${i+1}</p><h2>${esc(m.name)}</h2><p>${esc(m.description)}</p><div class="ap-recipes">${recipeLinks(c.recipes.filter(r=>r.module_id===m.id))}</div><p class="ap-small">${esc(m.products.join(' · '))}</p><div class="ap-copy">${esc(m.notes)}</div>${m.tips?`<div class="ap-banner ap-copy">${esc(m.tips)}</div>`:''}<div class="ap-grid">${m.photo_ids.map(photoId=>photo(photoId,m.name)).join('')}</div></article>`).join('')||(!c.recipes.length?empty('Your class materials are being prepared.'):'')}<div class="ap-recipes">${recipeLinks(c.recipes.filter(r=>!r.module_id))}</div></section><section class="ap-class-support" aria-label="Class support"><div><h2>Make it together</h2><p>Get help from ${esc(c.instructor||'your instructor')} or share your latest bake.</p></div><div class="ap-actions">${link(`Ask ${c.instructor||'instructor'}`,`#ask/${id}`,true)}${c.sharing_enabled?link('Share what you made',`#share/${id}`):''}<details><summary>More class support</summary><p>${link(`Contact Instructor — ${c.instructor||'Your instructor'}`,`#contact/${id}`,true)}</p></details></div></section><section class="ap-section">${heading('Your shared creations')}<div class="ap-thread-list">${c.submissions.filter(s=>s.submitted).map(s=>`<div class="ap-thread-row"><button class="ap-button secondary small" data-submission="${s.id}">${esc(s.title)}</button><span class="ap-small">${s.visibility==='instructor'?'Private to instructor':esc(s.moderation==='pending'?'Pending approval':s.moderation)}</span></div>`).join('')||'<p class="ap-muted">Your submitted work and its review status will appear here.</p>'}</div></section>`,'classes');
 root.querySelectorAll('[data-submission]').forEach(b=>b.onclick=async()=>{try{const s=await api('submission',{id:b.dataset.submission});dialog(s.title,'<p>'+esc(s.visibility==='instructor'?'Private to instructor':s.moderation)+'</p><p class="ap-copy">'+esc(s.caption)+'</p><div class="ap-grid two">'+s.media.map(m=>photo(m.id,s.title)).join('')+'</div>');}catch(e){notice(academyErrorMessage(e),true);}});
}
async function showRecipe(classId,id){
 const [recipe,classInfo]=await Promise.all([api('recipe',{class_id:classId,id}),api('class',{id:classId})]);
 classInfo.canAsk=dashboard.classes.some(c=>c.id===classId);
 shell(renderBakingRecipe({recipe,classInfo,classId,esc,photo,link}),'classes',{focus:'recipe'});bindBakingRecipe(root);
}


const uploadReservations=new WeakMap(),preparedPhotos=new WeakMap();
async function preparePhoto(source){
 let prepared=preparedPhotos.get(source);
 if(!prepared){const file=await prepareProductImage(source),bitmap=await createImageBitmap(file);prepared={file,width:bitmap.width,height:bitmap.height};bitmap.close();preparedPhotos.set(source,prepared);}
 return prepared;
}
async function uploadPhotos(files,context,container){
 if(files.length>8)throw Error('Choose up to eight photos.');
 const records=[];
 for(const source of files){
  const item=document.createElement('div');item.className='ap-upload-item';item.innerHTML='<strong>'+esc(source.name)+'</strong><progress max="100" value="0"></progress><span role="status">Preparing photo…</span>';container.append(item);
  const status=item.querySelector('span'),progress=item.querySelector('progress');
  try{
   let saved=uploadReservations.get(source);if(saved?.context!==JSON.stringify(context))saved=null;
   if(!saved){const {file,width,height}=await preparePhoto(source);const reservation=await api('reserve_media',{...context,size_bytes:file.size,width,height});saved={file,reservation,context:JSON.stringify(context)};uploadReservations.set(source,saved);}
   if(!saved.completed)await academyPortalUpload(saved.reservation.id,saved.file,n=>{progress.value=n;status.textContent='Uploading '+n+'%';});progress.value=100;status.textContent='Photo ready';records.push(saved.reservation);saved.completed=true;
  }catch(e){status.textContent=e.message;const submit=container.closest('form')?.querySelector('button[type=submit]');if(submit)submit.textContent='Retry upload & send';throw Error('A photo could not be uploaded. Retry to continue. '+e.message);}
 }
 return records;
}
async function showCompose(classId,kind,recipeId){
 const c=await api('class',{id:classId});if(!dashboard.classes.some(x=>x.id===classId))throw Error('Active class access is required.');
 const sharing=kind==='share';if(sharing&&!c.sharing_enabled)throw Error('Sharing is not available for this class.');
 const related=recipeId?c.recipes.find(r=>r.id===recipeId):null;if(recipeId&&!related)throw Error('This recipe is not available in your class.');
 const trayMarkup=photoTrayMarkup({label:`Photos ${sharing?'(required)':'(optional)'}`,required:sharing,accept:productImageAccept},esc);
 shell(`<p class="ap-breadcrumb"><a href="#class/${classId}">← ${esc(c.name)}</a></p>${heading(sharing?'Share what you made':`${kind==='ask'?'Ask':'Contact Instructor —'} ${c.instructor}`,sharing?'Show your bake and choose who can see it.':'A private conversation with your assigned instructor.')}<div class="ap-compose-context"><p class="ap-category">${esc(c.name)}</p><p><strong>Instructor: ${esc(c.instructor)}</strong>${related?`<br>Recipe: ${esc(related.title)}`:''}</p></div><form class="ap-form" id="ap-compose">${sharing?trayMarkup:''}${field(sharing?'Product / title':'Subject','title',related?('Question about '+related.title).slice(0,160):'','text',true)}${area(sharing?'Caption':'Message','body')}${sharing?`<fieldset class="ap-audiences"><legend>Who can see this?</legend>${c.gallery_enabled?`<label class="ap-audience"><input type="radio" name="visibility" value="gallery" checked><span><strong>Share to Academy Gallery</strong><small>All signed-in TLB accounts can see this ${c.require_approval?'after instructor/admin approval':'when submitted'}.</small></span></label>`:''}<label class="ap-audience"><input type="radio" name="visibility" value="instructor" ${c.gallery_enabled?'':'checked'}><span><strong>Private to Instructor — ${esc(c.instructor)}</strong><small>Only you, ${esc(c.instructor)}, and authorized Academy Admin can see this.</small></span></label></fieldset>${check('Show my safe display name in the gallery','show_name',true)}`:`<div class="ap-banner">Your message and photos stay private. They won’t appear in the Student Gallery.</div>${trayMarkup}`}<details class="ap-optional-context" ${related?'open':''}><summary>Related class details (optional)</summary><div class="ap-row">${select('Related module','module_id',[['','Class in general'],...c.modules.map(m=>[m.id,m.name])],related?.module_id)}${select('Related recipe','recipe_id',[['','No specific recipe'],...c.recipes.map(r=>[r.id,r.title])],related?.id)}</div>${sharing?select('Product category','category',['Cookies','Brownies','Cupcakes','Cakes','Bread','Pastries','Other'].map(v=>[v,v])):''}</details><div class="ap-upload-list"></div><p class="ap-small" id="ap-visibility"></p><button class="ap-button" type="submit">${sharing?'Submit your creation':'Send private message'}</button></form>`,'classes');
 const form=root.querySelector('#ap-compose'),tray=mountPhotoTray(form,{preparePhoto,required:sharing,esc});registerCleanup(()=>tray.dispose());
 const visibility=()=>{form.querySelector('#ap-visibility').textContent=sharing?(form.elements.visibility.value==='gallery'?`Visible to all signed-in TLB accounts ${c.require_approval?'after instructor/admin approval':'when submitted'}.`:`Visible only to you, ${c.instructor}, and authorized Academy Admin.`):`Visible only to you, ${c.instructor}, and authorized Academy Admin.`;};form.addEventListener('change',visibility);visibility();
 form.elements.recipe_id.onchange=()=>{const recipe=c.recipes.find(r=>r.id===form.elements.recipe_id.value);if(recipe)form.elements.module_id.value=recipe.module_id||'';};
 const requestKey=crypto.randomUUID();form.elements.title.maxLength=160;form.elements.body.maxLength=sharing?5000:10000;form.elements.body.required=!sharing;
 let draft=null,finishedFiles=0,savedFiles=null;
 formSubmit(form,async data=>{
  const body=String(data.get('body')||'').trim();if(!draft&&!sharing&&!body)throw Object.assign(new Error('Write your message.'),{field:'body'});
  const files=savedFiles||await tray.files();
  if(!draft){draft=await api(sharing?'draft_submission':'start_thread',{idempotency_key:requestKey,class_id:classId,title:data.get('title'),subject:data.get('title'),body,caption:body,category:data.get('category')||'Other',visibility:data.get('visibility'),show_name:data.has('show_name'),module_id:data.get('module_id'),recipe_id:data.get('recipe_id'),type:kind==='ask'?'question':'message'});savedFiles=files;[...form.elements].filter(e=>e.tagName!=='BUTTON').forEach(e=>e.disabled=true);tray.lock();}
  for(let i=finishedFiles;i<files.length;i++){await uploadPhotos([files[i]],{purpose:sharing?'submission':'message',class_id:classId,[sharing?'submission_id':'message_id']:draft.id},form.querySelector('.ap-upload-list'));finishedFiles=i+1;}
  await api(sharing?'submit_work':'send_message',{id:draft.id});location.hash=sharing?'class/'+classId:'thread/'+draft.thread_id;
 });
}
async function showThreads(){const rows=await api('threads');shell(`${heading('Your conversations','Questions, baking tips, and replies from your instructors.')}<div class="ap-thread-list">${rows.map(t=>`<a class="ap-thread-row" href="#thread/${t.id}"><div><strong>${esc(t.subject)}</strong><p class="ap-small ap-muted">${esc(t.class_name)} · ${esc(t.instructor)}${t.recipe_title?' · '+esc(t.recipe_title):''}</p></div><span>${t.unread?`<strong>${t.unread} new</strong>`:date(t.last_activity)}${t.resolved?' · Resolved':''}</span></a>`).join('')||empty('No conversations yet.','Open one of your classes to ask your instructor a question.')}</div>`,'messages');}
async function showThread(id,adminNavigation){
 let thread=await api('thread',{id,mark_read:false});
 const messageMarkup=messages=>messages.map(m=>`<article class="ap-message ${m.mine?'mine':''}" data-message-id="${m.id}" tabindex="-1"><p class="ap-small"><strong>${esc(m.sender)}</strong> · ${date(m.created_at)}</p><p class="ap-copy">${esc(m.body)}</p><div class="ap-grid">${m.media.map(p=>photo(p.id,'Private question attachment')).join('')}</div></article>`).join('');
 shell(`<p class="ap-breadcrumb"><a href="#${isAdmin?'inbox':'messages'}">← Conversations</a></p>${heading(thread.subject,`${thread.class_name} · ${thread.instructor}`)}<div class="ap-thread-tools"><p class="ap-small ap-muted" data-thread-state>Private conversation · ${thread.resolved?'Resolved':'Open'}</p>${isAdmin?button(thread.resolved?'Reopen conversation':'Mark resolved','resolve',true):''}${button('Jump to latest','latest',true)}${button('Write a reply','composer',true)}</div><div class="ap-new-reply" hidden role="status"><span>A new reply is ready.</span>${button('Show new reply','new-reply')}</div><div id="ap-thread-messages">${messageMarkup(thread.messages)}</div><section class="ap-reply-composer" aria-labelledby="ap-reply-title"><h2 id="ap-reply-title">Continue the conversation</h2><form class="ap-form" id="ap-thread-form"><label>Your reply<textarea name="body" required maxlength="10000"></textarea></label>${photoTrayMarkup({label:'Optional photos',accept:productImageAccept},esc)}<div class="ap-upload-list"></div><button type="submit" class="ap-button">Send reply</button></form></section>`,isAdmin?'inbox':'messages',{navigation:adminNavigation});
 const form=root.querySelector('#ap-thread-form'),messages=root.querySelector('#ap-thread-messages'),banner=root.querySelector('.ap-new-reply'),tray=mountPhotoTray(form,{preparePhoto,esc});registerCleanup(()=>tray.dispose());
 const latest=()=>{const last=messages.lastElementChild;last?.scrollIntoView({block:'center'});last?.focus({preventScroll:true});};
 const state={id,last:thread.messages.at(-1)?.id,onStatus(status){if(status.last_message_id&&status.last_message_id!==this.last)banner.hidden=false;}};activeThread=state;
 root.querySelector('[data-action=latest]').onclick=latest;
 root.querySelector('[data-action=composer]').onclick=()=>{form.scrollIntoView({block:'start'});form.elements.body.focus({preventScroll:true});};
 const markRead=async()=>{const last=thread.messages.at(-1);if(last)await api('read_thread',{id,message_id:last.id});};
 async function refreshMessages(scroll){
  const fresh=await api('thread',{id,mark_read:false});thread=fresh;const rendered=new Set([...messages.children].map(n=>n.dataset.messageId));messages.insertAdjacentHTML('beforeend',messageMarkup(fresh.messages.filter(m=>!rendered.has(m.id))));
  state.last=fresh.messages.at(-1)?.id;banner.hidden=true;hydrate(messages);await markRead();if(scroll)latest();
 }
 root.querySelector('[data-action=new-reply]').onclick=async event=>{const b=event.currentTarget;b.disabled=true;try{await refreshMessages(true);}catch(e){notice(academyErrorMessage(e),true);}finally{b.disabled=false;}};
 root.querySelector('[data-action=resolve]')?.addEventListener('click',async event=>{try{await api('resolve_thread',{id,resolved:!thread.resolved});thread.resolved=!thread.resolved;event.target.textContent=thread.resolved?'Reopen conversation':'Mark resolved';root.querySelector('[data-thread-state]').textContent='Private conversation · '+(thread.resolved?'Resolved':'Open');}catch(e){notice(academyErrorMessage(e),true);}});
 let requestKey=crypto.randomUUID(),draft=null,finished=0,savedFiles=null;
 formSubmit(form,async data=>{
  const files=savedFiles||await tray.files();
  if(!draft){draft=await api('draft_reply',{id,idempotency_key:requestKey,body:data.get('body')});savedFiles=files;form.elements.body.disabled=true;tray.lock();}
  for(let i=finished;i<files.length;i++){await uploadPhotos([files[i]],{purpose:'message',message_id:draft.id},form.querySelector('.ap-upload-list'));finished=i+1;}
  await api('send_message',{id:draft.id});await refreshMessages(true);form.reset();form.elements.body.disabled=false;tray.reset();form.querySelector('.ap-upload-list').innerHTML='';draft=null;finished=0;savedFiles=null;requestKey=crypto.randomUUID();form.querySelector('button[type=submit]').textContent='Send reply';
 });
 await markRead();
}

async function preferences(){
 shell(`${heading('A little more from TLB','Choose the updates you’d like to receive.')}<div class="ap-grid two ap-preferences"><section class="ap-card"><div class="ap-card-content"><h2>TLB Academy Newsletter</h2><p>New classes, workshops, baking camps, and Academy news.</p><form class="ap-form" id="ap-newsletter">${check('Send me Academy news and promotions','academy',dashboard.academy_newsletter)}<p class="ap-small ap-muted">Optional. Unsubscribe anytime. Class enrollment doesn’t subscribe you.</p><p class="ap-preference-state ap-small" role="status">Saved</p><button type="submit" class="ap-button" disabled>Save Academy preference</button></form></div></section><section class="ap-card"><div class="ap-card-content"><h2>TLB Kitchen Newsletter</h2><div id="ap-kitchen-newsletter" class="newsletter-preferences"></div></div></section></div>`,'preferences');
 const form=root.querySelector('#ap-newsletter');let saved=dashboard.academy_newsletter;
 const sync=()=>{const dirty=form.elements.academy.checked!==saved;form.querySelector('button').disabled=!dirty;form.querySelector('.ap-preference-state').textContent=dirty?'Unsaved changes':'Saved';};
 form.elements.academy.onchange=sync;form.addEventListener('ap:form-complete',sync);
 formSubmit(form,async data=>{const r=await api('newsletter',{academy:data.has('academy')});dashboard.academy_newsletter=saved=r.academy;sync();notice('Your Academy newsletter preference is saved.');});
 const {mountNewsletterPreferences}=await import('./newsletter.js?v=academy-ux-1');await mountNewsletterPreferences(root.querySelector('#ap-kitchen-newsletter'),user.email,{showSavedState:true});
}
function gate(){
 cleanupView();root.setAttribute('aria-busy','false');root.dataset.layout='';chromeKey='';
 root.innerHTML=`<main class="ap-login">${brand}<section class="ap-hero"><div><p class="eyebrow">Something good starts here</p><h1>Welcome to TLB Academy</h1><p>A place to learn, bake, and share.</p><ul class="ap-gate-benefits"><li><strong>Your classes & recipes</strong><span>Ready when a class is assigned to your account.</span></li><li><strong>Student creations</strong><span>Explore the Academy gallery after signing in.</span></li><li><strong>What’s coming next</strong><span>Find upcoming workshops and Academy updates.</span></li></ul><div class="ap-actions">${link('Log In','/account.html?next=%2Facademy%2Fdashboard')}${link('Create an Account','/account.html?mode=signup&next=%2Facademy%2Fdashboard',true)}</div><p class="ap-gate-note">Use your existing TLB account. New accounts can browse the gallery and upcoming classes. Class recipes become available after enrollment.</p><a href="/account.html?mode=recover&next=%2Facademy%2Fdashboard">Forgot your password?</a></div></section><p class="ap-gate-note"><a href="/">Back to TLB Kitchen</a></p></main>`;
}
function routeError(error){
 if(error.code==='ACADEMY_STALE')return;
 shell(`${empty('Academy is unavailable right now.',academyErrorMessage(error))}<div class="ap-actions">${button('Try again','retry',true)}${link('My TLB account','/account.html',true)}</div>`);
 root.querySelector('[data-action=retry]').onclick=route;
}
async function route(){
 const [rawView,id,recipeId]=location.hash.slice(1).split('/'),view=rawView||'dashboard';
 if(!isAdmin&&view==='gallery'&&galleryController&&user){try{await galleryController.navigate(id);}catch(e){routeError(e);}return;}
 const current=++generation;cleanupView();showLoading();
 try{
  await ready;const {data}=await auth.getSession();if(current!==generation)return;
  const actor=data.session?.user;if(user?.id!==actor?.id)galleryMemory=null;user=actor;if(!user)return gate();
  const overviewViews=['dashboard','classes','announcements','upcoming','preferences'];
  dashboard=await api(!isAdmin&&overviewViews.includes(view)?'dashboard':'navigation');if(current!==generation)return;
  if(isAdmin){const {mountAcademyAdmin}=await import('./academy-portal-admin.js?v=academy-ux-1');if(current!==generation)return;return await mountAcademyAdmin({api,root,user,dashboard,shell,notice,heading,empty,field,area,select,check,options,link,button,esc,date,photo,hydrate,dialog,formSubmit,uploadPhotos,productImageAccept,showThread});}
  if(view==='class')return await showClass(id);if(view==='recipe')return await showRecipe(id,recipeId);if(['share','ask','contact'].includes(view))return await showCompose(id,view,recipeId);if(view==='gallery')return await showGallery(id);if(view==='messages')return await showThreads();if(view==='thread')return await showThread(id);if(view==='preferences')return await preferences();
  if(view==='classes')shell(`${heading('My classes','Your recipes, notes, and a little guidance along the way.')}${classCards(dashboard.classes)}`,'classes');
  else if(view==='upcoming')shell(`${heading('Coming up in the Academy')}${upcomingCards(dashboard.upcoming)}`,'upcoming');
  else if(view==='announcements'){shell(`${heading('Academy announcements')}${announcements(dashboard.announcements)}`,'announcements');bindAnnouncements();}
  else{
   if(!dashboard.announcements)dashboard=await api('dashboard');
   shell(`<header class="ap-welcome"><p class="ap-category">Welcome to your Academy</p><h1>Welcome, ${esc(dashboard.name.split(' ')[0])}.</h1><p>Ready for a little time in the kitchen?</p></header>${replyCards(dashboard.classes)}<section class="ap-section ap-dashboard-classes">${heading('My classes','Keep creating, at your own pace.',link('View all','#classes',true))}${classCards(dashboard.classes)}</section><section class="ap-section">${heading('Latest from the Academy')}${announcements(dashboard.announcements.slice(0,2))}</section><section class="ap-section">${heading('What our students are baking','A shared love of making something from scratch.',link('Explore gallery','#gallery',true))}${galleryCards(dashboard.gallery.slice(0,6))}</section><section class="ap-section">${heading('More good things to learn')}${upcomingCards(dashboard.upcoming.slice(0,2))}</section>`);bindGallery();bindAnnouncements();
  }
 }catch(e){if(current!==generation)return;routeError(e);}
}
window.addEventListener('hashchange',route);
await ready;
auth?.onAuthStateChange((event,session)=>{
 if(event==='SIGNED_OUT'||(user&&session?.user?.id!==user.id)){generation++;dashboard=null;user=null;galleryMemory=null;cleanupView();gate();}
 if(event==='SIGNED_IN'&&!user)setTimeout(route,0);
});
let checkingAccess=false;
async function checkCurrentAccess(){
 const [view,id]=location.hash.slice(1).split('/');
 if(checkingAccess||!user||document.visibilityState==='hidden'||!['class','recipe','share','ask','contact','thread','gallery'].includes(view)||!id)return;
 checkingAccess=true;
 try{
  const status=await api(view==='thread'?'thread_status':view==='gallery'?'gallery_post':'class',{id});
  if(view==='thread'&&activeThread?.id===id)activeThread.onStatus(status);
 }catch(error){if(error.code!=='ACADEMY_STALE'){cleanupView();await route();}}
 finally{checkingAccess=false;}
}
window.addEventListener('focus',checkCurrentAccess);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')checkCurrentAccess();});
setInterval(checkCurrentAccess,15000);
await route();
