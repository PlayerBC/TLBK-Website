import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {auditHarness} from './academy-audit-harness.mjs';
const s=await auditHarness(),{h,cookie,cupcake,origin}=s,results=[],channel=process.env.PLAYWRIGHT_CHANNEL||'chrome',out=`work/academy-live-resources/${channel}`;
await mkdir(out,{recursive:true});await s.db.exec('grant insert,delete,update on storage.objects to authenticated;');
const api=(actor,action,p={})=>s.serial(()=>s.api(actor,action,p));
const files=new Map(),pdf=Buffer.from('%PDF-1.4\nSynthetic class template\n%%EOF'),zip=Buffer.from('PK\x03\x04Synthetic ZIP template');
const open=async(actor,hash,{admin=false,width=1440}={})=>{
 const p=await s.pageFor(actor,width);p.page.setDefaultTimeout(8000);let failure=null;
 // WebKit's request inspector omits File bodies. Capture the actual browser
 // fetch bytes for that engine so the storage fixture still validates them.
 if(channel==='webkit')await p.page.addInitScript(()=>{const fetch=window.fetch;window.fetch=async(input,init)=>{if(String(input).includes('/storage/v1/object/academy-class-materials/')&&init?.body instanceof Blob){window.materialFixtureBodies||={};window.materialFixtureBodies[String(input)]=[...new Uint8Array(await init.body.arrayBuffer())];}return fetch(input,init);};});
 await p.context.route('**/storage/v1/**',route=>s.serial(async()=>{
  const req=route.request(),url=new URL(req.url()),path=decodeURIComponent(url.pathname.split('/academy-class-materials/')[1]||''),method=req.method();
  assert.match(req.headers().authorization,/^Bearer fixture-user$/);
  try{
   if(method==='POST'){
    const bytes=req.postDataBuffer()||Buffer.from(await p.page.evaluate(url=>window.materialFixtureBodies[url],req.url()));assert.equal(req.headers()['content-type'],'application/octet-stream');assert.equal(req.headers()['x-upsert'],'false');
    if(files.has(path))return route.fulfill({status:409,json:{statusCode:409}});
    await h.as(actor,()=>s.db.query("insert into storage.objects(bucket_id,name,metadata) values('academy-class-materials',$1,$2::jsonb)",[path,JSON.stringify({size:bytes.length,mimetype:'application/octet-stream'})]));files.set(path,bytes);
    if(failure==='after'){failure=null;return route.fulfill({status:503,json:{error:'Fixture lost response'}});}return route.fulfill({json:{Key:path}});
   }
   if(method==='GET'){
    const visible=await h.as(actor,()=>s.db.query("select name from storage.objects where bucket_id='academy-class-materials' and name=$1",[path]));
    return visible.rows.length&&files.has(path)?route.fulfill({body:files.get(path),contentType:'application/octet-stream'}):route.fulfill({status:403,json:{error:'Denied'}});
   }
   if(method==='DELETE'){
    const target=req.postDataJSON().prefixes[0];await h.as(actor,()=>s.db.query("delete from storage.objects where bucket_id='academy-class-materials' and name=$1",[target]));files.delete(target);return route.fulfill({json:[]});
   }
   return route.fulfill({status:405});
  }catch(error){if(error.code!=='42501')console.error('Fixture storage error:',method,error.message,'bytes',req.postDataBuffer()?.length);return route.fulfill({status:403,json:{error:error.message}});}
 }));
 p.failMaterial=()=>{failure='after';};await p.page.goto(`${origin}/academy/${admin?'admin':'dashboard'}${hash}`);await p.page.waitForFunction(()=>document.querySelector('#academy-app')?.getAttribute('aria-busy')==='false');return p;
};
const thread=async(subject='Live baking question')=>{const q=await api(h.ids.customer,'start_thread',{class_id:cookie.id,subject,body:'How should I shape this bake?',type:'question'});await api(h.ids.customer,'send_message',{id:q.id});return q;};
const reply=async(q,body)=>{const r=await api(h.ids.staff,'draft_reply',{id:q.thread_id,body});await api(h.ids.staff,'send_message',{id:r.id});return r;};
const check=async(name,fn)=>{if(process.env.ACADEMY_CHECK_FILTER&&!new RegExp(process.env.ACADEMY_CHECK_FILTER).test(name))return;try{await fn();results.push({name,status:'PASS'});console.log('PASS',name);}catch(error){results.push({name,status:'FAIL',error:error.stack});console.log('FAIL',name,error.message);for(const c of s.browser.contexts())for(const p of c.pages())await p.screenshot({path:`${out}/failure-${results.length}-${s.browser.contexts().indexOf(c)}.png`,fullPage:true}).catch(()=>{});}finally{for(const c of s.browser.contexts())await c.close();}};
let materialId;
try{
 await check('A reply sent from another browser appears automatically while text, photo and focus stay intact',async()=>{
  const q=await thread(),student=await open(h.ids.customer,'#thread/'+q.thread_id),teacher=await open(h.ids.staff,'#thread/'+q.thread_id,{admin:true});
  const png=await student.page.evaluate(()=>{const c=document.createElement('canvas');c.width=20;c.height=20;return c.toDataURL('image/png').split(',')[1];});
  await student.page.getByLabel('Your reply',{exact:true}).fill('I am still writing this draft.');await student.page.locator('[name=photos]').setInputFiles({name:'my-bake.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await student.page.locator('.ap-photo-preview img').waitFor();await student.page.getByLabel('Your reply',{exact:true}).focus();
  const before=await student.page.getByLabel('Your reply',{exact:true}).boundingBox();
  await teacher.page.getByLabel('Your reply',{exact:true}).fill('Chill it first, then shape gently.');await teacher.page.getByRole('button',{name:'Send reply',exact:true}).click();
  await student.page.getByText('Chill it first, then shape gently.',{exact:true}).waitFor();
  assert.equal(await student.page.getByLabel('Your reply',{exact:true}).inputValue(),'I am still writing this draft.');assert.equal(await student.page.locator('.ap-photo-preview img').count(),1);assert.equal(await student.page.evaluate(()=>document.activeElement.name),'body');
  const after=await student.page.getByLabel('Your reply',{exact:true}).boundingBox();assert.ok(Math.abs(before.y-after.y)<4,`Composer moved ${after.y-before.y}px`);
  await student.page.screenshot({path:out+'/live-replies.png',fullPage:true});
  await student.page.getByRole('button',{name:'Show new reply',exact:true}).click();await student.page.waitForFunction(()=>document.activeElement.matches('.ap-message'));assert.equal((await api(h.ids.customer,'threads')).find(t=>t.id===q.thread_id).unread,0);
 });
 await check('Instructor view receives a student reply automatically and reflects resolved status',async()=>{
  const q=await thread('Instructor live view'),teacher=await open(h.ids.staff,'#thread/'+q.thread_id,{admin:true}),student=await open(h.ids.customer,'#thread/'+q.thread_id);
  await student.page.getByLabel('Your reply',{exact:true}).fill('Here is a second student message.');await student.page.getByRole('button',{name:'Send reply',exact:true}).click();await teacher.page.getByText('Here is a second student message.',{exact:true}).waitFor();
  await teacher.page.getByRole('button',{name:'Mark resolved',exact:true}).click();await student.page.waitForFunction(()=>document.querySelector('[data-thread-state]').textContent.includes('Resolved'));
 });
 await check('Reading older history stays in place; Jump to latest marks the loaded reply read',async()=>{
  const q=await thread('Older history');await reply(q,Array.from({length:35},(_,i)=>`Earlier baking note ${i+1}.`).join('\n'));const p=await open(h.ids.customer,'#thread/'+q.thread_id);
  await p.page.getByLabel('Your reply',{exact:true}).fill('An unfinished reply.');await p.page.locator('[data-message-id]').first().click();await p.page.evaluate(()=>scrollTo(0,0));assert.ok((await p.page.getByLabel('Your reply',{exact:true}).boundingBox()).y>1000);
  await reply(q,'A reply below the older history.');await p.page.getByText('A reply below the older history.',{exact:true}).waitFor();assert.equal(await p.page.evaluate(()=>scrollY),0);assert.equal((await api(h.ids.customer,'threads')).find(t=>t.id===q.thread_id).unread,1);
  await p.page.getByRole('button',{name:'Jump to latest',exact:true}).click();await p.page.waitForFunction(()=>document.activeElement.matches('.ap-message'));await p.page.waitForTimeout(100);assert.equal((await api(h.ids.customer,'threads')).find(t=>t.id===q.thread_id).unread,0);assert.equal(await p.page.getByLabel('Your reply',{exact:true}).inputValue(),'An unfinished reply.');
 });
 await check('Slow polling stays single-flight and concurrent send does not duplicate or lose messages',async()=>{
  const q=await thread('Slow conversation'),p=await open(h.ids.customer,'#thread/'+q.thread_id);await reply(q,'Incoming during a slow connection.');
  const delayed=p.delayNext('thread');await p.page.evaluate(()=>window.dispatchEvent(new Event('focus')));await delayed.pending;const count=p.calls.filter(c=>c.action==='thread_status').length;
  await p.page.waitForTimeout(3300);assert.equal(p.calls.filter(c=>c.action==='thread_status').length,count);
  await p.page.getByLabel('Your reply',{exact:true}).fill('My simultaneous reply.');await p.page.getByRole('button',{name:'Send reply',exact:true}).click();delayed.release();await p.page.getByText('My simultaneous reply.',{exact:true}).waitFor();await p.page.getByText('Incoming during a slow connection.',{exact:true}).waitFor();
  const ids=await p.page.locator('[data-message-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.messageId));assert.equal(ids.length,new Set(ids).size);assert.equal(await p.page.getByLabel('Your reply',{exact:true}).inputValue(),'');
 });
 await check('A transient network failure keeps the draft and resumes automatically on reconnect',async()=>{
  const q=await thread('Reconnect'),p=await open(h.ids.customer,'#thread/'+q.thread_id);await p.page.getByLabel('Your reply',{exact:true}).fill('Keep my draft.');p.failNext('thread_status','before','Failed to fetch');await p.page.evaluate(()=>window.dispatchEvent(new Event('focus')));await p.page.getByText('Reconnecting… Your draft is safe.',{exact:true}).waitFor();
  await reply(q,'The connection is back.');await p.page.evaluate(()=>window.dispatchEvent(new Event('online')));await p.page.getByText('The connection is back.',{exact:true}).waitFor();assert.equal(await p.page.getByLabel('Your reply',{exact:true}).inputValue(),'Keep my draft.');
 });
 await check('Hidden tabs stop checks, returning resumes immediately, and navigation discards stale results',async()=>{
  const q=await thread('Visibility'),p=await open(h.ids.customer,'#thread/'+q.thread_id);await p.page.evaluate(()=>{window.testHidden=true;Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.testHidden?'hidden':'visible'});document.dispatchEvent(new Event('visibilitychange'));});const count=p.calls.filter(c=>c.action==='thread_status').length;await reply(q,'Reply while the tab is hidden.');await p.page.waitForTimeout(3300);assert.equal(p.calls.filter(c=>c.action==='thread_status').length,count);
  await p.page.evaluate(()=>{window.testHidden=false;document.dispatchEvent(new Event('visibilitychange'));});await p.page.getByText('Reply while the tab is hidden.',{exact:true}).waitFor();
  const delayed=p.delayNext('thread_status');await p.page.evaluate(()=>window.dispatchEvent(new Event('focus')));await delayed.pending;await p.page.evaluate(()=>location.hash='#classes');await p.page.getByRole('heading',{name:'My classes',exact:true}).waitFor();delayed.release();await p.page.waitForTimeout(3300);assert.equal(await p.page.locator('#ap-thread-form').count(),0);
 });
 await check('Revoking enrollment clears an open conversation on the next check',async()=>{
  const q=await thread('Revoke live'),p=await open(h.ids.customer,'#thread/'+q.thread_id);const enrollment=await s.serial(async()=>(await s.db.query("select id from tlb.academy_enrollments where class_id=$1 and user_id=$2 and status='active'",[cookie.id,h.ids.customer])).rows[0]);await api(h.ids.owner,'revoke',{id:enrollment.id});await p.page.getByText('Academy is unavailable right now.',{exact:true}).waitFor();assert.equal(await p.page.locator('[data-message-id]').count(),0);await api(h.ids.owner,'assign',{class_id:cookie.id,user_ids:[h.ids.customer]});
 });
 await check('Owner uploads a titled PDF and students download the original bytes from their class',async()=>{
  const p=await open(h.ids.owner,'#classes/'+cookie.id,{admin:true});await p.page.getByRole('button',{name:'Upload material',exact:true}).click();const d=p.page.getByRole('dialog');await d.getByLabel('Class file').setInputFiles({name:'cake-template.pdf',mimeType:'application/pdf',buffer:pdf});await d.getByLabel('Title',{exact:true}).fill('Cake shaping template');await d.getByLabel('Description (optional)').fill('Print at 100% on A4 paper.');await d.getByRole('button',{name:'Upload material',exact:true}).click();await p.page.getByRole('heading',{name:'Cake shaping template',exact:true}).waitFor();materialId=(await api(h.ids.owner,'materials',{class_id:cookie.id}))[0].id;
  await p.page.locator('.ap-class-downloads').screenshot({path:out+'/materials-admin.png'});
  const student=await open(h.ids.customer,'#class/'+cookie.id,{width:390});await student.page.getByRole('heading',{name:'Cake shaping template',exact:true}).waitFor();assert.equal(await student.page.locator('[data-add-material]').count(),0);const download=student.page.waitForEvent('download');await student.page.getByRole('button',{name:'Download Cake shaping template'}).click();const file=await download;assert.equal(file.suggestedFilename(),'cake-template.pdf');assert.deepEqual(await readFile(await file.path()),pdf);assert.equal(await student.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await student.page.screenshot({path:out+'/materials-student.png',fullPage:true});
 });
 await check('Lost upload response retries the same immutable file and publishes only one material',async()=>{
  const p=await open(h.ids.owner,'#classes/'+cookie.id,{admin:true});await p.page.getByRole('button',{name:'Upload material',exact:true}).click();const d=p.page.getByRole('dialog');await d.getByLabel('Class file').setInputFiles({name:'cookie-cutters.zip',mimeType:'application/zip',buffer:zip});await d.getByLabel('Title',{exact:true}).fill('Cookie cutter templates');p.failMaterial();await d.getByRole('button',{name:'Upload material',exact:true}).click();await d.getByRole('alert').waitFor();assert.equal(await d.getByLabel('Class file').isDisabled(),true);await d.getByRole('button',{name:'Retry upload',exact:true}).click();await p.page.getByRole('heading',{name:'Cookie cutter templates',exact:true}).waitFor();assert.equal((await api(h.ids.owner,'materials',{class_id:cookie.id})).filter(m=>m.title==='Cookie cutter templates').length,1);
 });
 await check('Unsupported files fail before reservation and a corrected selection can be uploaded',async()=>{
  const p=await open(h.ids.owner,'#classes/'+cookie.id,{admin:true});await p.page.getByRole('button',{name:'Upload material',exact:true}).click();const d=p.page.getByRole('dialog');await d.getByLabel('Title',{exact:true}).fill('Corrected template');await d.getByLabel('Class file').setInputFiles({name:'bad.exe',mimeType:'application/octet-stream',buffer:pdf});await d.getByRole('button',{name:'Upload material',exact:true}).click();await d.getByRole('alert').waitFor();assert.equal(p.calls.filter(c=>c.action==='reserve_material').length,0);await d.getByLabel('Class file').setInputFiles({name:'correct.pdf',mimeType:'application/pdf',buffer:pdf});await d.getByRole('button',{name:'Upload material',exact:true}).click();await p.page.getByRole('heading',{name:'Corrected template',exact:true}).waitFor();
 });
 await check('Editing and removing materials update the list, and removed links cannot download',async()=>{
  const p=await open(h.ids.owner,'#classes/'+cookie.id,{admin:true});await p.page.getByRole('button',{name:'Edit Cake shaping template',exact:true}).click();let d=p.page.getByRole('dialog');await d.getByLabel('Title',{exact:true}).fill('Cake template — final');await d.getByRole('button',{name:'Save material',exact:true}).click();await p.page.getByRole('heading',{name:'Cake template — final',exact:true}).waitFor();const student=await open(h.ids.customer,'#class/'+cookie.id);await student.page.getByRole('button',{name:'Download Cake template — final'}).waitFor();await p.page.getByRole('button',{name:'Remove Cake template — final',exact:true}).click();d=p.page.getByRole('dialog');await d.getByRole('button',{name:'Remove material',exact:true}).click();await p.page.getByRole('heading',{name:'Cake template — final',exact:true}).waitFor({state:'detached'});await student.page.getByRole('button',{name:'Download Cake template — final'}).click();await student.page.locator('[data-material-status]:not([hidden])').waitFor();await assert.rejects(api(h.ids.customer,'material',{id:materialId}));
 });
 await check('Newsletter starter templates populate the draft and desktop/mobile preview uses branded HTML',async()=>{
  const p=await open(h.ids.owner,'#newsletter',{admin:true});await p.page.getByLabel('Start from a template').selectOption('builtin:baking-camp');await p.page.getByRole('button',{name:'Use template',exact:true}).click();assert.ok((await p.page.getByLabel('Message',{exact:true}).inputValue()).includes('[camp name]'));
  await p.page.getByLabel('Subject',{exact:true}).fill('Summer Baking Camp');await p.page.getByLabel('Message',{exact:true}).fill('Join us for four days of baking.\n\nCreate cookies, cake pops, and cupcakes with TLB Academy.');await p.page.screenshot({path:out+'/newsletter-templates.png',fullPage:true});await p.page.getByRole('button',{name:'Preview email',exact:true}).click();const d=p.page.getByRole('dialog'),frame=p.page.frameLocator('iframe[title="Academy email preview"]');await frame.getByRole('heading',{name:'Summer Baking Camp',exact:true}).waitFor();await frame.getByText('Unsubscribe from Academy marketing',{exact:true}).waitFor();assert.equal(await d.locator('iframe').getAttribute('sandbox'),'');await d.screenshot({path:out+'/newsletter-desktop-preview.png'});await d.getByRole('button',{name:'Mobile',exact:true}).click();assert.ok((await d.locator('iframe').boundingBox()).width<=375);await d.screenshot({path:out+'/newsletter-mobile-preview.png'});assert.equal(p.calls.filter(c=>c.action==='broadcast_send').length,0);
 });
 await check('Saved templates survive a reload and selecting another template does not silently replace a draft',async()=>{
  const p=await open(h.ids.owner,'#newsletter',{admin:true});await p.page.getByLabel('Start from a template').waitFor();await p.page.getByLabel('Subject',{exact:true}).fill('Reusable baking update');await p.page.getByLabel('Message',{exact:true}).fill('This is my reusable Academy message.');await p.page.getByRole('button',{name:'Save as template',exact:true}).click();let d=p.page.getByRole('dialog');await d.getByLabel('Template name').fill('My baking update');await d.getByRole('button',{name:'Save template',exact:true}).click();await d.waitFor({state:'detached'});await p.page.reload();await p.page.getByRole('option',{name:'My baking update',exact:true}).waitFor({state:'attached'});await p.page.getByLabel('Start from a template').selectOption({label:'My baking update'});await p.page.getByRole('button',{name:'Use template',exact:true}).click();assert.equal(await p.page.getByLabel('Subject',{exact:true}).inputValue(),'Reusable baking update');await p.page.getByLabel('Start from a template').selectOption('builtin:workshop');await p.page.getByRole('button',{name:'Use template',exact:true}).click();d=p.page.getByRole('dialog');await d.getByRole('button',{name:'Close',exact:true}).click();assert.equal(await p.page.getByLabel('Subject',{exact:true}).inputValue(),'Reusable baking update');assert.equal(p.calls.filter(c=>c.action==='broadcast_send').length,0);
 });
 await check('Email preview escapes hostile draft text and review shows the same preview without queueing',async()=>{
  const p=await open(h.ids.owner,'#newsletter',{admin:true,width:390});await p.page.getByLabel('Start from a template').waitFor();await p.page.getByLabel('Subject',{exact:true}).fill('<img src=x onerror=alert(1)>');await p.page.getByLabel('Message',{exact:true}).fill('<script>parent.document.body.innerHTML="bad"</script>');await p.page.getByRole('button',{name:'Review recipients',exact:true}).click();const d=p.page.getByRole('dialog');await d.locator('iframe').waitFor();const src=await d.locator('iframe').getAttribute('srcdoc');assert.ok(!src.includes('<script>'));assert.ok(src.includes('&lt;script&gt;'));assert.equal(await d.getByRole('button',{name:'Queue newsletter',exact:true}).isDisabled(),true);assert.equal(await p.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(p.calls.filter(c=>c.action==='broadcast_send').length,0);
 });
 await check('Class email uses operational templates and its preview has the correct notification footer',async()=>{
  const p=await open(h.ids.owner,'#email',{admin:true});await p.page.getByLabel('Start from a template').selectOption('builtin:class-materials');await p.page.getByRole('button',{name:'Use template',exact:true}).click();await p.page.getByRole('button',{name:'Preview email',exact:true}).click();const frame=p.page.frameLocator('iframe[title="Academy email preview"]');await frame.getByText('This is an Academy account or class notification.',{exact:true}).waitFor();assert.equal(await frame.getByText('Unsubscribe from Academy marketing',{exact:true}).count(),0);assert.equal(p.calls.filter(c=>c.action==='broadcast_send').length,0);
 });
 assert.deepEqual(s.errors,[]);console.log(`${results.filter(r=>r.status==='PASS').length}/${results.length} browser checks passed (${channel})`);
}finally{await writeFile(out+'/results.json',JSON.stringify({channel,results,errors:s.errors},null,2));await s.close();}
if(results.some(r=>r.status!=='PASS'))process.exitCode=1;
