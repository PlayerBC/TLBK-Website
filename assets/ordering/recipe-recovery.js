import {safeArchivePath,validateRecipeManifest,newDigest,finishDigest} from './recipe-archive.js';
const decoder=new TextDecoder('utf-8',{fatal:true});
async function view(blob,offset,length){if(offset<0||offset+length>blob.size)throw Error('Archive is truncated.');return new DataView(await blob.slice(offset,offset+length).arrayBuffer());}
async function zipDirectory(blob){
 if(blob.size<22)throw Error('Archive is too short.');const tail=await view(blob,Math.max(0,blob.size-65557),Math.min(blob.size,65557));let end=-1;
 for(let i=tail.byteLength-22;i>=0;i--)if(tail.getUint32(i,true)===0x06054b50&&i+22+tail.getUint16(i+20,true)===tail.byteLength){end=i;break;}
 if(end<0)throw Error('ZIP directory not found.');
 if(tail.getUint16(end+4,true)!==0||tail.getUint16(end+6,true)!==0)throw Error('Multi-part ZIP files are not supported.');
 const count=tail.getUint16(end+10,true),size=tail.getUint32(end+12,true),offset=tail.getUint32(end+16,true);
 if(count===65535||offset===0xffffffff||size===0xffffffff)throw Error('ZIP64 archives are not supported by this checker.');
 const central=await view(blob,offset,size),entries=new Map();let pos=0;
 for(let i=0;i<count;i++){
  if(pos+46>central.byteLength||central.getUint32(pos,true)!==0x02014b50)throw Error('Invalid ZIP directory entry.');
  const flags=central.getUint16(pos+8,true),compression=central.getUint16(pos+10,true),compressed=central.getUint32(pos+20,true),length=central.getUint32(pos+24,true),nameLength=central.getUint16(pos+28,true),extraLength=central.getUint16(pos+30,true),commentLength=central.getUint16(pos+32,true),localOffset=central.getUint32(pos+42,true);
  if(flags&1||compression!==0||compressed!==length)throw Error('Use an unmodified TLB recovery ZIP with stored entries.');
  if(pos+46+nameLength+extraLength+commentLength>central.byteLength)throw Error('Invalid ZIP entry length.');
  const name=safeArchivePath(decoder.decode(new Uint8Array(central.buffer,central.byteOffset+pos+46,nameLength)));
  if(entries.has(name))throw Error('Duplicate archive entry.');
  const local=await view(blob,localOffset,30),localNameLength=local.getUint16(26,true),localExtraLength=local.getUint16(28,true);
  if(local.getUint32(0,true)!==0x04034b50)throw Error('Invalid local ZIP header.');
  const localName=decoder.decode(await blob.slice(localOffset+30,localOffset+30+localNameLength).arrayBuffer());if(localName!==name)throw Error('ZIP filename mismatch.');
  const dataOffset=localOffset+30+localNameLength+localExtraLength;if(dataOffset+length>offset)throw Error('ZIP entry overlaps its directory.');
  entries.set(name,{name,size_bytes:length,blob:blob.slice(dataOffset,dataOffset+length)});pos+=46+nameLength+extraLength+commentLength;
 }
 if(pos!==central.byteLength)throw Error('Unexpected ZIP directory data.');return entries;
}
async function hashBlob(blob){const hash=newDigest();for await(const bytes of blob.stream())hash.update(bytes);return finishDigest(hash);}
export async function readRecipeArchive(blob){
 const entries=await zipDirectory(blob),manifestEntry=entries.get('manifest.json');if(!manifestEntry||manifestEntry.size_bytes>20*1024*1024)throw Error('Recovery manifest missing or too large.');
 const manifest=validateRecipeManifest(JSON.parse(await manifestEntry.blob.text()));
 if(entries.size!==manifest.entries.length+1)throw Error('The archive contains unlisted or missing files.');
 for(const expected of manifest.entries){const actual=entries.get(expected.path);if(!actual||actual.size_bytes!==expected.size_bytes||await hashBlob(actual.blob)!==expected.sha256)throw Error(`Checksum or size mismatch: ${expected.path}`);}
 const tables={};for(const name of manifest.tables){const entry=entries.get(`Database Exports/${name}.json`);if(!entry)throw Error(`Missing recovery table: ${name}`);const rows=JSON.parse(await entry.blob.text());if(!Array.isArray(rows))throw Error(`Invalid recovery table: ${name}`);tables[name]=rows;}
 validateRecipeRelationships(tables,manifest);
 return {manifest,tables,files:manifest.files.map(file=>({...file,blob:entries.get(file.archive_path).blob}))};
}
export function validateRecipeRelationships(tables,manifest){
 const maps={};for(const [name,rows] of Object.entries(tables)){
  if(!Array.isArray(rows))throw Error(`Invalid ${name} table.`);const map=new Map();for(const row of rows){if(row.id!=null){if(map.has(String(row.id)))throw Error(`Duplicate ID in ${name}.`);map.set(String(row.id),row);}}maps[name]=map;
 }
 const ref=(table,id,optional=false)=>{if(optional&&id==null)return null;const row=maps[table]?.get(String(id));if(!row)throw Error(`Broken ${table} reference: ${id}`);return row;};
 for(const r of tables.recipe_categories)ref('recipe_categories',r.parent_id,true);
 for(const r of tables.recipes){ref('recipe_categories',r.category_id,true);for(const id of [r.current_version_id,r.production_version_id])if(id&&ref('recipe_versions',id).recipe_id!==r.id)throw Error('Recipe points to another recipe’s version.');}
 for(const r of tables.recipe_versions)ref('recipes',r.recipe_id);
 for(const r of tables.recipe_links){ref('recipe_versions',r.version_id);ref('recipe_versions',r.target_version_id);}
 for(const r of tables.recipe_ingredient_links){ref('recipe_versions',r.version_id);if(ref('recipe_resources',r.resource_id).kind!=='ingredient')throw Error('Ingredient link has the wrong resource type.');}
 for(const r of tables.recipe_prices){ref('recipe_resources',r.resource_id);if(r.supplier_id&&ref('recipe_resources',r.supplier_id).kind!=='supplier')throw Error('Price supplier has the wrong resource type.');}
 for(const r of tables.recipe_supplier_items){ref('recipe_resources',r.resource_id);if(ref('recipe_resources',r.supplier_id).kind!=='supplier')throw Error('Supplier link has the wrong type.');}
 for(const r of tables.recipe_tests){ref('recipes',r.recipe_id);if(ref('recipe_versions',r.version_id).recipe_id!==r.recipe_id)throw Error('Testing log points to another recipe.');ref('recipe_versions',r.promoted_version_id,true);}
 for(const r of tables.recipe_runs||[]){if(ref('recipe_versions',r.version_id).recipe_id!==r.recipe_id)throw Error('Production log points to another recipe.');}
 for(const r of tables.recipe_file_links){ref('recipe_files',r.file_id);ref('recipe_versions',r.version_id,true);ref('recipe_tests',r.test_id,true);}
 for(const r of tables.recipe_user_state)ref('recipes',r.recipe_id);
 for(const r of tables.recipe_drafts)ref('recipes',r.recipe_id,true);
 const files=new Map(manifest.files.map(f=>[f.id,f]));
 for(const r of tables.recipe_files)if(r.uploaded){const file=files.get(r.id);if(!file||file.source_path!==r.path||file.sha256!==r.sha256||file.size_bytes!==r.size_bytes)throw Error('An uploaded file does not match the database metadata.');}
 if(files.size!==tables.recipe_files.filter(f=>f.uploaded).length)throw Error('Unexpected backup file count.');
 const actualCount=Object.values(tables).reduce((total,rows)=>total+rows.length,0);if(actualCount!==manifest.record_count)throw Error('Backup record count does not match the manifest.');return true;
}
