// Synthetic local benchmark only. It neither connects to Supabase nor uploads files.
import {recipeZip,newArchiveDigest,nativeDigest} from '../assets/ordering/recipe-archive.js';
const count=Number(process.argv[2]||100);
if(!Number.isSafeInteger(count)||count<1||count>1000)throw Error('Choose 1–1000 MiB of synthetic input.');
const file=Uint8Array.from({length:1024*1024},(_,i)=>i%251);
const cpu=process.cpuUsage(),started=performance.now(),hash=await newArchiveDigest();let size=0;
async function* entries(){for(let i=0;i<count;i++){await nativeDigest(file);yield {path:`Files/${i}.bin`,bytes:file};}}
for await(const bytes of recipeZip(entries())){size+=bytes.length;hash.update(bytes);}
const usage=process.cpuUsage(cpu);
console.log(JSON.stringify({source_mib:count,archive_bytes:size,elapsed_ms:Math.round(performance.now()-started),cpu_ms:Math.round((usage.user+usage.system)/1000),peak_rss_mib:Math.round(process.resourceUsage().maxRSS/1024),sha256:hash.digest('hex'),environment:'Local Node; not a hosted Edge runtime capacity claim'},null,2));
