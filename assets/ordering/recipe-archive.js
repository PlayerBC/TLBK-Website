import {sha256} from './vendor/noble-hashes-2.4.0/sha2.js';
import {bytesToHex} from './vendor/noble-hashes-2.4.0/utils.js';
import {createSHA256,createCRC32} from './vendor/hash-wasm-4.12.0/dist/index.esm.js';
const encoder=new TextEncoder();
export const digestBytes=bytes=>bytesToHex(sha256(bytes));
export const newDigest=()=>sha256.create();
export const finishDigest=hash=>bytesToHex(hash.digest());
// Native/WASM hashing keeps large photo archives within a much smaller CPU budget.
// Each stream owns its instances; concurrent downloads never share hash state.
export const newArchiveDigest=()=>createSHA256();
export async function nativeDigest(bytes){return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));}
export function safeArchivePath(path){
 if(typeof path!=='string'||!path||path.length>500||/[\u0000-\u001f\\:]/.test(path)||path.startsWith('/')||path.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Unsafe archive path.');return path;
}
function block(size){const bytes=new Uint8Array(size);return {bytes,view:new DataView(bytes.buffer)};}
async function* chunks(value){
 if(typeof value==='string'){yield encoder.encode(value);return;}
 if(value instanceof Uint8Array){yield value;return;}
 for await(const part of value){if(!(part instanceof Uint8Array))throw Error('Archive stream must contain bytes.');yield part;}
}
// ZIP data descriptors permit streaming unknown-length JSON tables and files.
// Memory usage is bounded by a database page / one file, not the complete ZIP.
export async function* recipeZip(entries,{onEntry=()=>{},timestamp=new Date()}={}){
 let offset=0;const directory=[],paths=new Set();const year=Math.max(1980,Math.min(2107,timestamp.getUTCFullYear()));
 const dosDate=((year-1980)<<9)|((timestamp.getUTCMonth()+1)<<5)|timestamp.getUTCDate(),dosTime=(timestamp.getUTCHours()<<11)|(timestamp.getUTCMinutes()<<5)|Math.floor(timestamp.getUTCSeconds()/2);
 for await(const entry of entries){
  const path=safeArchivePath(entry.path);if(paths.has(path))throw Error('Duplicate archive path.');paths.add(path);
  if(paths.size>=65535)throw Error('Archive exceeds ZIP entry limit.');const name=encoder.encode(path),start=offset;
  const h=block(30+name.length);h.view.setUint32(0,0x04034b50,true);h.view.setUint16(4,20,true);h.view.setUint16(6,0x0808,true);h.view.setUint16(10,dosTime,true);h.view.setUint16(12,dosDate,true);h.view.setUint16(26,name.length,true);h.bytes.set(name,30);yield h.bytes;offset+=h.bytes.length;
  let size=0;const hash=await newArchiveDigest(),checksum=await createCRC32();
  for await(const bytes of chunks(entry.bytes??entry.stream)){
   if(size+bytes.length>0xffffffff||offset+bytes.length>0xffffffff)throw Error('Archive exceeds the 4 GiB ZIP limit.');
   checksum.update(bytes);hash.update(bytes);size+=bytes.length;offset+=bytes.length;yield bytes;
  }
  const crc=parseInt(checksum.digest('hex'),16);const descriptor=block(16);descriptor.view.setUint32(0,0x08074b50,true);descriptor.view.setUint32(4,crc,true);descriptor.view.setUint32(8,size,true);descriptor.view.setUint32(12,size,true);yield descriptor.bytes;offset+=16;
  const central=block(46+name.length);central.view.setUint32(0,0x02014b50,true);central.view.setUint16(4,20,true);central.view.setUint16(6,20,true);central.view.setUint16(8,0x0808,true);central.view.setUint16(12,dosTime,true);central.view.setUint16(14,dosDate,true);central.view.setUint32(16,crc,true);central.view.setUint32(20,size,true);central.view.setUint32(24,size,true);central.view.setUint16(28,name.length,true);central.view.setUint32(42,start,true);central.bytes.set(name,46);directory.push(central.bytes);
  await onEntry({path,size_bytes:size,sha256:hash.digest('hex')});
 }
 const directoryOffset=offset;for(const entry of directory){yield entry;offset+=entry.length;}
 if(offset+22>0xffffffff)throw Error('Archive exceeds the 4 GiB ZIP limit.');
 const end=block(22);end.view.setUint32(0,0x06054b50,true);end.view.setUint16(8,directory.length,true);end.view.setUint16(10,directory.length,true);end.view.setUint32(12,offset-directoryOffset,true);end.view.setUint32(16,directoryOffset,true);yield end.bytes;
}
export async function* fixedChunks(source,size=4*1024*1024){
 if(!Number.isInteger(size)||size<1)throw Error('Invalid chunk size.');let buffer=new Uint8Array(size),used=0;
 for await(const part of source){let pos=0;while(pos<part.length){const take=Math.min(size-used,part.length-pos);buffer.set(part.subarray(pos,pos+take),used);used+=take;pos+=take;if(used===size){yield buffer;buffer=new Uint8Array(size);used=0;}}}
 if(used)yield buffer.subarray(0,used);
}
export const RECIPE_BACKUP_TABLES=['recipe_settings','recipe_categories','recipe_resources','recipe_supplier_items','recipe_prices','recipes','recipe_versions','recipe_links','recipe_ingredient_links','recipe_tests','recipe_runs','recipe_files','recipe_file_links','recipe_user_state','recipe_drafts','recipe_audit','recipe_access','actors'];
export const RECIPE_STAFF_BACKUP_TABLES=['recipe_staff_defaults','recipe_staff_controls','recipe_staff_dates','recipe_staff_overrides','recipe_staff_batches','recipe_staff_events'];
export const RECIPE_ESSENTIAL_BACKUP_TABLES=['recipe_settings','recipe_categories','recipe_resources','recipe_supplier_items','recipe_prices','recipes','recipe_versions','recipe_links','recipe_ingredient_links','recipe_files','recipe_file_links','actors'];
export function validateRecipeManifest(manifest){
 if(manifest?.format!=='tlb-recipe-backup'||manifest.version!==1||![1,2,3,4,5].includes(manifest.schema_version)||!Array.isArray(manifest.entries)||!Array.isArray(manifest.tables))throw Error('Unsupported recipe backup format or schema version.');
 const paths=new Set();for(const entry of manifest.entries){safeArchivePath(entry.path);if(paths.has(entry.path)||!/^[a-f0-9]{64}$/.test(entry.sha256)||!Number.isSafeInteger(entry.size_bytes)||entry.size_bytes<0)throw Error('Invalid archive manifest entry.');paths.add(entry.path);}
 const essentials=manifest.schema_version===4||manifest.schema_version===5;
 if(essentials&&(manifest.scope!=='essentials'||manifest.tables.some(name=>!RECIPE_ESSENTIAL_BACKUP_TABLES.includes(name))))throw Error('Invalid essential backup scope.');
 if(manifest.schema_version===5&&(manifest.recipe_scope!=='final'||!manifest.features?.includes('final_recipes')))throw Error('Invalid Final recipe backup scope.');
 const staff=!essentials&&(manifest.schema_version>=3||manifest.features?.includes('staff_access')||manifest.tables.some(name=>RECIPE_STAFF_BACKUP_TABLES.includes(name)));
 for(const name of essentials?RECIPE_ESSENTIAL_BACKUP_TABLES:[...RECIPE_BACKUP_TABLES,...(manifest.schema_version>=2?['recipe_invitations']:[]),...(staff?RECIPE_STAFF_BACKUP_TABLES:[])])if(!manifest.tables.includes(name)||!paths.has(`Database Exports/${name}.json`))throw Error(`Backup is missing ${name}.`);
 if(!Array.isArray(manifest.files))throw Error('Backup file manifest is missing.');
 for(const file of manifest.files)if(!paths.has(file.archive_path)||!file.id||!file.source_path)throw Error('Backup contains an incomplete file reference.');return manifest;
}
