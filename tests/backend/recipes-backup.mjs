import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
import {makeHarness} from './helpers.mjs';
import {buildRecipeArchive} from '../../supabase/functions/recipe-backup/archive.ts';
import {runRecipeBackup} from '../../supabase/functions/recipe-backup/handler.ts';
import {digestBytes} from '../../assets/ordering/recipe-archive.js';
import {readRecipeArchive} from '../../assets/ordering/recipe-recovery.js';
import {rehearseRecipeRestore} from '../../scripts/restore-recipe-backup.mjs';
export default async function({db,check}){
 const h=await makeHarness(db),owner=h.ids.owner;
 const api=(action,payload={},user=owner)=>h.as(user,async()=>(await db.query('select public.recipe_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result);
 const backup=(action,payload={},user=owner)=>h.as(user,async()=>(await db.query('select public.recipe_backup_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result);
 const service=(action,payload={})=>h.as(null,async()=>(await db.query('select public.recipe_backup_service($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result,'service_role');
 const blobBytes=new TextEncoder().encode('private recipe attachment fixture'),sha=digestBytes(blobBytes);
 const supplier=await api('save_resource',{kind:'supplier',name:'QA Supplier',data:{contact_name:'QA Contact',email:'supplier@example.test'}});
 const ingredient=await api('save_resource',{kind:'ingredient',name:'QA Sugar',data:{default_unit:'g'},price:{amount:'100',quantity:'1',unit:'kg',supplier_id:supplier.id}});
 const packaging=await api('save_resource',{kind:'packaging',name:'QA Box',data:{dimensions:'10 x 10 x 6.5 inches'},price:{amount:'300',quantity:'10',unit:'pcs',supplier_id:supplier.id}});
 const file=await api('reserve_file',{filename:'source.txt',mime_type:'text/plain',size_bytes:blobBytes.length,sha256:sha});
 await db.query("insert into storage.objects(bucket_id,name,metadata) values('recipe-files',$1,$2::jsonb)",[file.path,JSON.stringify({size:blobBytes.length,mimetype:file.mime_type})]);await api('confirm_file',{id:file.id});
 const doc={name:'QA Backed-up cake',category_id:null,private_notes:'Keep recipe private',files:[{id:file.id,visibility:'private'}],variants:[{id:'base',name:'8 inch',yield:{quantity:'1',unit:'cake',portions:'8'},groups:[{id:'batter',name:'Batter',ingredients:[{id:'sugar',ingredient_id:ingredient.id,name:'Sugar',quantity:'424',unit:'g'}]}],methods:[{name:'Bake',steps:[{id:'bake',instruction:'Bake carefully.'}]}],additional_costs:[{name:'Packaging',amount:'30'}]}]};
 let recipe=await api('create',{document:doc,status:'production'});
 await api('save_test',{recipe_id:recipe.id,version_id:recipe.version_id,data:{observations:'Soft center',rating:4},proposed_document:doc});
 await api('record_run',{version_id:recipe.version_id,variant_id:'base',multiplier:'2',actual_yield:'2',produced_on:'2026-09-30',notes:'Backup fixture production run'});
 let start,archive;
 await check('recipe backup is owner-only and cannot report success without Drive verification',async()=>{
  await assert.rejects(()=>backup('status',{},h.ids.staff),/Authorized recipe/);
  await assert.rejects(()=>h.as(owner,()=>db.query("select public.recipe_backup_service('begin','{}')")),/permission denied/);
  const slots=[];for(const [kind,count]of[['daily',30],['monthly',12],['manual',2]])for(let slot=1;slot<=count;slot++)slots.push({kind,slot,drive_file_id:`QA_${kind}_${String(slot).padStart(20,'0')}`});
  await service('connect',{folder_id:'1rRxDTqAVqliCdx0OTRJK0XuLC4iHQyeg',slots});start=await service('begin',{});assert.equal(start.kind,'daily');
  await assert.rejects(()=>service('finish',{job_id:start.job_id,lease_token:start.lease_token,sha256:sha,size_bytes:1000}),/Drive must confirm/);
  assert.equal((await backup('status')).last_success_at,null);assert.equal((await service('begin',{})).skipped,'busy');
 })();
 await check('backup snapshot remains consistent while recipes and prices are edited',async()=>{
  const changed=structuredClone(doc);changed.name='QA Newer cake';recipe=await api('save',{id:recipe.id,revision:recipe.revision,document:changed,status:'draft'});
  await api('save_resource',{id:ingredient.id,revision:ingredient.revision,kind:'ingredient',name:'QA Sugar',data:{default_unit:'g'},price:{amount:'120',quantity:'1',unit:'kg'}});
  const page=await service('page',{job_id:start.job_id,lease_token:start.lease_token,table:'recipes'});assert.equal(page.rows[0].data.name,'QA Backed-up cake');
  const parts=[];for await(const part of buildRecipeArchive(start,service,async f=>{assert.equal(f.id,file.id);return blobBytes;}))parts.push(part);archive=new Blob(parts);
  const recovered=await readRecipeArchive(archive);assert.equal(recovered.files.length,1);assert.equal(await recovered.files[0].blob.text(),new TextDecoder().decode(blobBytes));
  assert.equal(recovered.tables.recipes[0].name,'QA Backed-up cake');assert.equal(recovered.tables.recipe_prices.length,2);
  assert.equal(recovered.tables.recipe_versions[0].document.variants[0].groups[0].ingredients[0].cost_snapshot.amount,'100');
  assert.equal(recovered.tables.recipe_runs.length,1);assert.equal(Number(recovered.tables.recipe_runs[0].actual_yield),2);
 })();
 await check('complete archive restores into an isolated database with matching nested formulas and relationships',async()=>{
  const require=createRequire(process.env.PGLITE_PACKAGE_ROOT?join(resolve(process.env.PGLITE_PACKAGE_ROOT),'package.json'):import.meta.url);
  const {PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');const isolated=new PGlite({extensions:{pgcrypto}});
  try{const restored=await rehearseRecipeRestore(archive,{db:isolated});assert.equal(restored.relationships,true);assert.equal(restored.files,1);assert.equal(restored.production_modified,false);
   assert.equal((await isolated.query('select document from tlb.recipe_versions')).rows[0].document.variants[0].groups[0].ingredients[0].quantity,'424');
   assert.equal(Number((await isolated.query('select actual_yield from tlb.recipe_runs')).rows[0].actual_yield),2);
   const maximum=Number((await isolated.query('select max(id) id from tlb.recipe_audit')).rows[0].id||0);
   const event=(await isolated.query("insert into tlb.recipe_audit(action,details) values('restore_rehearsal_next_edit','{}') returning id")).rows[0];assert.ok(Number(event.id)>maximum);
  }finally{await isolated.close();}
 })();
 await check('modified file bytes are rejected by recovery checksum validation',async()=>{
  const data=new Uint8Array(await archive.arrayBuffer()),needle=blobBytes;let index=-1;
  outer:for(let i=0;i<data.length-needle.length;i++){for(let j=0;j<needle.length;j++)if(data[i+j]!==needle[j])continue outer;index=i;break;}
  assert.ok(index>0);data[index]^=1;await assert.rejects(()=>readRecipeArchive(new Blob([data])),/Checksum/);
 })();
 await check('verified uploads advance status and monthly copies use the verified daily archive',async()=>{
  const fullSha=digestBytes(new Uint8Array(await archive.arrayBuffer()));
  await service('finish',{job_id:start.job_id,lease_token:start.lease_token,sha256:fullSha,size_bytes:archive.size,drive_verified:true});
  const status=await backup('status');assert.ok(status.last_success_at);assert.equal(status.slots.filter(s=>s.valid).length,1);
  assert.equal(await h.scalar('select count(*)::int from tlb.recipe_backup_rows'),0);
  const monthly=await service('begin',{});assert.equal(monthly.kind,'monthly');assert.equal(monthly.source_sha256,fullSha);
  await service('finish',{job_id:monthly.job_id,lease_token:monthly.lease_token,sha256:fullSha,size_bytes:archive.size,drive_verified:true});
  assert.equal((await service('begin',{})).skipped,'not_due');
 })();
 await check('failed Drive uploads preserve good copies, expose the error and permit retry',async()=>{
  const before=await backup('status'),manual=await service('begin',{kind:'manual'});
  await runRecipeBackup(manual,{upload:async()=>{throw Error('Provider unavailable');}},service,()=>{throw Error('Provider unavailable');});
  const failed=await backup('status');assert.equal(failed.last_success_at,before.last_success_at);assert.equal(failed.last_error,'network');assert.equal(failed.consecutive_failures,1);assert.equal(failed.slots.filter(s=>s.valid).length,2);
  assert.equal(failed.manual_requested,true);const retry=await service('begin',{});assert.equal(retry.kind,'manual');assert.ok(retry.job_id);await service('finish',{job_id:retry.job_id,lease_token:retry.lease_token,error:'network'});
 })();
}
