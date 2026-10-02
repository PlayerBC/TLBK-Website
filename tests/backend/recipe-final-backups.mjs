import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {makeHarness} from './helpers.mjs';
import {unwrapRecipeResult} from './recipe-staff-fixture.mjs';
import {blankRecipe} from '../../assets/ordering/recipe-model.js';
import {digestBytes} from '../../assets/ordering/recipe-archive.js';
import {buildRecipeArchive} from '../../supabase/functions/recipe-backup/archive.ts';
import {readRecipeArchive} from '../../assets/ordering/recipe-recovery.js';
import {rehearseRecipeRestore} from '../../scripts/restore-recipe-backup.mjs';

export default async function({check}){
 const require=createRequire(join(resolve(process.env.PGLITE_PACKAGE_ROOT),'package.json')),{PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
 const db=new PGlite({extensions:{pgcrypto}}),project=resolve(import.meta.dirname,'../..');
 try{
 await db.exec(await readFile(join(project,'tests/backend/bootstrap.sql'),'utf8'));
 for(const migration of (await readdir(join(project,'supabase/migrations'))).filter(n=>n.endsWith('.sql')).sort())await db.exec((await readFile(join(project,'supabase/migrations',migration),'utf8')).replace(/\r\n/g,'\n'));
 const h=await makeHarness(db),owner=h.ids.owner;
 const api=(a,p={},user=owner)=>h.as(user,async()=>(await db.query('select public.recipe_api($1,$2::jsonb) result',[a,JSON.stringify(p)])).rows[0].result).then(unwrapRecipeResult);
 const service=(a,p={})=>h.as(null,async()=>(await db.query('select public.recipe_backup_service($1,$2::jsonb) result',[a,JSON.stringify(p)])).rows[0].result,'service_role');
 const bytes=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwAAAAABJRU5ErkJggg==','base64'));
 const file=async(name)=>{const f=await api('reserve_file',{filename:name,mime_type:'image/png',size_bytes:bytes.length,sha256:digestBytes(bytes)});await db.query("insert into storage.objects(bucket_id,name,metadata) values('recipe-files',$1,$2::jsonb)",[f.path,JSON.stringify({size:bytes.length,mimetype:f.mime_type})]);await api('confirm_file',{id:f.id});return f;};
 const oldPhoto=await file('old-final.png'),finalPhoto=await file('current-final.png'),draftPhoto=await file('draft-only.png');
 const ingredient=await api('save_resource',{kind:'ingredient',name:'Final backup flour',data:{default_unit:'g'},price:{amount:'100',quantity:'1000',unit:'g'}});
 const doc=(name,quantity='100',photo)=>{const d=blankRecipe();d.name=name;d.variants[0].yield={quantity:'1',unit:'cake',portions:'8'};d.variants[0].groups[0].ingredients=[{id:'flour',ingredient_id:ingredient.id,name:ingredient.name,quantity,unit:'g'}];d.variants[0].methods[0].steps[0].instruction='Fold gently and bake.';if(photo){d.files=[{id:photo.id,visibility:'kitchen'}];d.photos=[{id:'finished-photo',file_id:photo.id,caption:'Finished Final cake'}];}return d;};
 let main=await api('create',{document:doc('Previous Final name','100',oldPhoto),status:'final'}),previous=structuredClone(main);
 main=await api('save',{id:main.id,revision:main.revision,document:doc('Intermediate draft','200',draftPhoto),status:'draft'});
 main=await api('save',{id:main.id,revision:main.revision,document:doc('Published Final v3','300',finalPhoto),status:'final'});const final=structuredClone(main);
 main=await api('save',{id:main.id,revision:main.revision,document:doc('Working v4','400',draftPhoto),status:'draft'});
 main=await api('save',{id:main.id,revision:main.revision,document:doc('Renamed working v5','500',draftPhoto),status:'draft'});
 const draft=await api('create',{document:doc('Draft without any Final','600',draftPhoto),status:'draft'}),research=await api('create',{document:doc('R&D without any Final','700',draftPhoto),status:'testing'});
 let hidden=await api('create',{document:doc('Hidden Final','100'),status:'final'});hidden=await api('set_status',{id:hidden.id,revision:hidden.revision,status:'hidden'});
 let archived=await api('create',{document:doc('Archived Final','100'),status:'final'});archived=await api('set_status',{id:archived.id,revision:archived.revision,status:'archive'});
 let deleted=await api('create',{document:doc('Deleted Final','100'),status:'final'});await api('delete',{id:deleted.id,revision:deleted.revision});
 const current=await api('create',{document:doc('Current version is Final','100'),status:'final'});
 let filling=await api('create',{document:doc('Pinned component','80'),status:'final'});const pinned=structuredClone(filling);
 filling=await api('save',{id:filling.id,revision:filling.revision,document:doc('Pinned component','90'),status:'final'});const comparisonOnly=structuredClone(filling);
 filling=await api('save',{id:filling.id,revision:filling.revision,document:doc('Pinned component','100'),status:'final'});
 const parentDoc=doc('Final parent with pinned component','100');parentDoc.variants[0].components=[{id:'filling',version_id:pinned.version_id,variant_id:pinned.document.variants[0].id,quantity:'1',unit:'cake',mode:'pinned'}];parentDoc.base={version_id:comparisonOnly.version_id,name:'Previous variation base',overrides:[]};
 const parent=await api('create',{document:parentDoc,status:'final'});
 await api('save_resource',{id:ingredient.id,revision:ingredient.revision,kind:'ingredient',name:ingredient.name,data:ingredient.data,price:{amount:'150',quantity:'1000',unit:'g'}});
 let archive,recovered,start;
 await check('Final-only capture archives Final v3 when current is v5 Draft and aligns recovery names/pointers',async()=>{
  start=await service('begin',{kind:'download',user_id:owner});assert.equal(start.recipe_scope,'final');const chunks=[];for await(const chunk of buildRecipeArchive(start,service,async f=>{assert.equal(f.id,finalPhoto.id);return bytes;}))chunks.push(chunk);archive=new Blob(chunks);recovered=await readRecipeArchive(archive);
  const version=recovered.tables.recipe_versions.find(v=>v.recipe_id===main.id),record=recovered.tables.recipes.find(r=>r.id===main.id);assert.equal(version.id,final.version_id);assert.equal(version.number,3);assert.equal(record.name,final.document.name);assert.equal(record.current_version_id,final.version_id);assert.equal(record.production_version_id,final.version_id);assert.equal(record.updated_at,version.created_at);assert.deepEqual(version.document,final.document);assert.deepEqual(version.cost_snapshot,final.cost_snapshot);
  assert.equal(recovered.tables.recipe_versions.some(v=>v.id===main.version_id||v.id===previous.version_id),false);assert.equal(recovered.files.length,1);assert.equal(recovered.files[0].id,finalPhoto.id);assert.deepEqual(new Uint8Array(await recovered.files[0].blob.arrayBuffer()),bytes);assert.equal(recovered.manifest.schema_version,5);
  await service('finish',{job_id:start.job_id,lease_token:start.lease_token,sha256:digestBytes(new Uint8Array(await archive.arrayBuffer())),size_bytes:archive.size});
 })();
 await check('Draft-only, R&D-only, Hidden, Archived and deleted recipes are excluded; a current Final is included',async()=>{
  const excluded=new Set([draft.id,research.id,hidden.id,archived.id,deleted.id]);assert.equal(recovered.tables.recipes.some(r=>excluded.has(r.id)),false);assert.equal(recovered.tables.recipe_versions.some(v=>excluded.has(v.recipe_id)),false);assert.ok(recovered.tables.recipe_versions.some(v=>v.id===current.version_id));assert.ok(recovered.tables.recipe_versions.every(v=>['approved','production'].includes(v.status)));assert.equal(recovered.tables.recipe_tests,undefined);assert.equal(recovered.tables.recipe_drafts,undefined);
 })();
 await check('Only necessary pinned Final component history is retained; optional old variation provenance is removed',async()=>{
  assert.ok(recovered.tables.recipe_versions.some(v=>v.id===pinned.version_id));assert.ok(recovered.tables.recipe_versions.some(v=>v.id===filling.version_id));assert.equal(recovered.tables.recipe_versions.some(v=>v.id===comparisonOnly.version_id),false);
  const v=recovered.tables.recipe_versions.find(v=>v.id===parent.version_id),expected=structuredClone(parent.document);delete expected.base;assert.deepEqual(v.document,expected);assert.deepEqual(v.cost_snapshot,parent.cost_snapshot);assert.equal(recovered.tables.recipe_links.some(l=>l.kind==='variation'),false);assert.ok(recovered.tables.recipe_links.some(l=>l.kind==='component'&&l.target_version_id===pinned.version_id));
 })();
 await check('Final saved costs are exact while the ingredient catalog retains its independently updated current quote',async()=>{
  const version=recovered.tables.recipe_versions.find(v=>v.id===final.version_id);assert.equal(Number(version.cost_snapshot.variants[0].total),30);assert.equal(Number(recovered.tables.recipe_prices.find(p=>p.resource_id===ingredient.id).amount),150);assert.deepEqual((await api('get',{id:main.id,version_id:final.version_id})).cost_snapshot,final.cost_snapshot);assert.equal((await api('get',{id:main.id})).version,5);
 })();
 await check('Final archive restores its formulas, exact costs, pointers, pinned relationships and PNG bytes into a new database',async()=>{
  const fresh=new PGlite({extensions:{pgcrypto}});try{const report=await rehearseRecipeRestore(archive,{db:fresh});assert.equal(report.relationships,true);assert.equal(report.checksums,true);assert.equal(report.production_modified,false);assert.equal(report.files,1);const row=(await fresh.query('select document,cost_snapshot from tlb.recipe_versions where id=$1',[final.version_id])).rows[0];assert.deepEqual(row.document,final.document);assert.deepEqual(row.cost_snapshot,final.cost_snapshot);const recipe=(await fresh.query('select * from tlb.recipes where id=$1',[main.id])).rows[0];assert.equal(recipe.current_version_id,final.version_id);assert.equal(recipe.production_version_id,final.version_id);assert.equal((await fresh.query("select count(*)::int n from tlb.recipe_access")).rows[0].n,0);assert.equal((await fresh.query("select count(*)::int n from tlb.recipe_versions where status in ('draft','testing')")).rows[0].n,0);}finally{await fresh.close();}
 })();
 await check('A genuine pre-migration schema-4 working archive remains restorable and an in-flight job remains labeled latest',async()=>{
  const legacyDb=new PGlite({extensions:{pgcrypto}}),root=resolve(import.meta.dirname,'../..');let legacyArchive;
  try{
   await legacyDb.exec(await readFile(join(root,'tests/backend/bootstrap.sql'),'utf8'));const migrations=(await readdir(join(root,'supabase/migrations'))).filter(n=>n.endsWith('.sql')).sort();const finalMigration=migrations.find(n=>n.endsWith('_recipe_final_only_backups.sql'));assert.ok(finalMigration);
   for(const m of migrations.filter(n=>n<finalMigration))await legacyDb.exec((await readFile(join(root,'supabase/migrations',m),'utf8')).replace(/\r\n/g,'\n'));
   const lh=await makeHarness(legacyDb),la=(a,p)=>lh.as(lh.ids.owner,async()=>(await legacyDb.query('select public.recipe_api($1,$2::jsonb) result',[a,JSON.stringify(p)])).rows[0].result).then(unwrapRecipeResult),ls=(a,p={})=>lh.as(null,async()=>(await legacyDb.query('select public.recipe_backup_service($1,$2::jsonb) result',[a,JSON.stringify(p)])).rows[0].result,'service_role');
   const d=blankRecipe();d.name='Legacy working archive';d.variants[0].groups[0].ingredients=[{id:'flour',name:'Flour',quantity:'100',unit:'g',cost_snapshot:{amount:'100',quantity:'1000',unit:'g'}}];d.variants[0].methods[0].steps[0].instruction='Mix.';let r=await la('create',{document:d,status:'final'});d.variants[0].groups[0].ingredients[0].quantity='200';r=await la('save',{id:r.id,revision:r.revision,document:d,status:'draft'});
   const oldStart=await ls('begin',{kind:'download',user_id:lh.ids.owner}),chunks=[];for await(const chunk of buildRecipeArchive(oldStart,ls,async()=>{throw Error('No files expected');}))chunks.push(chunk);legacyArchive=new Blob(chunks);assert.equal((await readRecipeArchive(legacyArchive)).manifest.schema_version,4);
   await legacyDb.exec((await readFile(join(root,'supabase/migrations',finalMigration),'utf8')).replace(/\r\n/g,'\n'));assert.equal((await legacyDb.query('select recipe_scope from tlb.recipe_backup_jobs where id=$1',[oldStart.job_id])).rows[0].recipe_scope,'latest');
   await ls('finish',{job_id:oldStart.job_id,lease_token:oldStart.lease_token,sha256:digestBytes(new Uint8Array(await legacyArchive.arrayBuffer())),size_bytes:legacyArchive.size});
   const restored=new PGlite({extensions:{pgcrypto}});try{assert.equal((await rehearseRecipeRestore(legacyArchive,{db:restored})).relationships,true);const v=(await restored.query('select * from tlb.recipe_versions')).rows[0];assert.equal(v.status,'draft');assert.equal(v.document.variants[0].groups[0].ingredients[0].quantity,'200');}finally{await restored.close();}
  }finally{await legacyDb.close();}
 })();
 }finally{await db.close();}
}
