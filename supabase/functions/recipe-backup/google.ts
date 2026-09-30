import {env} from '../_shared/server.ts';
import {fixedChunks,newArchiveDigest} from '../../../assets/ordering/recipe-archive.js';
export class RecipeBackupError extends Error{constructor(public code:string){super(code);}}
export const errorCode=(error:unknown)=>error instanceof RecipeBackupError?error.code:'network';
const utf8=new TextEncoder();
const base64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const segment=(value:unknown)=>base64(utf8.encode(JSON.stringify(value)));
export function driveId(value:unknown){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{15,150}$/.test(value))throw new RecipeBackupError('configuration');return value;}
export function createRecipeDrive({getEnv=env,request=fetch,now=()=>Date.now()}={}){
 let cached:{token:string,expires:number}|null=null;
 function account(){try{const a=JSON.parse(getEnv('GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON')||getEnv('GA_SERVICE_ACCOUNT_JSON'));if(a.type!=='service_account'||!a.private_key||!a.client_email?.endsWith('.iam.gserviceaccount.com'))throw Error();return a;}catch{throw new RecipeBackupError('configuration');}}
 async function token(){
  if(cached&&cached.expires>now())return cached.token;const a=account(),iat=Math.floor(now()/1000);
  const key=await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(a.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'')),c=>c.charCodeAt(0)),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const unsigned=`${segment({alg:'RS256',typ:'JWT'})}.${segment({iss:a.client_email,scope:'https://www.googleapis.com/auth/drive',aud:'https://oauth2.googleapis.com/token',iat,exp:iat+3600})}`;
  const signature=base64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,utf8.encode(unsigned))));
  const response=await request('https://oauth2.googleapis.com/token',{method:'POST',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${unsigned}.${signature}`}),signal:AbortSignal.timeout(15000)});
  const data=await response.json().catch(()=>null);if(!response.ok||typeof data?.access_token!=='string'||data?.token_type?.toLowerCase()!=='bearer'||!Number.isFinite(data.expires_in)||data.expires_in<=60)throw new RecipeBackupError('access');
  cached={token:data.access_token,expires:now()+(Math.min(3600,data.expires_in)-60)*1000};return cached.token;
 }
 function fail(response:Response){if(response.status===401)cached=null;throw new RecipeBackupError(response.status===429?'quota':[401,403,404].includes(response.status)?'access':'network');}
 async function call(url:string,init:RequestInit={}){return request(url,{...init,redirect:'error',headers:{...Object.fromEntries(new Headers(init.headers)),Authorization:`Bearer ${await token()}`},signal:init.signal||AbortSignal.timeout(30000)});}
 async function metadata(id:string){const response=await call(`https://www.googleapis.com/drive/v3/files/${driveId(id)}?fields=id,name,size,mimeType,sha256Checksum,trashed,parents,capabilities(canEdit),permissions(type,role,emailAddress)`);if(!response.ok)fail(response);return response.json();}
 function privateFile(meta:any){if(meta.trashed||meta.mimeType!=='application/zip'||meta.capabilities?.canEdit!==true||!Array.isArray(meta.permissions)||meta.permissions.some((p:any)=>['anyone','domain'].includes(p.type)))throw new RecipeBackupError('access');}
 return {
  info(){try{const a=account();return {configured:true,service_account_email:a.client_email};}catch{return {configured:false};}},
  async verify(id:string){const meta=await metadata(id);privateFile(meta);return meta;},
  async read(id:string,signal:AbortSignal){const response=await call(`https://www.googleapis.com/drive/v3/files/${driveId(id)}?alt=media`,{signal});if(!response.ok||!response.body)fail(response);return response.body!;},
  async upload(id:string,source:AsyncIterable<Uint8Array>|ReadableStream<Uint8Array>,name:string,signal=AbortSignal.timeout(350000)){
   privateFile(await metadata(id));
   const start=await call(`https://www.googleapis.com/upload/drive/v3/files/${driveId(id)}?uploadType=resumable&fields=id,size,sha256Checksum`,{method:'PATCH',headers:{'Content-Type':'application/json','X-Upload-Content-Type':'application/zip'},body:JSON.stringify({mimeType:'application/zip'}),signal});
   if(!start.ok)fail(start);let url:URL;try{url=new URL(start.headers.get('location')||'');}catch{throw new RecipeBackupError('network');}
   if(url.origin!=='https://www.googleapis.com'||!url.pathname.startsWith('/upload/drive/v3/files/'))throw new RecipeBackupError('network');
   const iterator=fixedChunks(source)[Symbol.asyncIterator](),hash=await newArchiveDigest();let current=await iterator.next(),offset=0,metadataResult:any=null;
   try{
    while(!current.done){
     const next=await iterator.next(),chunk=current.value,last=next.done,total=last?offset+chunk.length:null;let accepted=offset,complete=false;
     hash.update(chunk);
     for(let attempt=0;attempt<5&&!complete;attempt++){
      let response:Response;
      try{response=await call(url.href,{method:'PUT',headers:{'Content-Type':'application/zip','Content-Range':accepted===offset+chunk.length?`bytes */${total??'*'}`:`bytes ${accepted}-${offset+chunk.length-1}/${total??'*'}`},body:chunk.subarray(accepted-offset),signal:AbortSignal.any([signal,AbortSignal.timeout(45000)])});}
      catch(error){if(signal.aborted)throw error;response=await call(url.href,{method:'PUT',headers:{'Content-Range':`bytes */${total??'*'}`},body:new Uint8Array(),signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});}
      if(response.ok){if(!last)throw new RecipeBackupError('network');metadataResult=await response.json();complete=true;}
      else if(response.status===308){
       const range=response.headers.get('range'),match=range?.match(/^bytes=0-(\d+)$/),end=match?Number(match[1])+1:0;
       if(end<offset||end>offset+chunk.length)throw new RecipeBackupError('network');accepted=end;complete=accepted===offset+chunk.length&&!last;
      }else if(response.status>=500||response.status===429){
       const probe=await call(url.href,{method:'PUT',headers:{'Content-Range':`bytes */${total??'*'}`},body:new Uint8Array(),signal});
       if(probe.ok&&last){metadataResult=await probe.json();complete=true;}else if(probe.status===308){const match=probe.headers.get('range')?.match(/^bytes=0-(\d+)$/);accepted=match?Number(match[1])+1:0;if(accepted<offset||accepted>offset+chunk.length)throw new RecipeBackupError('network');complete=accepted===offset+chunk.length&&!last;}else fail(probe);
      }else fail(response);
     }
     if(!complete)throw new RecipeBackupError('network');offset+=chunk.length;current=next;
    }
   }finally{if(!current.done)await iterator.return?.();}
   const sha256=hash.digest('hex');
   if(metadataResult?.id!==id||Number(metadataResult?.size)!==offset||metadataResult?.sha256Checksum!==sha256)throw new RecipeBackupError('checksum');
   const rename=await call(`https://www.googleapis.com/drive/v3/files/${id}?fields=id`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name.slice(0,180)}),signal});if(!rename.ok)fail(rename);
   return {sha256,size_bytes:offset,drive_verified:true};
  }
 };
}
