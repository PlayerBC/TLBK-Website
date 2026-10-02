import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setup} from './academy-portal.mjs';
const s=await setup(),{db,h,api,cookie,cupcake}=s;let passed=0;
const test=async(name,fn)=>{await fn();passed++;console.log('PASS',name);};
const payload=(extra={})=>({id:randomUUID(),class_id:cookie.id,title:'Cake template',description:'Print at 100%.',file_name:'cake-template.pdf',size_bytes:20,sha256:'a'.repeat(64),...extra});
const put=(actor,m,size=20)=>h.as(actor,()=>db.query("insert into storage.objects(bucket_id,name,metadata) values('academy-class-materials',$1,$2::jsonb)",[m.path,JSON.stringify({size,mimetype:'application/octet-stream'})]));
const read=(actor,m)=>h.as(actor,()=>db.query("select name from storage.objects where bucket_id='academy-class-materials' and name=$1",[m.path]));
let m,t;
try{
 await db.exec('grant insert,delete,update on storage.objects to authenticated;');
 await test('Only the owner can reserve materials; other classes and anonymous lists stay private',async()=>{
  for(const actor of [null,h.ids.customer,h.ids.staff,h.ids.teacher2,h.ids.stranger])await assert.rejects(api(actor,'reserve_material',payload()));
  for(const actor of [null,h.ids.stranger,h.ids.unverified,h.ids.teacher2])await assert.rejects(api(actor,'materials',{class_id:cookie.id}));
  assert.deepEqual(await api(h.ids.customer,'materials',{class_id:cookie.id}),[]);
 });
 await test('Reservation is idempotent and file metadata cannot be switched on retry',async()=>{
  const p=payload();m=await api(h.ids.owner,'reserve_material',p);assert.deepEqual(await api(h.ids.owner,'reserve_material',p),m);
  for(const change of [{sha256:'b'.repeat(64)},{file_name:'other.pdf'},{size_bytes:21},{class_id:cupcake.id}])await assert.rejects(api(h.ids.owner,'reserve_material',{...p,...change}));
 });
 await test('Storage permits only reserved owner uploads; pending files are hidden from students',async()=>{
  for(const actor of [h.ids.customer,h.ids.staff,h.ids.teacher2,h.ids.stranger])await assert.rejects(put(actor,m));
  await assert.rejects(put(h.ids.owner,{path:'unreserved.pdf'}));await put(h.ids.owner,m);
  assert.equal((await read(h.ids.owner,m)).rows.length,1);assert.equal((await read(h.ids.customer,m)).rows.length,0);
  assert.deepEqual(await api(h.ids.customer,'materials',{class_id:cookie.id}),[]);await assert.rejects(api(h.ids.customer,'publish_material',{id:m.id}));
 });
 await test('Publish validates the stored file and grants enrolled students and assigned instructors download access',async()=>{
  const missing=await api(h.ids.owner,'reserve_material',payload());await assert.rejects(api(h.ids.owner,'publish_material',{id:missing.id}));
  const wrong=await api(h.ids.owner,'reserve_material',payload());await put(h.ids.owner,wrong,21);await assert.rejects(api(h.ids.owner,'publish_material',{id:wrong.id}));
  await api(h.ids.owner,'publish_material',{id:m.id});await api(h.ids.owner,'publish_material',{id:m.id});
  for(const actor of [h.ids.customer,h.ids.staff,h.ids.owner]){assert.equal((await read(actor,m)).rows.length,1);assert.equal((await api(actor,'material',{id:m.id})).path,m.path);}
  for(const actor of [null,h.ids.stranger,h.ids.teacher2,h.ids.unverified]){assert.equal((await read(actor,m)).rows.length,0);await assert.rejects(api(actor,'material',{id:m.id}));}
  const list=await api(h.ids.customer,'materials',{class_id:cookie.id});assert.equal(list.length,1);assert.equal(list[0].path,undefined);
 });
 await test('Students cannot edit, delete or overwrite a published file',async()=>{
  for(const action of ['save_material','remove_material'])await assert.rejects(api(h.ids.customer,action,{id:m.id,title:'Changed'}));
  assert.equal((await h.as(h.ids.customer,()=>db.query("delete from storage.objects where bucket_id='academy-class-materials' and name=$1 returning name",[m.path]))).rows.length,0);
  assert.equal((await h.as(h.ids.owner,()=>db.query("update storage.objects set metadata='{}' where bucket_id='academy-class-materials' and name=$1 returning name",[m.path]))).rows.length,0);
 });
 await test('Removed materials disappear immediately and old paths stop working for students',async()=>{
  await api(h.ids.owner,'save_material',{id:m.id,title:'Updated template',description:'Use A4 paper.'});assert.equal((await api(h.ids.customer,'materials',{class_id:cookie.id}))[0].title,'Updated template');
  await api(h.ids.owner,'remove_material',{id:m.id});assert.deepEqual(await api(h.ids.customer,'materials',{class_id:cookie.id}),[]);assert.equal((await read(h.ids.customer,m)).rows.length,0);await assert.rejects(api(h.ids.customer,'material',{id:m.id}));await assert.rejects(api(h.ids.owner,'publish_material',{id:m.id}));
 });
 await test('Server enforces filename, extension, hash and 25 MB limits',async()=>{
  for(const patch of [{file_name:'../escape.pdf'},{file_name:'a.html'},{file_name:'a.exe'},{file_name:'a.pdf\n.exe'},{file_name:'a'},{size_bytes:0},{size_bytes:26214401},{sha256:'bad'},{title:''}])await assert.rejects(api(h.ids.owner,'reserve_material',payload(patch)));
  assert.equal((await db.query("select public,file_size_limit,allowed_mime_types from storage.buckets where id='academy-class-materials'")).rows[0].public,false);
 });
 await test('Revoked enrollment and hidden classes block downloads even with the previous path',async()=>{
  const fresh=await api(h.ids.owner,'reserve_material',payload());await put(h.ids.owner,fresh);await api(h.ids.owner,'publish_material',{id:fresh.id});
  const enrollment=(await db.query('select id from tlb.academy_enrollments where class_id=$1 and user_id=$2',[cookie.id,h.ids.customer])).rows[0];await api(h.ids.owner,'revoke',{id:enrollment.id});assert.equal((await read(h.ids.customer,fresh)).rows.length,0);await assert.rejects(api(h.ids.customer,'material',{id:fresh.id}));
  await api(h.ids.owner,'assign',{class_id:cookie.id,user_ids:[h.ids.customer]});await db.query("update tlb.academy_curricula set status='hidden' where id=$1",[cookie.id]);assert.equal((await read(h.ids.customer,fresh)).rows.length,0);
 });
 await test('Custom templates are owner-only and saves do not queue messages',async()=>{
  const before=(await db.query('select count(*) n from tlb.outbox')).rows[0].n;
  const p={kind:'marketing',name:'Summer camp',subject:'Bake with us',body:'Our next class is ready.',request_key:randomUUID()};
  for(const actor of [null,h.ids.customer,h.ids.staff]){await assert.rejects(api(actor,'email_templates',{kind:'marketing'}));await assert.rejects(api(actor,'save_email_template',p));}
  t=await api(h.ids.owner,'save_email_template',p);assert.equal((await api(h.ids.owner,'save_email_template',p)).id,t.id);
  assert.equal((await api(h.ids.owner,'email_templates',{kind:'marketing'})).templates.length,1);assert.equal((await api(h.ids.owner,'email_templates',{kind:'operational'})).templates.length,0);
  assert.equal((await db.query('select count(*) n from tlb.outbox')).rows[0].n,before);
 });
 await test('Template edits enforce revisions and deletion leaves broadcasts unchanged',async()=>{
  const p={id:t.id,revision:t.revision,name:'Summer camp revised',subject:'Bake with us',body:'New details.'};t=await api(h.ids.owner,'save_email_template',p);assert.equal(t.revision,2);await assert.rejects(api(h.ids.owner,'save_email_template',p));
  await assert.rejects(api(h.ids.customer,'delete_email_template',{id:t.id}));await api(h.ids.owner,'delete_email_template',{id:t.id});assert.equal((await api(h.ids.owner,'email_templates',{kind:'marketing'})).templates.length,0);
 });
 await test('Resource tables stay private, use RLS, and are included in metadata backups',async()=>{
  for(const table of ['academy_class_materials','academy_email_templates']){await assert.rejects(h.as(h.ids.customer,()=>db.query(`select * from tlb.${table}`)));assert.equal((await db.query("select relrowsecurity from pg_class where oid=$1::regclass",['tlb.'+table])).rows[0].relrowsecurity,true);}
  const tables=(await db.query('select tlb.academy_backup_tables() t')).rows[0].t;assert.ok(tables.includes('academy_class_materials')&&tables.includes('academy_email_templates'));
 });
 console.log(`${passed} resource database checks passed`);
}finally{await db.close();}
