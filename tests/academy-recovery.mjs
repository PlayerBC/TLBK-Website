import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import {setup} from './academy-portal.mjs';
import {buildAcademyArchive} from '../supabase/functions/academy-backup/archive.ts';
const require=createRequire((process.env.PLAYWRIGHT_PACKAGE_ROOT||process.cwd()+'/node_modules')+'/package.json'),JSZip=require('jszip');
const {db,h,api,service,cookie,upload}=await setup();let fresh;
try{
 const independentInstructor=randomUUID();await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'independent-instructor@example.test',now())",[independentInstructor]);await api(h.ids.owner,'save_instructor',{id:independentInstructor,display_name:'Independent Instructor'});
 const source=randomUUID(),version=randomUUID(),childId=randomUUID(),childVersion=randomUUID(),variantId=randomUUID();
 await db.query("insert into tlb.recipes(id,code,name) values($1,'QA-IMPORT','Main'),($2,'QA-COMPONENT','Filling')",[source,childId]);
 const component={name:'Filling',private_notes:'PRIVATE-FILLING',variants:[{id:variantId,name:'Filling formula',yield:{quantity:'100',unit:'g'},groups:[{name:'Filling',ingredients:[{name:'Sugar',quantity:'50',unit:'g',price:'PRIVATE-PRICE'}]}],methods:[],equipment:[],baking:[]}]};
 await db.query("insert into tlb.recipe_versions(id,recipe_id,number,status,document) values($1,$2,1,'production',$3::jsonb)",[childVersion,childId,JSON.stringify(component)]);
 const main={name:'Layer Cake',variants:[{name:'Cake',yield:{quantity:'1',unit:'cake'},groups:[],methods:[],equipment:[],baking:[],components:[{name:'Filling',version_id:childVersion,variant_id:variantId,quantity:'50',unit:'g'}]}]};
 await db.query("insert into tlb.recipe_versions(id,recipe_id,number,status,document) values($1,$2,1,'production',$3::jsonb)",[version,source,JSON.stringify(main)]);
 const r=await api(h.ids.owner,'import_recipe',{version_id:version});assert.equal(r.document.variants.length,2);assert.equal(r.document.variants[0].groups[0].ingredients[0].quantity,'50');assert.equal(r.document.variants[1].groups[0].ingredients[0].name,'Sugar');assert.ok(!JSON.stringify(r.document).includes('PRIVATE'));assert.ok(!JSON.stringify(r.document).includes(childVersion));
 await api(h.ids.owner,'assign_recipe',{class_id:cookie.id,recipe_id:r.id});
 const module=await api(h.ids.owner,'save_module',{class_id:cookie.id,name:'Assembling'});const media=await upload(h.ids.owner,{purpose:'module',module_id:module.id});await api(h.ids.owner,'attach_media',{id:media.id});assert.deepEqual((await api(h.ids.customer,'class',{id:cookie.id})).modules[0].photo_ids,[media.id]);
 await api(h.ids.customer,'newsletter',{academy:true});
 const start=await service('academy_backup_service',['begin',{kind:'download',user_id:h.ids.owner}]);
 const parts=[];for await(const part of buildAcademyArchive(start,(action,p)=>service('academy_backup_service',[action,p])))parts.push(part);
 const buffer=Buffer.concat(parts),zip=await JSZip.loadAsync(buffer),manifest=JSON.parse(await zip.file('manifest.json').async('string'));
 assert.equal(manifest.format,'tlb-academy-backup');assert.equal(manifest.files_included,false);
 const tables={};for(const entry of manifest.entries){const bytes=await zip.file(entry.path).async('nodebuffer');assert.equal(bytes.length,entry.size_bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);if(entry.path.startsWith('Database Exports/'))tables[entry.path.split('/')[1].replace('.json','')]=JSON.parse(bytes);}
 assert.ok(tables.actors.some(a=>a.id===independentInstructor&&!a.role));
 assert.equal(Object.keys(zip.files).length,manifest.entries.length+1);assert.equal(Object.values(tables).reduce((n,rows)=>n+rows.length,0),manifest.record_count);assert.ok(!JSON.stringify(tables).includes('unsubscribe_token'));assert.ok(!JSON.stringify(tables).includes('PRIVATE'));
 fresh=(await setup({fixtures:false})).db;
 for(const actor of tables.actors){await fresh.query('insert into auth.users(id,email) values($1,$2)',[actor.id,actor.email]);if(actor.role)await fresh.query('insert into tlb.staff(user_id,role) values($1,$2)',[actor.id,actor.role]);}
 // The restore destination has its own Auth IDs and production library. This
 // rehearsal reconciles actors and clears optional external provenance links.
 const order=['academy_instructors','academy_curricula','academy_modules','academy_enrollments','academy_student_recipes','academy_student_recipe_versions','academy_class_recipes','academy_announcements','academy_announcement_reads','academy_upcoming_classes','academy_submissions','academy_message_threads','academy_messages','academy_message_reads','academy_portal_media','academy_newsletter_preferences','academy_audit','academy_broadcasts'];
 for(const table of order){for(const sourceRow of tables[table]){const row={...sourceRow};if(table==='academy_curricula')row.public_class_id=null;if(table==='academy_student_recipes')row.source_version_id=null;const cols=Object.keys(row);await fresh.query(`insert into tlb.${table}(${cols.join(',')}) overriding system value select ${cols.join(',')} from jsonb_populate_record(null::tlb.${table},$1::jsonb)`,[JSON.stringify(row)]);}assert.equal(Number((await fresh.query(`select count(*) n from tlb.${table}`)).rows[0].n),tables[table].length);}
 assert.equal(Number((await fresh.query('select count(*) n from tlb.academy_instructors where user_id=$1',[independentInstructor])).rows[0].n),1);assert.equal(Number((await fresh.query('select count(*) n from tlb.staff where user_id=$1',[independentInstructor])).rows[0].n),0);
 await fresh.exec("select setval(pg_get_serial_sequence('tlb.academy_audit','id'),greatest(1,(select coalesce(max(id),1) from tlb.academy_audit)));");
 await fresh.exec('set role authenticated');await fresh.query("select set_config('request.jwt.claim.sub',$1,false)",[h.ids.customer]);const restored=(await fresh.query("select public.academy_portal_api('recipe',$1::jsonb) r",[JSON.stringify({id:r.id,class_id:cookie.id})])).rows[0].r;assert.equal(restored.document.variants[1].groups[0].ingredients[0].name,'Sugar');await assert.rejects(fresh.query('select * from tlb.academy_enrollments'));await fresh.exec('reset role');
 await service('academy_backup_service',['finish',{job_id:start.job_id,lease_token:start.lease_token,sha256:createHash('sha256').update(buffer).digest('hex'),size_bytes:buffer.length}]);
 await mkdir('tests/artifacts/academy-portal',{recursive:true});await writeFile('tests/artifacts/academy-portal/recovery-results.json',JSON.stringify({status:'PASS',checks:['Recursive linked-component import excludes sensitive fields and production pointers','Module photo is independently stored and visible to enrolled student','Snapshot paging and ZIP checksums match every exported record','All 18 metadata tables restore under real foreign-key constraints','External source/public-gallery references reconciled explicitly','Restored student can read assigned recipe; direct table access remains denied'],record_count:manifest.record_count,bytes:buffer.length,images_included:false},null,2));console.log('PASS linked-component import, module photo, archive integrity and isolated metadata restore');
}finally{await fresh?.close();await db.close();}
