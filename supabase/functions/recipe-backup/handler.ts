import {credentials,endpoint,HttpError,json,readJson,verifiedUser} from '../_shared/server.ts';
import {createRecipeDrive,errorCode,RecipeBackupError} from './google.ts';
import {buildRecipeArchive} from './archive.ts';
import {newArchiveDigest} from '../../../assets/ordering/recipe-archive.js';
const google=createRecipeDrive();
async function rpc(name:string,body:any){const {url,key}=credentials();const response=await fetch(`${url}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});const data=await response.json().catch(()=>null);if(!response.ok)throw new HttpError(data?.code==='42501'?403:503,'Recipe backup access could not be completed.');return data;}
const service=(action:string,payload:Record<string,unknown>={})=>rpc('recipe_backup_service',{p_action:action,p_payload:payload});
export async function runRecipeBackup(start:any,client=google,dispatch=service,archive=buildRecipeArchive){
 const context={job_id:start.job_id,lease_token:start.lease_token},signal=AbortSignal.timeout(350000);
 try{
  const source=start.kind==='monthly'?await client.read(start.source_file_id,signal):archive(start,dispatch,undefined,signal);
  const stamp=new Date(start.generated_at).toISOString().replace(/[:.]/g,'-');
  const result=await client.upload(start.drive_file_id,source,`TLBK-${start.kind}-${stamp}.zip`,signal);
  if(start.kind==='monthly'&&(result.sha256!==start.source_sha256||result.size_bytes!==start.source_bytes))throw new RecipeBackupError('checksum');
  await dispatch('finish',{...context,...result});return {ok:true};
 }catch(error){await dispatch('finish',{...context,error:errorCode(error)});return {ok:false,error:errorCode(error)};}
}
function background(task:Promise<unknown>){
 const runtime=(globalThis as any).EdgeRuntime;
 if(!runtime?.waitUntil)throw new HttpError(503,'Background backup runtime is unavailable.');
 runtime.waitUntil(task.catch(()=>{}));
}
export const handle=endpoint(async(request,headers)=>{
 const token=request.headers.get('x-worker-token');let input:any={},user_id:string|undefined;
 if(token!==null){
  if(!/^[a-f0-9]{64}$/.test(token)||await rpc('tlb_recipe_backup_worker_authorized',{p_token:token})!==true)throw new HttpError(401,'Recipe backup worker authorization required.');
  input.action='sync';
 }else{
  user_id=await verifiedUser(request,true);const access=await service('owner_access',{user_id});if(access?.allowed!==true)throw new HttpError(403,'Owner access required.');
  input=await readJson(request);
  if(input.action==='info')return json({...google.info(),connection:access.connection},200,headers);
  if(input.action==='connect'){
   if(input.folder_id!=='1rRxDTqAVqliCdx0OTRJK0XuLC4iHQyeg'||!Array.isArray(input.slots)||input.slots.length>100)throw new HttpError(400,'Choose the dedicated recipe backup folder and its archive files.');
   for(const slot of input.slots)await google.verify(slot.drive_file_id);
   await service('connect',{folder_id:input.folder_id,slots:input.slots});input.action='sync';
  }
 }
 const info=google.info();if(info.configured)await service('identify',{email:info.service_account_email});
 if(input.action==='sync'){
  const start=await service('begin',user_id?{kind:'manual',user_id}:{});if(start.skipped)return json(start,200,headers);
  background(runRecipeBackup(start));return json({started:true,job_id:start.job_id},202,headers);
 }
 if(input.action==='download'){
  const start=await service('begin',{kind:'download',user_id});if(start.skipped)throw new HttpError(409,'Another backup is running. Download the latest Drive archive or wait for it to finish.');
  const context={job_id:start.job_id,lease_token:start.lease_token},iterator=buildRecipeArchive(start,service)[Symbol.asyncIterator](),hash=await newArchiveDigest();let length=0,finished=false;
  const stream=new ReadableStream<Uint8Array>({
   async pull(controller){try{const part=await iterator.next();if(part.done){finished=true;await service('finish',{...context,sha256:hash.digest('hex'),size_bytes:length});controller.close();}else{hash.update(part.value);length+=part.value.length;controller.enqueue(part.value);}}catch(error){await service('finish',{...context,error:errorCode(error)}).catch(()=>{});controller.error(error);}},
   async cancel(){if(!finished){await iterator.return?.();await service('finish',{...context,error:'interrupted'}).catch(()=>{});}}
  });headers.set('Content-Type','application/zip');headers.set('Content-Disposition','attachment; filename="TLBK-recipes-and-costing.zip"');return new Response(stream,{status:200,headers});
 }
 throw new HttpError(400,'Choose a recipe backup action.');
});
