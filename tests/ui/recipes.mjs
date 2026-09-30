import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {makeHarness} from '../backend/helpers.mjs';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE_ROOT?join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'):'playwright');
const dbRequire=createRequire(join(resolve(process.env.PGLITE_PACKAGE_ROOT||'../newsletter-test-deps'),'package.json'));
const {PGlite}=dbRequire('@electric-sql/pglite'),{pgcrypto}=dbRequire('@electric-sql/pglite/contrib/pgcrypto');
const root=resolve(import.meta.dirname,'../..'),out=join(root,'tests/artifacts/recipes'),origin='https://recipes.test';await mkdir(out,{recursive:true});
const db=new PGlite({extensions:{pgcrypto}});await db.exec(await readFile(join(root,'tests/backend/bootstrap.sql'),'utf8'));
for(const file of(await readdir(join(root,'supabase/migrations'))).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(join(root,'supabase/migrations',file),'utf8'));
const h=await makeHarness(db);let queue=Promise.resolve();
function api(user,action,payload={}){const run=()=>h.as(user,async()=>(await db.query('select public.recipe_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result);queue=queue.then(run,run);return queue;}
await api(h.ids.owner,'save_access',{user_id:h.ids.staff,permission:'kitchen'});
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.wasm':'application/wasm','.traineddata':'application/octet-stream'};
const errors=[],results=[],files=new Map();
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
async function pageFor(user,width=1440){
 const context=await browser.newContext({viewport:{width,height:1000}});await context.exposeFunction('recipeTestApi',(action,payload)=>api(user,action,payload));
 await context.exposeFunction('recipeTestBackup',(action,payload={})=>{const run=()=>h.as(user,async()=>(await db.query('select public.recipe_backup_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result);queue=queue.then(run,run);return queue;});
 await context.exposeFunction('recipeTestUpload',async({name,type,bytes})=>{const buffer=Buffer.from(bytes),file=await api(user,'reserve_file',{filename:name,mime_type:type,size_bytes:buffer.length,sha256:createHash('sha256').update(buffer).digest('hex')});await db.query("insert into storage.objects(bucket_id,name,metadata) values('recipe-files',$1,$2::jsonb)",[file.path,JSON.stringify({size:buffer.length,mimetype:type})]);files.set(file.path,{bytes:buffer,type});await api(user,'confirm_file',{id:file.id});return file;});
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
  if(u.pathname==='/assets/ordering/client.js')return route.fulfill({contentType:'text/javascript',body:`export const ready=Promise.resolve(),auth={getSession:async()=>({data:{session:{user:{id:${JSON.stringify(user)}}}}})};export const recipeApi=(action,payload={})=>window.recipeTestApi(action,payload);export const recipeFileUrl=async path=>'/__files/'+path;export const uploadRecipeFile=async file=>window.recipeTestUpload({name:file.name,type:file.type,bytes:[...new Uint8Array(await file.arrayBuffer())]});export const recipeBackupApi=(action,payload={})=>window.recipeTestBackup(action,payload);export const recipeBackupConnection=async()=>({});export const recipeBackupDownload=async()=>new Blob();`});
  if(u.pathname.startsWith('/__files/')){const file=files.get(u.pathname.slice(9));return file?route.fulfill({body:file.bytes,contentType:file.type}):route.fulfill({status:404});}
  const file=resolve(root,'.'+decodeURIComponent(u.pathname));if(!file.startsWith(root+sep))return route.abort();
  try{return route.fulfill({body:await readFile(file),contentType:mime[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());return {page,context};
}
const fill=(page,path,value)=>page.locator(`[data-path="${path}"]`).fill(value);
try{
 const {page,context}=await pageFor(h.ids.owner);await page.goto(origin+'/recipes.html');await page.getByRole('button',{name:'+ New recipe',exact:true}).click();
 await fill(page,'name','QA Chocolate Cookies');await fill(page,'variants.0.yield.quantity','24');await fill(page,'variants.0.yield.unit','cookies');await fill(page,'variants.0.yield.portions','24');
 await fill(page,'variants.0.groups.0.ingredients.0.name','Sugar');await fill(page,'variants.0.groups.0.ingredients.0.quantity','424');
 await fill(page,'variants.0.methods.0.steps.0.instruction','Mix the ingredients and bake.');
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=320;c.height=240;const x=c.getContext('2d');x.fillStyle='#e8d8ba';x.fillRect(0,0,320,240);x.fillStyle='#765135';x.beginPath();x.arc(160,120,70,0,Math.PI*2);x.fill();return c.toDataURL('image/png').split(',')[1];});const photoPath=join(out,'fixture-photo.png');await writeFile(photoPath,Buffer.from(png,'base64'));
 const choosing=page.waitForEvent('filechooser');await page.getByRole('button',{name:'+ Photo',exact:true}).click();await(await choosing).setFiles(photoPath);await page.locator('.recipe-photos img').first().waitFor();await page.waitForFunction(()=>document.querySelector('.recipe-photos img')?.naturalWidth>0);results.push('Upload, convert and preview a private product photo');
 await page.locator('#recipe-save-status').selectOption('production');await page.getByRole('button',{name:'Save new version',exact:true}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await page.getByRole('button',{name:'Edit recipe',exact:true}).waitFor();
 const stored=(await api(h.ids.owner,'list',{query:'QA Chocolate Cookies'})).rows[0];assert.ok(stored);results.push('Create and publish through the editor');
 await page.locator('[data-scale="target"]').fill('1.15');await page.locator('[data-scale="target"]').press('Tab');await page.getByText('487.6 g',{exact:true}).waitFor();
 assert.equal((await api(h.ids.owner,'get',{id:stored.id})).document.variants[0].groups[0].ingredients[0].quantity,'424');results.push('Temporary scaling preserves the saved formula');
 await page.getByRole('button',{name:'Edit recipe',exact:true}).click();await fill(page,'variants.0.groups.0.ingredients.0.quantity','450');await page.locator('#recipe-save-status').selectOption('draft');await page.getByRole('button',{name:'Save new version',exact:true}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();await page.getByRole('button',{name:'Edit recipe',exact:true}).waitFor();
 assert.equal((await api(h.ids.staff,'get',{id:stored.id})).document.variants[0].groups[0].ingredients[0].quantity,'424');results.push('Draft changes leave the kitchen recipe on its published version');
 await page.getByRole('button',{name:'Version history',exact:true}).click();await page.getByRole('button',{name:'Compare',exact:true}).last().click();assert.match(await page.locator('#recipe-dialog-body').innerText(),/424/);await page.locator('[data-dialog-close]').click();
 await page.getByRole('button',{name:'Duplicate',exact:true}).click();await page.locator('#recipe-editor').waitFor();assert.equal((await api(h.ids.owner,'list',{query:'QA Chocolate Cookies'})).total,2);results.push('Compare and duplicate saved versions');
 await page.screenshot({path:join(out,'editor-desktop.png'),fullPage:true});
 await page.getByRole('button',{name:'Back to library',exact:true}).click();await page.getByRole('button',{name:'Ingredients',exact:true}).click();await page.getByRole('button',{name:'+ Add ingredient',exact:true}).click();
 await page.locator('#recipe-resource-form [name=name]').fill('QA priced sugar');await page.locator('[name=default_unit]').fill('g');await page.locator('[name=price_amount]').fill('90');await page.locator('[name=price_quantity]').fill('1000');await page.locator('[name=price_unit]').fill('g');await page.getByRole('button',{name:'Save ingredient',exact:true}).click();await page.getByText('QA priced sugar',{exact:true}).waitFor();results.push('Create a master ingredient with a purchase price');
 await page.getByRole('button',{name:'Recipes',exact:true}).click();await page.getByRole('button',{name:'Open recipe',exact:true}).last().click();
 await page.getByRole('button',{name:'Testing / R&D',exact:true}).click();await page.getByRole('button',{name:'+ New test',exact:true}).click();await page.locator('[name=observations]').fill('Uniform browning');await page.locator('[name=rating]').fill('5');
 const testPhoto=page.waitForEvent('filechooser');await page.getByRole('button',{name:'+ Test photo',exact:true}).click();await(await testPhoto).setFiles(photoPath);await page.locator('[data-test-photos] img').waitFor();
 await page.getByRole('button',{name:'Save test log',exact:true}).click();await page.getByRole('button',{name:'Promote',exact:true}).click();await page.getByRole('button',{name:'Promote test',exact:true}).click();await page.getByRole('button',{name:'Edit recipe',exact:true}).waitFor();results.push('Save an R&D photo and log, then explicitly promote the formula');
 await page.getByRole('button',{name:'Production history',exact:true}).click();await page.locator('[name=actual_yield]').fill('23');await page.getByRole('button',{name:'Record production',exact:true}).click();await page.getByRole('cell',{name:'23 cookies',exact:true}).waitFor();await page.locator('[data-dialog-close]').click();results.push('Record finished production quantities separately from recipes');
 await page.getByRole('button',{name:'Library',exact:true}).click();await page.getByRole('button',{name:'Backups',exact:true}).click();await page.getByRole('heading',{name:'Recipe & costing backups',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Back up now',exact:true}).isDisabled(),true);assert.match(await page.locator('#recipe-backups').innerText(),/No verified Drive archives yet/);results.push('Backup UI does not imply success or allow an unconfigured upload');
 await page.getByRole('button',{name:'Recipes',exact:true}).click();await page.getByRole('button',{name:'+ New recipe',exact:true}).click();await page.setViewportSize({width:390,height:844});await fill(page,'name','QA Mobile draft');await fill(page,'variants.0.groups.0.ingredients.0.quantity','1½');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(out,'editor-mobile.png'),fullPage:true});results.push('Mobile editor accepts fractions with no horizontal page overflow');
 await context.close();
 for(const width of [390,820,1440]){
  const {page,context}=await pageFor(h.ids.staff,width);await page.goto(origin+'/recipes.html?view=kitchen');await page.getByRole('button',{name:'Open recipe',exact:true}).first().click();await page.getByRole('heading',{name:'QA Chocolate Cookies',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Edit recipe',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Costing',exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const checkbox=page.locator('[data-check]').first();await checkbox.check();assert.equal(await checkbox.isChecked(),true);
  await page.screenshot({path:join(out,`kitchen-${width}.png`),fullPage:true});results.push(`Read-only kitchen layout, checkoffs and overflow at ${width}px`);await context.close();
 }
 assert.deepEqual(errors,[]);console.log(results.map(r=>'PASS '+r).join('\n'));
}finally{await browser.close();await db.close();await writeFile(join(out,'results.json'),JSON.stringify({results,errors},null,2));}
