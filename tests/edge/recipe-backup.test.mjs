import test from 'node:test';import assert from 'node:assert/strict';import {generateKeyPairSync,createHash} from 'node:crypto';
import {createRecipeDrive} from '../../supabase/functions/recipe-backup/google.ts';
import {handle} from '../../supabase/functions/recipe-backup/handler.ts';
const key=generateKeyPairSync('rsa',{modulusLength:2048}),secret=JSON.stringify({type:'service_account',client_email:'test@fixture.iam.gserviceaccount.com',private_key:key.privateKey.export({type:'pkcs8',format:'pem'})});
const fileId='fixture_archive_1234567890';
function driveFixture({mismatch=false,publicFile=false,interrupt=false,partial=false,badLocation=false}={}){
 let received=new Uint8Array(),tokens=0,interrupted=false,partialUsed=false,renamed=false;
 const request=async(url,options)=>{
  if(url==='https://oauth2.googleapis.com/token'){tokens++;return Response.json({access_token:'fixture',token_type:'Bearer',expires_in:3600});}
  if(url.includes('/drive/v3/files/')&&!url.includes('/upload/')&&(!options.method||options.method==='GET'))return Response.json({id:fileId,mimeType:'application/zip',trashed:false,capabilities:{canEdit:true},permissions:[{type:publicFile?'anyone':'user',role:'writer'}]});
  if(options.method==='PATCH'&&url.includes('/upload/'))return new Response(null,{headers:{location:badLocation?'https://evil.test/steal':`https://www.googleapis.com/upload/drive/v3/files/${fileId}?upload_id=fixture`}});
  if(options.method==='PATCH'){renamed=true;return Response.json({id:fileId});}
  const range=new Headers(options.headers).get('Content-Range');
  if(range.startsWith('bytes */'))return new Response(null,{status:308,headers:received.length?{Range:`bytes=0-${received.length-1}`}:{}});
  const match=range.match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/);assert.ok(match);const start=Number(match[1]),end=Number(match[2]);assert.equal(start,received.length);assert.equal(options.body.length,end-start+1);
  let bytes=options.body;
  if(partial&&!partialUsed&&bytes.length>1000){partialUsed=true;bytes=bytes.subarray(0,Math.floor(bytes.length/2));}
  const copy=new Uint8Array(received.length+bytes.length);copy.set(received);copy.set(bytes,received.length);received=copy;
  if(interrupt&&!interrupted&&match[3]==='*'){interrupted=true;throw Error('Connection lost after server accepted chunk');}
  if(match[3]!=='*'&&received.length===Number(match[3]))return Response.json({id:fileId,size:received.length,sha256Checksum:mismatch?'bad':createHash('sha256').update(received).digest('hex')});
  return new Response(null,{status:308,headers:{Range:`bytes=0-${received.length-1}`}});
 };
 return {client:createRecipeDrive({getEnv:()=>secret,request}),result:()=>({received,tokens,renamed})};
}
async function* bytesSource(size){for(let offset=0;offset<size;offset+=333333)yield Uint8Array.from({length:Math.min(333333,size-offset)},(_,i)=>(offset+i)%251);}
test('Drive streaming upload handles chunk boundaries, partial acknowledgments and network retry',async()=>{
 for(const options of [{},{partial:true},{interrupt:true}]){
  const fixture=driveFixture(options),size=8*1024*1024+37,result=await fixture.client.upload(fileId,bytesSource(size),'TLBK-test.zip');
  assert.equal(result.size_bytes,size);assert.equal(result.drive_verified,true);assert.equal(result.sha256,createHash('sha256').update(fixture.result().received).digest('hex'));assert.equal(fixture.result().tokens,1);assert.equal(fixture.result().renamed,true);
 }
});
test('Drive success requires matching checksum and a private editable archive',async()=>{
 await assert.rejects(()=>driveFixture({mismatch:true}).client.upload(fileId,bytesSource(100),'x.zip'),/checksum/);
 await assert.rejects(()=>driveFixture({publicFile:true}).client.upload(fileId,bytesSource(100),'x.zip'),/access/);
 await assert.rejects(()=>driveFixture({badLocation:true}).client.upload(fileId,bytesSource(100),'x.zip'),/network/);
});
test('backup worker rejects missing and malformed authorization before doing work',async()=>{
 globalThis.Deno={env:{get:()=>''}};
 assert.equal((await handle(new Request('https://example.test',{method:'POST',body:'{}'}))).status,401);
 assert.equal((await handle(new Request('https://example.test',{method:'POST',headers:{'x-worker-token':'wrong'},body:'{}'}))).status,401);
});
