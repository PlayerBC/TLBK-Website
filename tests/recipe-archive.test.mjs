import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {crc32} from 'node:zlib';
import {recipeZip,fixedChunks,digestBytes,safeArchivePath,newArchiveDigest,nativeDigest} from '../assets/ordering/recipe-archive.js';
const collect=async iterable=>{const parts=[];for await(const p of iterable)parts.push(p);return Buffer.concat(parts);};
test('streamed SHA-256 agrees with the platform implementation',()=>{
 for(const length of [0,1,63,64,65,4096,100000]){const data=Uint8Array.from({length},(_,i)=>i%251);assert.equal(digestBytes(data),createHash('sha256').update(data).digest('hex'));}
});
test('accelerated archive hashes preserve exact results across concurrent streams and chunk boundaries',async()=>{
 const a=await newArchiveDigest(),b=await newArchiveDigest();
 const bytes=Uint8Array.from({length:5*1024*1024+3},(_,i)=>i%251);
 for(let i=0;i<bytes.length;i+=333333){a.update(bytes.subarray(i,i+333333));b.update(bytes.subarray(i,i+333333));}
 const expected=createHash('sha256').update(bytes).digest('hex');
 assert.equal(a.digest('hex'),expected);assert.equal(b.digest('hex'),expected);assert.equal(await nativeDigest(bytes),expected);
});
test('streaming ZIP writes correct headers, descriptors and central directory without buffering the archive',async()=>{
 const records=[],input=[{path:'Database Exports/recipes.json',bytes:'[{"id":"one"}]'},{path:'Files/example.txt',stream:(async function*(){yield new TextEncoder().encode('hello');yield new TextEncoder().encode(' world');})()}];
 const archive=await collect(recipeZip(input,{onEntry:r=>records.push(r),timestamp:new Date('2026-09-30T00:00:00Z')}));
 assert.equal(archive.readUInt32LE(0),0x04034b50);assert.equal(archive.readUInt16LE(6),0x808);
 assert.equal(archive.readUInt32LE(archive.length-22),0x06054b50);assert.equal(archive.readUInt16LE(archive.length-12),2);
 const central=archive.readUInt32LE(archive.length-6);assert.equal(archive.readUInt32LE(central),0x02014b50);
 assert.equal(records[1].size_bytes,11);assert.equal(records[1].sha256,createHash('sha256').update('hello world').digest('hex'));
 assert.equal(archive.readUInt32LE(central+16),crc32(Buffer.from('[{"id":"one"}]')));
});
test('chunking preserves arbitrary source boundaries',async()=>{
 async function* source(){yield new Uint8Array([1]);yield new Uint8Array([2,3,4,5,6,7]);yield new Uint8Array([8]);}
 const result=[];for await(const c of fixedChunks(source(),3))result.push([...c]);assert.deepEqual(result,[[1,2,3],[4,5,6],[7,8]]);
});
test('archives reject traversal, absolute paths and duplicate names',async()=>{
 for(const path of ['../x','/x','C:/x','a\\x','a/../x','a//b','a\0b'])assert.throws(()=>safeArchivePath(path));
 await assert.rejects(()=>collect(recipeZip([{path:'x',bytes:'one'},{path:'x',bytes:'two'}])),/Duplicate/);
});
