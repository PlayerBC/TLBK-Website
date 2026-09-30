// Deliberately rehearses only in a new in-memory database. This script has no
// production database connection or credential parameter.
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {readRecipeArchive} from '../assets/ordering/recipe-recovery.js';
const root=resolve(import.meta.dirname,'..');
export async function rehearseRecipeRestore(archive,{db,applySchema=true}={}){
 const backup=archive instanceof Blob?await readRecipeArchive(archive):archive;
 if(!db)throw Error('Supply a new isolated database for restoration.');
 if(applySchema){await db.exec(await readFile(join(root,'tests/backend/bootstrap.sql'),'utf8'));for(const name of(await readdir(join(root,'supabase/migrations'))).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(join(root,'supabase/migrations',name),'utf8'));}
 const count=(await db.query('select (select count(*) from tlb.recipes)+(select count(*) from tlb.recipe_resources)+(select count(*) from tlb.recipe_versions) n')).rows[0].n;
 if(Number(count)!==0)throw Error('Restore rehearsal requires an empty recipe database.');
 const {tables}=backup;
 await db.exec('begin; set constraints all deferred; delete from tlb.recipe_categories; delete from tlb.recipe_settings;');
 try{
  for(const actor of tables.actors)await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now()) on conflict(id) do nothing',[actor.id,actor.email]);
  const actors=new Set(tables.actors.map(a=>a.id));
  for(const rows of Object.values(tables))for(const row of rows)for(const key of ['created_by','updated_by','actor','user_id','granted_by'])if(row[key]&&!actors.has(row[key]))throw Error(`Actor ${row[key]} is not present in the recovery map.`);
  for(const actor of tables.actors)if(['owner','staff'].includes(actor.role))await db.query('insert into tlb.staff(user_id,role) values($1,$2) on conflict(user_id) do nothing',[actor.id,actor.role]);
  for(const permission of tables.recipe_access)await db.query("insert into tlb.staff(user_id,role) values($1,'staff') on conflict(user_id) do nothing",[permission.user_id]);
  const order=['recipe_settings','recipe_categories','recipe_resources','recipe_supplier_items','recipe_prices','recipes','recipe_versions','recipe_links','recipe_ingredient_links','recipe_tests','recipe_runs','recipe_files','recipe_file_links','recipe_user_state','recipe_drafts','recipe_audit','recipe_access'];
  const counts={};
  for(const table of order){
   const columns=(await db.query("select column_name from information_schema.columns where table_schema='tlb' and table_name=$1 and is_generated='NEVER' order by ordinal_position",[table])).rows.map(r=>r.column_name);
   const names=columns.map(c=>`"${c}"`).join(',');
   let rows=tables[table];
   if(table==='recipe_categories'){
    const pending=[...rows],sorted=[],done=new Set();while(pending.length){const index=pending.findIndex(r=>!r.parent_id||done.has(r.parent_id));if(index<0)throw Error('Category hierarchy has a cycle.');const [row]=pending.splice(index,1);sorted.push(row);done.add(row.id);}rows=sorted;
   }
   for(const row of rows)await db.query(`insert into tlb.${table} (${names}) overriding system value select ${names} from jsonb_populate_record(null::tlb.${table},$1::jsonb)`,[JSON.stringify(row)]);
   counts[table]=Number((await db.query(`select count(*) n from tlb.${table}`)).rows[0].n);if(counts[table]!==rows.length)throw Error(`Restored count mismatch: ${table}`);
  }
  for(const file of backup.files)await db.query("insert into storage.objects(bucket_id,name,metadata) values('recipe-files',$1,$2::jsonb)",[file.source_path,JSON.stringify({size:file.size_bytes,mimetype:file.mime_type,sha256:file.sha256})]);
  // Restored identity values do not advance their sequence automatically.
  // The next legitimate edit must be able to append an audit event.
  await db.exec("select setval(pg_get_serial_sequence('tlb.recipe_audit','id'),coalesce((select max(id) from tlb.recipe_audit),1),exists(select 1 from tlb.recipe_audit))");
  // Compare the complete restored JSON, not just counts. Generated search fields
  // are derived from the document and therefore excluded from the comparison.
  for(const table of order){const restored=(await db.query(`select to_jsonb(t)${table==='recipe_versions'?"-'search_text'-'kitchen_search'":''} row from tlb.${table} t`)).rows.map(r=>r.row);
   const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,sorted(value[k])])):value;
   const canonical=value=>JSON.stringify(sorted(value));const before=tables[table].map(canonical).sort(),after=restored.map(canonical).sort();if(JSON.stringify(before)!==JSON.stringify(after))throw Error(`Restored values differ: ${table}`);
  }
  await db.exec('commit');return {format:'tlb-recipe-restore-rehearsal',verified_at:new Date().toISOString(),record_count:backup.manifest.record_count,files:backup.files.length,counts,relationships:true,checksums:true,production_modified:false};
 }catch(error){await db.exec('rollback');throw error;}
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const path=process.argv[2];if(!path)throw Error('Usage: node scripts/restore-recipe-backup.mjs ARCHIVE.zip [REPORT.json]');
 const require=createRequire(process.env.PGLITE_PACKAGE_ROOT?join(resolve(process.env.PGLITE_PACKAGE_ROOT),'package.json'):import.meta.url);
 const {PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
 const backup=await readRecipeArchive(new Blob([await readFile(resolve(path))])),db=new PGlite({extensions:{pgcrypto}});
 try{const result=await rehearseRecipeRestore(backup,{db});if(process.argv[3])await writeFile(resolve(process.argv[3]),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));}finally{await db.close();}
}
