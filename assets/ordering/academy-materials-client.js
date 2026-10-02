import {ready,auth} from './client.js?v=approved-20261002-1';
import {config} from './config.js';
const bucket='academy-class-materials';
async function request(path,options={}){
 await ready;const {data}=await auth.getSession();if(!data.session)throw new Error('Sign in to access class materials.');
 const response=await fetch(`${config.supabaseUrl.replace(/\/$/,'')}/storage/v1/${path}`,{...options,headers:{apikey:config.supabasePublishableKey,Authorization:`Bearer ${data.session.access_token}`,...options.headers},cache:'no-store',signal:AbortSignal.timeout(90000)});
 if(!response.ok){const body=await response.json().catch(()=>({}));throw Object.assign(new Error(response.status===403?'This class file is not available to your account.':'The file transfer was interrupted. Please retry.'),{status:Number(body.statusCode)||response.status});}
 return response;
}
const objectPath=path=>path.split('/').map(encodeURIComponent).join('/');
export async function academyMaterialDownload(path){return (await request(`object/authenticated/${bucket}/${objectPath(path)}`)).blob();}
export async function academyMaterialUpload(path,file){
 try{await request(`object/${bucket}/${objectPath(path)}`,{method:'POST',headers:{'Content-Type':'application/octet-stream','x-upsert':'false','Cache-Control':'no-store'},body:file});}
 catch(error){
  if(error.status!==409)throw error;
  // A retry acknowledges an existing immutable upload only when the exact
  // bytes match. It never overwrites another file after a lost response.
  const saved=await academyMaterialDownload(path);
  const hash=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).join(',');
  if(saved.size!==file.size||await hash(saved)!==await hash(file))throw new Error('That upload already contains a different file. Close the upload and choose the file again.');
 }
}
export async function academyMaterialRemove(path){await request(`object/${bucket}`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:[path]})});}
