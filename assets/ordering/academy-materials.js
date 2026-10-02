import {academyMaterialUpload,academyMaterialDownload,academyMaterialRemove} from './academy-materials-client.js?v=academy-resources-1';
import {academyErrorMessage} from './academy-errors.js?v=academy-audit-1';
export const materialExtensions=['pdf','doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp','csv','txt','zip','png','jpg','jpeg','webp','heic','svg'];
export const materialSize=bytes=>bytes<1024*1024?`${Math.max(1,Math.ceil(bytes/1024))} KB`:`${(bytes/1024/1024).toFixed(1)} MB`;
export const materialSection='<section class="ap-section ap-class-downloads" aria-label="Class materials"><div data-class-materials></div></section>';
export async function mountClassMaterials(host,{api,esc,dialog,formSubmit,registerCleanup},classId,{manage=false}={}){
 let disposed=false,rows=[],ticket=0;const urls=new Set();
 registerCleanup(()=>{disposed=true;ticket++;for(const url of urls)URL.revokeObjectURL(url);});
 host.innerHTML='<p role="status">Loading class materials…</p>';
 const active=()=>!disposed&&host.isConnected;
 const formMarkup=(item={},upload=false)=>`<form class="ap-form"><label>Title<input name="title" required maxlength="160" value="${esc(item.title||'')}"></label><label>Description (optional)<textarea name="description" maxlength="2000">${esc(item.description||'')}</textarea></label>${upload?`<label>Class file<input type="file" name="material" required accept="${materialExtensions.map(x=>'.'+x).join(',')}"></label><p class="ap-small ap-muted">PDF, Word, Excel, PowerPoint, OpenDocument, text, CSV, ZIP, or image files. Up to 25 MB each. Files keep their original format.</p><p class="ap-small" data-upload-state role="status"></p>`:''}<button class="ap-button" type="submit">${upload?'Upload material':'Save material'}</button></form>`;
 const render=()=>{
  host.innerHTML=`<div class="ap-section-head"><div><h2>Class materials</h2><p>Download templates, guides, and other files for this class.</p></div>${manage?'<button class="ap-button secondary" type="button" data-add-material>Upload material</button>':''}</div><div class="ap-material-list">${rows.map(m=>`<article class="ap-material" data-material="${m.id}"><div><h3>${esc(m.title)}</h3>${m.description?`<p class="ap-copy">${esc(m.description)}</p>`:''}<p class="ap-small ap-muted">${esc(m.file_name)} · ${materialSize(m.size_bytes)}</p></div><div class="ap-actions"><button class="ap-button secondary" type="button" data-download-material="${m.id}" aria-label="Download ${esc(m.title)}">Download</button>${manage?`<button class="ap-button secondary" type="button" data-edit-material="${m.id}" aria-label="Edit ${esc(m.title)}">Edit</button><button class="ap-button secondary" type="button" data-remove-material="${m.id}" aria-label="Remove ${esc(m.title)}">Remove</button>`:''}</div></article>`).join('')||`<p class="ap-muted">${manage?'No files uploaded yet. Add templates or handouts for enrolled students.':'Your instructor has not added downloadable files yet.'}</p>`}</div><p data-material-status role="status" hidden></p>`;
  const status=message=>{const n=host.querySelector('[data-material-status]');n.hidden=false;n.textContent=message;};
  host.querySelector('[data-add-material]')?.addEventListener('click',()=>{
   const d=dialog('Upload class material',formMarkup({},true)),f=d.querySelector('form');let reserved=null,file=null;
   f.elements.material.onchange=()=>{const selected=f.elements.material.files[0];if(selected&&!f.elements.title.value)f.elements.title.value=selected.name.replace(/\.[^.]+$/,'').slice(0,160);};
   formSubmit(f,async data=>{
    if(!reserved)file=f.elements.material.files[0];
    if(!file||!materialExtensions.includes(file.name.split('.').at(-1).toLowerCase()))throw new Error('Choose a supported document, ZIP, or image file.');
    if(!file.size||file.size>25*1024*1024)throw new Error('Choose a nonempty file up to 25 MB.');
    if(!reserved){
     const fileName=file.name.replace(/[\x00-\x1f\x7f/\\\u202a-\u202e\u2066-\u2069]/g,'_');
     if(fileName.length>180)throw new Error('Shorten the filename to 180 characters or fewer.');
     f.dataset.uploadId ||= crypto.randomUUID();
     const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');
     reserved=await api('reserve_material',{id:f.dataset.uploadId,class_id:classId,title:data.get('title'),description:data.get('description'),file_name:fileName,size_bytes:file.size,sha256});
     if(!active()||!d.isConnected)return;
     [...f.elements].filter(e=>e.tagName!=='BUTTON').forEach(e=>e.disabled=true);
    }
    f.querySelector('[data-upload-state]').textContent='Uploading file…';f.querySelector('[type=submit]').textContent='Retry upload';
    if(!reserved.uploaded)await academyMaterialUpload(reserved.path,file);
    if(!active()||!d.isConnected)return;
    await api('publish_material',{id:reserved.id});if(!active())return;d.close();await reload();status('Material uploaded. Students with class access can download it.');
   });
  });
  host.querySelectorAll('[data-download-material]').forEach(b=>b.onclick=async()=>{
   b.disabled=true;try{
    const m=await api('material',{id:b.dataset.downloadMaterial}),blob=await academyMaterialDownload(m.path);
    // Re-check access after a slow transfer, including a sign-out or revocation.
    await api('material',{id:m.id});if(!active())return;
    const url=URL.createObjectURL(new Blob([blob],{type:'application/octet-stream'}));urls.add(url);
    const a=document.createElement('a');a.href=url;a.download=m.file_name;document.body.append(a);a.click();a.remove();
    setTimeout(()=>{URL.revokeObjectURL(url);urls.delete(url);},60000);
   }catch(e){if(active())status(academyErrorMessage(e));}finally{b.disabled=false;}
  });
  host.querySelectorAll('[data-edit-material]').forEach(b=>b.onclick=()=>{
   const m=rows.find(m=>m.id===b.dataset.editMaterial),d=dialog('Edit class material',formMarkup(m));
   formSubmit(d.querySelector('form'),async data=>{await api('save_material',{id:m.id,title:data.get('title'),description:data.get('description')});if(!active())return;d.close();await reload();});
  });
  host.querySelectorAll('[data-remove-material]').forEach(b=>b.onclick=()=>{
   const m=rows.find(m=>m.id===b.dataset.removeMaterial),d=dialog('Remove class material?',`<p>Remove “${esc(m.title)}” from this class? Students will no longer be able to download it.</p><form class="ap-form"><button type="submit" class="ap-button">Remove material</button></form>`);
   formSubmit(d.querySelector('form'),async()=>{const removed=await api('remove_material',{id:m.id});await academyMaterialRemove(removed.path);if(!active())return;d.close();await reload();});
  });
 };
 async function reload(){const current=++ticket;const fresh=await api('materials',{class_id:classId});if(!active()||current!==ticket)return;rows=fresh;render();}
 try{await reload();}catch(error){if(active()){host.innerHTML=`<h2>Class materials</h2><p role="status">${esc(academyErrorMessage(error))}</p><button class="ap-button secondary" type="button">Try again</button>`;host.querySelector('button').onclick=()=>mountClassMaterials(host,{api,esc,dialog,formSubmit,registerCleanup},classId,{manage});}}
}
