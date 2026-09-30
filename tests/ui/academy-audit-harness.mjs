import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {join,resolve,extname,sep} from 'node:path';
import {setup} from '../academy-portal.mjs';
import {validateWebP} from '../../supabase/functions/academy-media/handler.ts';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE_ROOT?join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'):'playwright');
export async function auditHarness(channel=process.env.PLAYWRIGHT_CHANNEL||'chrome'){
 const state=await setup(),{db,h,api,service}=state;
 const root=resolve(import.meta.dirname,'../..'),origin='https://academy.test',out=join(root,'work/academy-audit/browser-'+channel);
 await mkdir(out,{recursive:true});
 const browser=await chromium.launch({headless:true,channel});let queue=Promise.resolve();const files=new Map(),errors=[];
 const serial=fn=>{const task=queue.then(fn,fn);queue=task.catch(()=>{});return task;};
 const names=[...(await readFile(join(root,'assets/ordering/client.js'),'utf8')).matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+(\w+)/g)].map(m=>m[1]);
 async function pageFor(initialUser,width=1440){
  let actor=initialUser,delay=null,failure=null,uploadFailure=0,uploads=0;
  const calls=[];const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
  await context.exposeFunction('auditActor',value=>{actor=value;});
  await context.exposeFunction('auditRpc',async(action,p)=>{
   calls.push({action,p});const fail=failure?.action===action?failure:null;if(fail)failure=null;
   if(fail?.when==='before')throw Error(fail.message||'Connection interrupted. Please retry.');
   const result=await serial(()=>api(actor,action,p));
   if(fail?.when==='after')throw Error(fail.message||'Connection interrupted. Please retry.');
   if(delay?.action===action){const pending=delay;delay=null;pending.started();await pending.wait;}
   return result;
  });
  await context.exposeFunction('auditUpload',async({id,bytes})=>serial(async()=>{
   uploads++;if(uploadFailure&&uploads===uploadFailure)throw Error('Simulated connection loss');
   const data=Uint8Array.from(bytes),dims=validateWebP(data);const m=await h.as(actor,async()=>(await db.query('select public.academy_portal_upload_check($1) r',[id])).rows[0].r);
   if(dims.width!==m.width||data.length!==m.size_bytes)throw Error('Invalid dimensions');
   if(!files.has(m.path))await db.query("insert into storage.objects(bucket_id,name,metadata) values('academy-student-media',$1,$2::jsonb)",[m.path,JSON.stringify({size:data.length,mimetype:'image/webp'})]);
   files.set(m.path,Buffer.from(data));return service('academy_portal_confirm_upload',[id,actor,'a'.repeat(64)]);
  }));
  await context.exposeFunction('auditMedia',path=>serial(async()=>{if(!(await state.storage(actor,path)).length)throw Error('Private media denied');return [...(files.get(path)||Buffer.alloc(0))];}));
  const provided=['ready','configured','initializationError','auth','academyPortalApi','academyPortalMedia','academyPortalUpload','escapeHtml','academyBackupApi','academyBackupConnection'];
  const session=initialUser?{user:{id:initialUser,email:'fixture@example.test'}}:null;
  const client=`export const ready=Promise.resolve(),configured=true,initializationError=null;let session=${JSON.stringify(session)},listeners=[];
   window.auditChangeSession=async(id)=>{await window.auditActor(id);session=id?{user:{id,email:'fixture@example.test'}}:null;listeners.forEach(fn=>fn(id?'SIGNED_IN':'SIGNED_OUT',session));};
   export const auth={getSession:async()=>({data:{session}}),onAuthStateChange:fn=>{listeners.push(fn);return {data:{subscription:{unsubscribe(){}}}};},signOut:async()=>window.auditChangeSession(null)};
   export const academyPortalApi=(action,p={})=>window.auditRpc(action,p),academyPortalMedia=async path=>new Blob([Uint8Array.from(await window.auditMedia(path))],{type:'image/webp'}),academyPortalUpload=async(id,file,progress)=>{progress(50);const r=await window.auditUpload({id,bytes:[...new Uint8Array(await file.arrayBuffer())]});progress(100);return r;};
   export const escapeHtml=v=>String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
   export const academyBackupApi=async()=>({enabled:false,jobs:[],schedule:'Daily at 02:00 Asia/Manila'}),academyBackupConnection=async()=>({});
   ${names.filter(n=>!provided.includes(n)).map(n=>`export const ${n}=async()=>({});`).join('\n')}`;
  await context.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
   if(u.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:client});
   if(u.pathname==='/assets/ordering/newsletter-client.js')return route.fulfill({contentType:'text/javascript',body:"let status='unsubscribed';export async function newsletterRequest(action){if(action==='subscribe')status='subscribed';if(action==='unsubscribe')status='unsubscribed';return {status};}"});
   let p=u.pathname;if(/^\/academy\/(dashboard|admin|unsubscribe)\/?$/.test(p))p=p.replace(/\/$/,'')+'/index.html';
   const file=resolve(root,'.'+decodeURIComponent(p));if(!file.startsWith(root+sep))return route.abort();
   try{await route.fulfill({body:await readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.svg':'image/svg+xml','.json':'application/json'})[extname(file)]||'application/octet-stream'});}catch{await route.fulfill({status:404,body:'Missing test asset'});}
  });
  const page=await context.newPage();page.setDefaultTimeout(4000);page.on('pageerror',e=>errors.push(e.message));
  return {page,context,calls,failNext:(action,when='before',message)=>{failure={action,when,message};},failUpload:n=>{uploadFailure=uploads+n;},delayNext:action=>{let release,started;const wait=new Promise(r=>release=r),pending=new Promise(r=>started=r);delay={action,wait,started};return {pending,release};},setActor:value=>{actor=value;}};
 }
 return {...state,origin,out,browser,errors,pageFor,serial,close:async()=>{await browser.close();await db.close();}};
}
