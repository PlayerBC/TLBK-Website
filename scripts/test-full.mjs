// Isolated regression only. This command never creates production fixtures.
import {spawn,execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdir,mkdtemp,readFile,writeFile,readdir,rm,access} from 'node:fs/promises';
import {resolve,join,dirname,sep} from 'node:path';
import {createServer} from 'node:net';
const root=resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url);
const env={...process.env};
function modulePath(name,override){try{return override?require.resolve(join(override,name)):require.resolve(name);}catch{throw Error(`Missing ${name}. Run npm install (and npm ci --prefix tests/backend), or set the documented dependency overrides.`);}}
const playwright=modulePath('playwright',env.PLAYWRIGHT_PACKAGE_ROOT);
env.PLAYWRIGHT_PACKAGE_ROOT ||= dirname(dirname(playwright));
const sharp=modulePath('sharp',env.PLAYWRIGHT_PACKAGE_ROOT);env.SHARP_TEST_PATH ||= sharp;
env.PGLITE_PACKAGE_ROOT ||= join(root,'tests/backend/node_modules');
modulePath('@electric-sql/pglite',env.PGLITE_PACKAGE_ROOT);
env.EXCELJS_TEST_PATH ||= require.resolve('exceljs/dist/exceljs.min.js');
env.HEIC_TEST_FILE ||= join(root,'assets/CustomOrders/DripCakes/Drip14.HEIC');
env.HEIC_TEST_DIR ||= dirname(env.HEIC_TEST_FILE);env.HEIC_TEST_FILES ||= env.HEIC_TEST_FILE.split(/[\\/]/).at(-1);env.HEIC_TEST_EXPORT='0';env.PARTY_PHOTO_ASSETS_ROOT=root;
await Promise.all([env.EXCELJS_TEST_PATH,env.HEIC_TEST_FILE].map(p=>access(p)));
const {chromium}=require(playwright);
const probe=await chromium.launch({headless:true,executablePath:env.BROWSER_EXECUTABLE_PATH||undefined});await probe.close();
const output=join(root,'test-results/full-regression');await mkdir(output,{recursive:true});
const runDir=await mkdtemp(join(output,'run-')),previewDir=join(runDir,'academy');
const port=await new Promise((resolve,reject)=>{const s=createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
env.ACADEMY_TEST_BASE=env.ACADEMY_PREVIEW_URL=`http://127.0.0.1:${port}`;
env.ACADEMY_PREVIEW_DIR=previewDir;env.PORT=String(port);
let tracked;
try{tracked=execFileSync('git',['ls-files','tests/ui/*.mjs'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);}catch{tracked=(await readdir(join(root,'tests/ui'))).filter(f=>f.endsWith('.mjs')).map(f=>'tests/ui/'+f);}
const ui=tracked.filter(f=>f!=='tests/ui/academy.mjs').sort();
const recipeUI=['tests/ui/recipes.mjs','tests/ui/recipe-import-export.mjs'].filter(f=>!ui.includes(f));
const jobs=[['tests/ui/academy.mjs'],['scripts/test-unit.mjs'],['tests/backend/run.mjs'],['tests/backend/run.mjs','--vouchers'],['tests/backend/run.mjs','--operations'],['tests/backend/run.mjs','--recipes'],['--experimental-transform-types','tests/backend/run.mjs','--recipe-backups'],['tests/edge/run.mjs'],...ui.map(f=>[f]),...recipeUI.map(f=>[f]),['tests/newsletter-ui.mjs']];
const children=new Set(),rows=[];let interrupted=false,previewLog='',preview;
function kill(child){
 if(child.exitCode!==null||child.signalCode!==null)return;
 // Only process trees spawned by this runner; nested test runners must stop too.
 try{if(process.platform==='win32')execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});else process.kill(-child.pid,'SIGTERM')}catch{child.kill()}
}
const stop=()=>{interrupted=true;for(const child of children)kill(child);};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
async function launch(args,timeoutMs=300000){
 const started=Date.now();let log='',timedOut=false;
 const result=await new Promise(resolve=>{const child=spawn(process.execPath,args,{cwd:root,env,windowsHide:true,detached:process.platform!=='win32'});children.add(child);const timer=setTimeout(()=>{timedOut=true;kill(child);},timeoutMs);child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);child.on('error',e=>log+='\n'+e.message);child.on('close',(code,signal)=>{clearTimeout(timer);children.delete(child);resolve({code,signal});});});
 const name=args.join(' '),file=name.replace(/[^a-zA-Z0-9.-]/g,'-')+'.log';await writeFile(join(runDir,file),log);
 const row={name,...result,timedOut,ms:Date.now()-started,log:file};rows.push(row);await writeFile(join(runDir,'results.json'),JSON.stringify(rows,null,2));
 console.log(`${result.code===0?'PASS':'FAIL'} ${name} (${Math.round(row.ms/1000)}s)`);return result.code===0;
}
try{
 console.log('Starting isolated Academy preview; reports: '+runDir);
 preview=spawn(process.execPath,['scripts/academy-preview.mjs'],{cwd:root,env,windowsHide:true,detached:process.platform!=='win32'});children.add(preview);
 preview.stdout.on('data',b=>previewLog+=b);preview.stderr.on('data',b=>previewLog+=b);preview.on('error',e=>previewLog+='\n'+e.message);
 let ready=false;
 for(let n=0;n<180&&!interrupted;n++){
  if(preview.exitCode!==null)throw Error('Academy preview exited before startup; see preview.log');
  try{ready=(await fetch(env.ACADEMY_TEST_BASE+'/academy.html',{signal:AbortSignal.timeout(1000)})).ok;}catch{}
  if(ready)break;await new Promise(r=>setTimeout(r,500));
 }
 if(!ready)throw Error('Academy preview did not become ready');
 // Seed first: the dialog suite requires the camp created by this integration test.
 if(!await launch(jobs.shift()))throw Error('Academy fixture preparation failed; remaining suites were not run');
 let next=0;await Promise.all(Array.from({length:2},async()=>{while(next<jobs.length&&!interrupted)await launch(jobs[next++]);}));
 const failed=rows.filter(r=>r.code!==0||r.timedOut);
 console.log(`${rows.length-failed.length}/${rows.length} suites passed${interrupted?' — interrupted':''}`);
 process.exitCode=failed.length||interrupted?1:0;
}catch(e){console.error(e.message);process.exitCode=1;}
finally{
 stop();
 if(preview&&preview.exitCode===null&&preview.signalCode===null)await new Promise(resolve=>{preview.once('close',resolve);setTimeout(resolve,5000).unref();});
 await writeFile(join(runDir,'preview.log'),previewLog);
 // Delete only this run's generated DB/images, after its server has stopped.
 const target=resolve(previewDir),parent=resolve(runDir);
 if(preview&&(preview.exitCode!==null||preview.signalCode!==null)&&target.startsWith(parent+sep)&&target===join(parent,'academy'))await rm(target,{recursive:true,force:true});
 await writeFile(join(output,'latest.json'),JSON.stringify({directory:runDir,passed:rows.filter(r=>r.code===0&&!r.timedOut).length,total:rows.length,exitCode:process.exitCode||0},null,2));
 process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
}
