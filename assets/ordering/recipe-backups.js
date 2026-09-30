import {recipeBackupApi,recipeBackupConnection,recipeBackupDownload} from './client.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=v=>v?new Date(v).toLocaleString('en-PH',{timeZone:'Asia/Manila'}):'Not yet';
const size=v=>new Intl.NumberFormat('en-PH',{maximumFractionDigits:1}).format(Number(v||0)/1024/1024)+' MB';
const explanations={access:'Google Drive access needs attention.',quota:'Google Drive has reached a storage or request limit.',network:'The backup was interrupted. It will retry automatically.',checksum:'The archive did not pass verification. It was not marked successful.',file_missing:'An uploaded file could not be read. The backup was not marked complete.',configuration:'The backup connection needs setup.',too_large:'This archive exceeds a supported file or ZIP limit.',interrupted:'The previous backup was interrupted. A retry is required.'};
export async function mountRecipeBackups(root){
 let timer,busy=false;
 async function refresh(){
  clearTimeout(timer);if(!root.isConnected)return;
  const s=await recipeBackupApi('status');if(!root.isConnected)return;
  const completed=s.slots.filter(x=>x.valid).sort((a,b)=>String(b.completed_at).localeCompare(String(a.completed_at))),last=completed[0];
  root.innerHTML=`<section class="recipe-card"><div class="recipe-section-head"><h2>Recipe & costing backups</h2><span class="recipe-badge">${s.busy?'Backing up':s.last_error?'Needs attention':s.enabled?'Automatic backup on':'Not connected'}</span></div><p>Daily copies include recipes, versions, ingredients, suppliers, packaging, prices, costing snapshots, testing logs and uploaded files.</p>
   ${s.last_error?`<div class="recipe-error" role="alert">${esc(explanations[s.last_error]||'The last backup failed.')} ${s.consecutive_failures>=3?`${s.consecutive_failures} consecutive attempts have failed.`:''} Previously verified archives remain available below.</div>`:''}
   <div class="recipe-fields"><div><strong>Last successful backup</strong><p>${date(s.last_success_at)}</p></div><div><strong>Last attempt</strong><p>${date(s.last_attempt_at)}</p></div><div><strong>Next scheduled check</strong><p>${s.enabled?date(s.next_scheduled_at):'Automatic backup is off'}</p></div></div><p class="recipe-muted">Daily at 2:00 AM Manila time. Retains 30 daily and 12 monthly copies, plus two manual copies. Scheduled checks run without an open browser.</p>
   <div class="recipe-actions"><button type="button" class="primary" data-backup="now" ${!s.enabled||s.busy?'disabled':''}>Back up now</button><button type="button" data-backup="refresh">Refresh status</button><a class="recipe-button" href="https://drive.google.com/drive/folders/${esc(s.folder_id)}" target="_blank" rel="noopener noreferrer">Open Drive folder</a></div>${s.busy?`<p role="status" class="recipe-muted">Backup in progress. ${s.jobs[0]?.completed_entries||0} archive entries completed. You can leave this page.</p>`:''}</section>
   <section class="recipe-card"><h2>Download an independent copy</h2><p>Download a current ZIP with recovery data and the actual photos and attachments. Keep it somewhere separate from this website.</p><div class="recipe-actions"><button type="button" data-backup="download" ${s.busy?'disabled':''}>Download current archive</button>${last?`<a class="recipe-button" href="https://drive.google.com/file/d/${esc(last.drive_file_id)}/view" target="_blank" rel="noopener noreferrer">Latest verified Drive copy</a>`:''}<button type="button" data-backup="verify">Check a downloaded archive</button></div><p class="recipe-muted">Uploaded source files total ${size(s.uploaded_file_bytes)}. Every retained archive includes its own copies of those files.</p><p data-backup-message role="status"></p></section>
   <section class="recipe-card"><h2>Available recovery points</h2><div class="recipe-table-wrap"><table class="recipe-table"><thead><tr><th>Saved</th><th>Copy</th><th>Records / files</th><th>Size</th><th>Archive</th></tr></thead><tbody>${completed.map(a=>`<tr><td>${date(a.completed_at)}</td><td>${esc(a.kind)}</td><td>${a.record_count} / ${a.file_count}</td><td>${size(a.size_bytes)}</td><td><a href="https://drive.google.com/file/d/${esc(a.drive_file_id)}/view" target="_blank" rel="noopener noreferrer">Open</a></td></tr>`).join('')||'<tr><td colspan="5">No verified Drive archives yet.</td></tr>'}</tbody></table></div></section>`;
  if(s.busy||s.manual_requested)timer=setTimeout(()=>refresh().catch(showError),5000);
 }
 function message(text,error=false){const p=root.querySelector('[data-backup-message]');if(p){p.textContent=text;p.className=error?'recipe-error':'recipe-muted';}}
 function showError(error){message(error.message||'The backup could not be completed.',true);}
 root.addEventListener('click',async event=>{
  const button=event.target.closest('[data-backup]');if(!button||busy)return;button.disabled=true;busy=true;
  try{
   if(button.dataset.backup==='refresh')await refresh();
   if(button.dataset.backup==='now'){await recipeBackupConnection('sync');await refresh();message('Backup started. Success will appear after Google Drive verifies the archive.');}
   if(button.dataset.backup==='download'){message('Preparing the complete archive. Keep this page open until the download starts.');const blob=await recipeBackupDownload();const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`TLBK-recipes-costing-${new Date().toISOString().slice(0,10)}.zip`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);message('Archive downloaded. Use “Check a downloaded archive” to verify its contents.');}
   if(button.dataset.backup==='verify'){
    const input=document.createElement('input');input.type='file';input.accept='.zip';input.addEventListener('change',async()=>{try{if(!input.files[0])return;message('Checking archive checksums and record relationships…');const {readRecipeArchive}=await import('./recipe-recovery.js');const result=await readRecipeArchive(input.files[0]);message(`Archive checks passed: ${result.manifest.record_count} records and ${result.files.length} files. This check does not modify the live database.`);}catch(error){showError(error);}});input.click();
   }
  }catch(error){showError(error);}finally{busy=false;if(button.isConnected)button.disabled=false;}
 });
 await refresh();
}
