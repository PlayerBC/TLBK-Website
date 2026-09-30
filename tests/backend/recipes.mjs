import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {makeHarness} from './helpers.mjs';

export default async function({db,check}) {
 const h=await makeHarness(db),{owner,staff,customer,stranger,unverified}=h.ids;
 const api=(action,payload={},user=owner)=>h.as(user,async()=> (await db.query('select public.recipe_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result);
 const recipe=(name='Vanilla cookies')=>({name,tags:['cookie','vanilla'],private_notes:'OWNER_PRIVATE',variants:[{id:'base',name:'Standard',yield:{quantity:'24',unit:'cookies',portions:'24',portion_weight:'100',batch_weight:'2400',pans:'2'},groups:[{id:'batter',name:'Batter',ingredients:[{id:'sugar',name:'Sugar',quantity:'120',unit:'g'},{id:'flour',name:'Flour',quantity:'1½ + 1/16',unit:'kg'}]}],methods:[{name:'Mix',steps:[{id:'mix',instruction:'Combine the ingredients.',timer_minutes:'2'}]}],baking:[{name:'Bake',top:'180',bottom:'170',minutes:'12'}],packaging:{description:'Cookie pouch',private_notes:'PRIVATE_PACKAGING',cost:'500'},additional_costs:[{name:'Labor',amount:'200'}]}]});
 let cookie,component,parent,ingredient;
 await check('recipes reject anonymous, unverified, customer and unassigned staff access',async()=>{
  for(const user of [null,customer,staff,unverified])await assert.rejects(()=>api('bootstrap',{},user),/permission denied|Authorized recipe/);
  assert.equal((await api('bootstrap')).role,'owner');
 })();
 await check('owner grants chef and kitchen permissions independently of ordinary staff privileges',async()=>{
  await db.query("insert into tlb.staff(user_id,role) values($1,'staff')",[customer]);
  await api('save_access',{user_id:staff,permission:'chef'});
  await api('save_access',{user_id:customer,permission:'kitchen'});
  assert.equal((await api('bootstrap',{},staff)).role,'chef');assert.equal((await api('bootstrap',{},customer)).role,'kitchen');
  await assert.rejects(()=>api('save_access',{user_id:stranger,permission:'chef'},staff),/owner/);
 })();
 await check('create and explicitly publish a recipe, keeping private information out of kitchen payloads',async()=>{
  cookie=await api('create',{document:recipe(),status:'production',reason:'Approved formula'});
  assert.equal(cookie.version,1);assert.equal(cookie.status,'production');
  const kitchen=await api('get',{id:cookie.id},customer);
  assert.equal(kitchen.document.name,'Vanilla cookies');assert.equal(kitchen.cost_snapshot,null);
  assert.equal(kitchen.document.private_notes,undefined);assert.equal(kitchen.document.variants[0].additional_costs,undefined);
  assert.equal(kitchen.document.variants[0].packaging.cost,undefined);
  assert.equal(kitchen.document.variants[0].packaging.private_notes,undefined);
 })();
 await check('chef changes create drafts while the approved kitchen formula remains unchanged',async()=>{
  const doc=structuredClone(cookie.document);doc.name='Vanilla cookies draft';doc.variants[0].groups[0].ingredients[0].quantity='125';
  const draft=await api('save',{id:cookie.id,revision:cookie.revision,document:doc,status:'draft'},staff);
  const kitchen=await api('get',{id:cookie.id},customer);assert.equal(kitchen.version,1);assert.equal(kitchen.document.name,'Vanilla cookies');
  assert.equal(kitchen.document.variants[0].groups[0].ingredients[0].quantity,'120');
  await assert.rejects(()=>api('save',{id:draft.id,revision:draft.revision,document:doc,status:'production'},staff),/owner/);
  await assert.rejects(()=>api('save',{id:draft.id,revision:cookie.revision,document:doc,status:'draft'},staff),/another window/);
  cookie=draft;
 })();
 await check('production versions, prices and audit history cannot be overwritten',async()=>{
  await assert.rejects(()=>db.query("update tlb.recipe_versions set document='{}' where id=$1",[cookie.version_id]),/immutable/);
  await assert.rejects(()=>api('versions',{id:cookie.id},customer),/editor/);
  await assert.rejects(()=>h.as(staff,()=>db.exec('select * from tlb.recipes')),/permission denied/);
 })();
 await check('draft autosave and local production scaling do not touch saved formulas',async()=>{
  const doc=structuredClone(cookie.document);doc.name='Unsaved local draft';
  await api('autosave',{draft_id:randomUUID(),id:cookie.id,revision:cookie.revision,document:doc},staff);
  assert.equal((await api('get',{id:cookie.id})).revision,cookie.revision);
  assert.equal((await api('drafts',{},staff))[0].document.name,'Unsaved local draft');
  assert.equal((await api('drafts')).length,0);
  await assert.rejects(()=>api('autosave',{draft_id:randomUUID(),document:doc},customer),/editor/);
 })();
 await check('structured quantities and identities are validated on the server',async()=>{
  for(const qty of ['-1','NaN','1/0','0/0','1e999','']) {
   const doc=recipe();doc.variants[0].groups[0].ingredients[0].quantity=qty;
   await assert.rejects(()=>api('create',{document:doc}));
  }
  const zero=recipe();zero.variants[0].yield.quantity='0';await assert.rejects(()=>api('create',{document:zero}),/yield/);
  const duplicate=recipe();duplicate.variants[0].groups[0].ingredients[1].id='sugar';await assert.rejects(()=>api('create',{document:duplicate}),/unique IDs/);
  const broken=recipe();broken.variants[0].groups[0].ingredients[0].ingredient_id=randomUUID();await assert.rejects(()=>api('create',{document:broken}),/reference/);
 })();
 await check('master resources retain supplier links and append-only price history',async()=>{
  const supplier=await api('save_resource',{kind:'supplier',name:'Baking supplier',data:{email:'private@example.test'}});
  ingredient=await api('save_resource',{kind:'ingredient',name:'Sugar',data:{default_unit:'g',allergens:[]},price:{amount:'100',quantity:'1',unit:'kg',supplier_id:supplier.id}});
  ingredient=await api('save_resource',{id:ingredient.id,revision:ingredient.revision,kind:'ingredient',name:'Sugar',data:{default_unit:'g'},price:{amount:'120',quantity:'1',unit:'kg',supplier_id:supplier.id}});
  const history=await api('prices',{id:ingredient.id});assert.equal(history.length,2);
  assert.equal(await h.scalar('select count(*)::int from tlb.recipe_supplier_items where resource_id=$1',[ingredient.id]),1);
  await assert.rejects(()=>db.query('delete from tlb.recipe_prices where resource_id=$1',[ingredient.id]),/immutable/);
  await assert.rejects(()=>api('resources',{kind:'supplier'},customer),/editor/);
 })();
 await check('linked components stay pinned when their source changes and cycles are rejected',async()=>{
  component=await api('create',{document:recipe('Sponge component'),status:'production'});
  const doc=recipe('Layer cake');doc.variants[0].components=[{id:'sponge',version_id:component.version_id,quantity:'0.5',mode:'latest'}];
  parent=await api('create',{document:doc,status:'production'});
  const edited=structuredClone(component.document);edited.variants[0].groups[0].ingredients[0].quantity='130';
  component=await api('save',{id:component.id,revision:component.revision,document:edited,status:'production'});
  const loaded=await api('get',{id:parent.id});assert.equal(loaded.links[0].update_available,true);assert.notEqual(loaded.links[0].version_id,component.version_id);
  const cyclic=structuredClone(component.document);cyclic.variants[0].components=[{id:'cycle',version_id:parent.version_id,quantity:'1'}];
  await assert.rejects(()=>api('save',{id:component.id,revision:component.revision,document:cyclic,status:'draft'}),/cycle/);
  await assert.rejects(()=>api('delete',{id:component.id,revision:component.revision}),/Other recipes/);
 })();
 await check('duplication and variations create new IDs with their base version retained',async()=>{
  const copy=await api('duplicate',{version_id:cookie.version_id});assert.notEqual(copy.id,cookie.id);assert.notEqual(copy.code,cookie.code);assert.equal(copy.status,'draft');
  const variation=await api('duplicate',{version_id:cookie.version_id,mode:'variation',name:'Chocolate cookies'});
  assert.equal(variation.document.base.version_id,cookie.version_id);assert.equal(variation.links[0].kind,'variation');
 })();
 await check('R&D updates preserve prior values and promotion requires an explicit owner action',async()=>{
  const tested=recipe('Basque cheesecake');tested.variants[0].baking=[{name:'Bake',top:'300',bottom:'200',minutes:'9'},{name:'Browning',top:'320',bottom:'180',actual_bottom:'200',minutes:'3',notes:'Tray overturned'}];
  let log=await api('save_test',{recipe_id:cookie.id,version_id:cookie.version_id,data:{observations:'Soft center',rating:4},proposed_document:tested},staff);
  const baseRevision=(await api('get',{id:cookie.id})).revision;assert.equal(baseRevision,cookie.revision);
  log=await api('save_test',{id:log.id,revision:log.revision,recipe_id:cookie.id,version_id:cookie.version_id,data:{observations:'Excellent browning',rating:5},proposed_document:tested},staff);
  await assert.rejects(()=>api('promote_test',{test_id:log.id,revision:cookie.revision,status:'production'},staff),/owner/);
  cookie=await api('promote_test',{test_id:log.id,revision:cookie.revision,status:'production',reason:'Successful test'});
  assert.equal(cookie.document.variants[0].baking.length,2);
  assert.equal((await api('tests',{id:cookie.id}))[0].data.observations,'Excellent browning');
  assert.equal((await api('tests',{id:cookie.id}))[0].promoted_version_id,cookie.version_id);
  await assert.rejects(()=>api('promote_test',{test_id:log.id,revision:cookie.revision,status:'production'}),/already been promoted/);
 })();
 await check('search, tag/status filters and pagination do not leak draft recipes to kitchen staff',async()=>{
  assert.equal((await api('list',{query:'Basque'},customer)).rows.length,1);
  assert.equal((await api('list',{query:'Chocolate cookies'},customer)).rows.length,0);
  const all=await api('list',{tag:'cookie',limit:2});assert.equal(all.rows.length,2);assert.ok(all.total>2);
  assert.equal((await api('list',{status:'draft'},customer)).total,0);
  await api('favorite',{id:cookie.id,favorite:true},customer);assert.equal((await api('list',{favorites:true},customer)).rows.length,1);
 })();
 await check('restoring a historical version makes a new version without overwriting the old formula',async()=>{
  const history=await api('versions',{id:cookie.id});const first=history.find(v=>v.number===1);
  const restored=await api('restore_version',{version_id:first.id,revision:cookie.revision,status:'draft',reason:'Review original'});
  assert.ok(restored.version>cookie.version);assert.equal(restored.document.name,'Vanilla cookies');
  assert.equal((await api('get',{id:cookie.id},customer)).document.name,'Basque cheesecake');cookie=restored;
 })();
 await check('archive and recoverable deletion preserve history and remove kitchen access',async()=>{
  const isolated=await api('create',{document:recipe('Archive test'),status:'production'});
  const archived=await api('save',{id:isolated.id,revision:isolated.revision,document:isolated.document,status:'archived'});
  await assert.rejects(()=>api('get',{id:archived.id},customer),/not found|not available/);
  await api('delete',{id:archived.id,revision:archived.revision});const deleted=await api('get',{id:archived.id});assert.ok(deleted.deleted_at);
  await api('undelete',{id:deleted.id,revision:deleted.revision});assert.equal((await api('versions',{id:deleted.id})).length,2);
 })();
 await check('pinned component costs and ingredient allergens stay historically reproducible',async()=>{
  const sugar=await api('save_resource',{kind:'ingredient',name:'Costed sugar',data:{allergens:['Dairy']},price:{amount:'100',quantity:'1000',unit:'g'}});
  const doc=recipe('Costed sponge');doc.variants[0].yield={quantity:'100',unit:'g',portions:'10'};doc.variants[0].groups[0].ingredients=[{id:'sugar',name:'Costed sugar',ingredient_id:sugar.id,quantity:'100',unit:'g'}];doc.variants[0].additional_costs=[];
  const sponge=await api('create',{document:doc,status:'production'});
  assert.equal(Number(sponge.cost_snapshot.variants[0].total),10);assert.deepEqual(sponge.document.detected_allergens,['Dairy']);
  const cake=recipe('Costed component cake');cake.variants[0].groups=[];cake.variants[0].additional_costs=[{name:'Packaging',amount:'5'}];cake.variants[0].components=[{id:'part',version_id:sponge.version_id,variant_id:'base',quantity:'50',unit:'g'}];
  const parent=await api('create',{document:cake,status:'production'});assert.equal(Number(parent.cost_snapshot.variants[0].total),10);assert.equal(parent.cost_snapshot.variants[0].complete,true);
  await api('save_resource',{id:sugar.id,revision:sugar.revision,kind:'ingredient',name:sugar.name,data:{allergens:['Nuts']},price:{amount:'200',quantity:'1000',unit:'g'}});
  const saved=await api('save',{id:parent.id,revision:parent.revision,document:parent.document,status:'draft'});assert.equal(Number(saved.cost_snapshot.variants[0].total),10);assert.deepEqual(saved.document.detected_allergens,['Dairy']);
  cake.variants[0].components[0].variant_id='missing';await assert.rejects(()=>api('create',{document:cake,status:'draft'}),/component size/);
 })();
 await check('unpublished variation bases and private search terms are hidden from kitchen access',async()=>{
  const source=await api('create',{document:recipe('Private draft base'),status:'draft'});
  const copy=await api('duplicate',{version_id:source.version_id,mode:'variation'});
  await api('save',{id:copy.id,revision:copy.revision,document:copy.document,status:'production'});
  await assert.rejects(()=>api('get',{id:source.id,version_id:source.version_id},customer),/not available/);
  assert.equal((await api('list',{query:'OWNER_PRIVATE'},customer)).total,0);
 })();
 await check('completed production quantities are versioned references without editing formulas',async()=>{
  const before=await api('get',{id:component.id});const run=await api('record_run',{version_id:before.version_id,variant_id:'base',multiplier:'1.5',actual_yield:'35',produced_on:'2026-09-30',notes:'One broken cookie'},staff);
  assert.equal(Number(run.planned_yield),36);assert.equal(Number(run.actual_yield),35);
  assert.equal((await api('runs',{id:component.id},staff)).length,1);assert.deepEqual((await api('get',{id:component.id})).document,before.document);
  await assert.rejects(()=>api('record_run',{version_id:before.version_id,variant_id:'base',multiplier:'1',actual_yield:'24',produced_on:'2026-09-30'},customer),/editor/);
 })();
 await check('uploads require matching metadata and test photos remain private',async()=>{
  const file=await api('reserve_file',{filename:'test.png',mime_type:'image/png',size_bytes:3,sha256:'a'.repeat(64)});
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('recipe-files',$1,$2::jsonb)",[file.path,JSON.stringify({size:2,mimetype:'image/png'})]);
  await assert.rejects(()=>api('confirm_file',{id:file.id}),/size\/type/);
  await db.query("update storage.objects set metadata=$1::jsonb where name=$2",[JSON.stringify({size:3,mimetype:'image/png'}),file.path]);await api('confirm_file',{id:file.id});
  await api('save_test',{recipe_id:cookie.id,version_id:cookie.version_id,data:{photos:[file]},proposed_document:cookie.document});
  const allowed=async(user)=>h.as(user,async()=>(await db.query('select public.recipe_file_access($1,false) allowed',[file.path])).rows[0].allowed);
  assert.equal(await allowed(staff),true);assert.equal(await allowed(customer),false);
 })();
 await check('empty formulas cannot be published',async()=>{
  const doc=recipe('Empty formula');doc.variants[0].groups=[];doc.variants[0].components=[];
  await assert.rejects(()=>api('create',{document:doc,status:'production'}),/Add ingredients/);
 })();
 await check('linked packaging costs and approved snapshots survive supplier price changes',async()=>{
  const box=await api('save_resource',{kind:'packaging',name:'Cake box',data:{default_unit:'pc'},price:{amount:'500',quantity:'10',unit:'pcs'}});
  const doc=recipe('Boxed cake');doc.variants[0].additional_costs=[{id:'box',name:'Packaging',resource_name:box.name,resource_id:box.id,quantity:'2',unit:'pc',amount:'0'}];
  const saved=await api('create',{document:doc,status:'production'});assert.equal(Number(saved.document.variants[0].additional_costs[0].amount),100);
  await api('save_resource',{id:box.id,revision:box.revision,kind:'packaging',name:box.name,data:box.data,price:{amount:'800',quantity:'10',unit:'pcs'}});
  const old=await api('get',{id:saved.id});assert.equal(Number(old.document.variants[0].additional_costs[0].amount),100);
  const preview=await api('cost_preview',{document:saved.document});assert.equal(Number(preview.document.variants[0].additional_costs[0].amount),160);
 })();
 await check('removing a former chef account preserves historical formulas and attribution safely',async()=>{
  await db.query("insert into tlb.staff(user_id,role) values($1,'staff')",[stranger]);await api('save_access',{user_id:stranger,permission:'chef'});
  const saved=await api('create',{document:recipe('Former chef recipe')},stranger);await db.query('delete from tlb.staff where user_id=$1',[stranger]);await db.query('delete from auth.users where id=$1',[stranger]);
  const after=await api('get',{id:saved.id});assert.deepEqual(after.document,saved.document);assert.equal(after.created_by,null);
 })();
 await check('a thousand-recipe library stays paginated and searchable without returning recipe documents',async()=>{
  await db.query("insert into tlb.recipes(id,code,name,created_by) select gen_random_uuid(),'PERF-'||n,'Performance recipe '||lpad(n::text,4,'0'),$1 from generate_series(1,1000) n",[owner]);
  await db.query("insert into tlb.recipe_versions(recipe_id,number,status,document,created_by) select id,1,'draft',jsonb_set($1::jsonb,'{name}',to_jsonb(name)),$2 from tlb.recipes where code like 'PERF-%'",[JSON.stringify(recipe()),owner]);
  await db.exec("update tlb.recipes r set current_version_id=v.id from tlb.recipe_versions v where v.recipe_id=r.id and r.code like 'PERF-%'");
  const started=performance.now(),page=await api('list',{query:'Performance recipe',limit:24,offset:984});assert.equal(page.total,1000);assert.equal(page.rows.length,16);assert.ok(page.rows.every(r=>!('document' in r)));assert.ok(JSON.stringify(page).length<16000);assert.ok(performance.now()-started<5000);
  const match=await api('list',{query:'Performance recipe 0999',limit:24});assert.equal(match.rows.length,1);
 })();
 await check('revoked kitchen access immediately blocks recipe APIs',async()=>{
  await api('save_access',{user_id:customer,permission:null});await assert.rejects(()=>api('get',{id:cookie.id},customer),/Authorized recipe/);
 })();
}
