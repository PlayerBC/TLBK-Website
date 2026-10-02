import {renderAcademyEmail} from './academy-email-render.js?v=academy-resources-1';
import {academyErrorMessage} from './academy-errors.js?v=academy-audit-1';
const builtins={
 marketing:[
  {id:'new-class',name:'New class announcement',subject:'Something new to bake at TLB Academy',body:'Hello, bakers!\n\nWe have a new class to share with you.\n\nClass: [class name]\nWhat you will make: [bakes and skills]\nWhen: [date and time]\nWhere: [venue]\n\n[Add enrollment details and a contact link.]\n\nWe would love to bake with you!\nTLB Academy'},
  {id:'workshop',name:'Workshop invitation',subject:'You are invited to our next baking workshop',body:'Hello, bakers!\n\nJoin us for [workshop name], a hands-on session at TLB Academy.\n\nDate and time: [schedule]\nFor: [experience level or age group]\nYou will learn: [skills]\nIncluded: [materials and take-home bakes]\n\n[Add the price and how to book.]\n\nSee you in the kitchen!\nTLB Academy'},
  {id:'baking-camp',name:'Baking camp',subject:'A little baking adventure awaits',body:'Our next baking camp is coming up!\n\nCamp: [camp name]\nDates: [dates and times]\nFor ages: [age range]\n\nOn the menu:\n• [Bake one]\n• [Bake two]\n• [Bake three]\n\n[Add what is included, the price, and how to reserve a place.]\n\nTLB Academy'},
  {id:'tips',name:'Baking tips and Academy news',subject:'A little baking inspiration from TLB Academy',body:'Hello, bakers!\n\nA tip for your next bake:\n[Share one practical tip and explain when to use it.]\n\nFrom the Academy:\n[Add a class highlight or a new workshop.]\n\nReady to try something new?\n[Add details on how to join us.]\n\nHappy baking!\nTLB Academy'}
 ],
 operational:[
  {id:'class-reminder',name:'Class reminder',subject:'A reminder about your upcoming Academy class',body:'Hello!\n\nWe are looking forward to baking with you.\n\nClass: [class name]\nDate and time: [schedule]\nVenue: [location]\nWhat to bring: [items]\n\n[Add arrival instructions or preparation notes.]\n\nSee you soon!\nTLB Academy'},
  {id:'class-materials',name:'Class materials available',subject:'Your class materials are ready',body:'Hello!\n\nYour materials for [class name] are now available in your Academy account.\n\nOpen your class and look for Class materials to download [templates or handouts].\n\n[Add any instructions on using or printing the files.]\n\nIf you need help, send your instructor a message from the class page.\n\nTLB Academy'},
  {id:'schedule-update',name:'Schedule update',subject:'An update to your Academy class schedule',body:'Hello!\n\nPlease note an update for [class name].\n\nPrevious schedule: [original date and time]\nNew schedule: [new date and time]\nVenue: [location]\n\n[Explain the change and what students need to do.]\n\nThank you for your understanding.\nTLB Academy'}
 ]
};
export function academyEmailPreview(payload,address=''){
 return renderAcademyEmail({title:payload.subject||'Your email subject',preview:payload.body||'Your message will appear here.',url:'https://thelittlebakerkitchen.com/academy/dashboard',marketing:payload.kind==='marketing',unsubscribe_token:'0'.repeat(64),address:address||'[Business address from TLB settings]'});
}
export function mountEmailPreview(host,payload,{esc,address=''}){
 const rendered=academyEmailPreview(payload,address);
 host.innerHTML=`<div class="ap-email-envelope"><p><strong>From:</strong> TLB Academy &lt;Academy@thelittlebakerkitchen.com&gt;</p><p><strong>Subject:</strong> ${esc(payload.subject||'Your email subject')}</p></div><div class="ap-actions ap-preview-sizes" role="group" aria-label="Preview size"><button type="button" class="ap-button secondary" data-preview-width="desktop" aria-pressed="true">Desktop</button><button type="button" class="ap-button secondary" data-preview-width="mobile" aria-pressed="false">Mobile</button></div><div class="ap-email-preview-stage"><iframe sandbox="" referrerpolicy="no-referrer" title="Academy email preview"></iframe></div><details class="ap-email-plain"><summary>Plain text version</summary><pre></pre></details><p class="ap-small ap-muted">Preview only. Links are disabled.${payload.kind==='marketing'&&!address?' Add your business address in TLB settings before sending.':''}</p>`;
 host.querySelector('iframe').srcdoc=rendered.html.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">').replace(/href="[^"]*"/g,'href="#preview"');
 host.querySelector('pre').textContent=rendered.text.replace(/token=0{64}/g,'token=[personal unsubscribe link]');
 host.querySelectorAll('[data-preview-width]').forEach(b=>b.onclick=()=>{host.dataset.previewWidth=b.dataset.previewWidth;host.querySelectorAll('[data-preview-width]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));});
}
export async function mountEmailTemplates(form,{api,esc,dialog,formSubmit,registerCleanup},kind){
 let disposed=false,saved=[],address='';registerCleanup(()=>{disposed=true;});
 const host=document.createElement('section');host.className='ap-email-templates';host.setAttribute('aria-label','Email templates');
 form.prepend(host);host.innerHTML='<p role="status">Loading email templates…</p>';
 const current=()=>({kind,subject:form.elements.subject.value,body:form.elements.body.value});
 const preview=payload=>{const d=dialog(kind==='marketing'?'Newsletter preview':'Class email preview','<div data-email-preview></div>');d.classList.add('ap-email-preview-dialog');mountEmailPreview(d.querySelector('[data-email-preview]'),payload,{esc,address});};
 const render=()=>{
  host.innerHTML=`<label>Start from a template<select name="email_template"><option value="">Choose a template</option><optgroup label="Academy templates">${builtins[kind].map(t=>`<option value="builtin:${t.id}">${esc(t.name)}</option>`).join('')}</optgroup>${saved.length?`<optgroup label="Your saved templates">${saved.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</optgroup>`:''}</select></label><div class="ap-actions"><button class="ap-button secondary" type="button" data-use-template>Use template</button><button class="ap-button secondary" type="button" data-save-template>Save as template</button><button class="ap-button secondary" type="button" data-delete-template hidden>Delete saved template</button></div><p class="ap-small ap-muted">Choose a starting point, then replace the details in brackets before sending.</p><p data-template-status role="status" hidden></p>`;
  const picker=host.querySelector('select'),apply=host.querySelector('[data-use-template]'),remove=host.querySelector('[data-delete-template]');
  const selected=()=>picker.value.startsWith('builtin:')?builtins[kind].find(t=>'builtin:'+t.id===picker.value):saved.find(t=>t.id===picker.value);
  const sync=()=>{apply.disabled=!selected();remove.hidden=!saved.some(t=>t.id===picker.value);};picker.onchange=sync;sync();
  apply.onclick=()=>{
   const t=selected();if(!t)return;const use=()=>{form.elements.subject.value=t.subject;form.elements.body.value=t.body;form.elements.subject.dispatchEvent(new Event('input',{bubbles:true}));form.elements.body.focus();};
   if(form.elements.subject.value.trim()||form.elements.body.value.trim()){
    const d=dialog('Replace the current draft?',`<p>This will replace the subject and message with “${esc(t.name)}”.</p><button type="button" class="ap-button" data-replace-draft>Use this template</button>`);d.querySelector('[data-replace-draft]').onclick=()=>{d.close();use();};
   }else use();
  };
  host.querySelector('[data-save-template]').onclick=()=>{
   const payload=current();if(!payload.subject.trim()||!payload.body.trim()){const n=host.querySelector('[data-template-status]');n.hidden=false;n.textContent='Add a subject and message before saving a template.';return;}
   const d=dialog('Save email template','<form class="ap-form"><label>Template name<input name="name" required maxlength="80"></label><button class="ap-button" type="submit">Save template</button></form>');
   const requestKey=crypto.randomUUID();formSubmit(d.querySelector('form'),async data=>{const t=await api('save_email_template',{...payload,request_key:requestKey,name:data.get('name')});if(disposed)return;saved.push(t);d.close();render();host.querySelector('select').value=t.id;host.querySelector('select').dispatchEvent(new Event('change'));});
  };
  remove.onclick=()=>{const t=selected();if(!t)return;const d=dialog('Delete saved template?',`<p>Delete “${esc(t.name)}”? Your current draft will stay as it is.</p><form class="ap-form"><button type="submit" class="ap-button">Delete template</button></form>`);formSubmit(d.querySelector('form'),async()=>{await api('delete_email_template',{id:t.id});if(disposed)return;saved=saved.filter(x=>x.id!==t.id);d.close();render();});};
 };
 const previewButton=document.createElement('button');previewButton.type='button';previewButton.className='ap-button secondary';previewButton.textContent='Preview email';previewButton.dataset.previewEmail='';form.querySelector('button[type=submit]').before(previewButton);previewButton.onclick=()=>preview(current());
 async function load(){try{const r=await api('email_templates',{kind});if(disposed)return;saved=r.templates;address=r.address||'';render();}catch(e){if(disposed)return;host.innerHTML=`<p role="status">${esc(academyErrorMessage(e))}</p><button class="ap-button secondary" type="button">Retry templates</button>`;host.querySelector('button').onclick=load;}}
 await load();return {preview:(target,payload)=>mountEmailPreview(target,payload,{esc,address})};
}
