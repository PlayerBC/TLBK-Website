import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {blankRecipe} from '../../assets/ordering/recipe-model.js';
import {recipeZip} from '../../assets/ordering/recipe-archive.js';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_PACKAGE_ROOT?join(process.env.PLAYWRIGHT_PACKAGE_ROOT,'playwright'):'playwright');
const root=resolve(import.meta.dirname,'../..'),out=join(root,'tests/artifacts/recipe-io');await mkdir(out,{recursive:true});
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.jpg':'image/jpeg','.wasm':'application/wasm'};
const server=createServer(async(req,res)=>{try{const file=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+sep))throw Error();res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe'}),page=await browser.newPage({viewport:{width:1200,height:1000}}),errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/assets/ordering/client.js',route=>route.fulfill({contentType:'text/javascript',body:'export const ready=Promise.resolve(),auth=null,recipeApi=async()=>({}),uploadRecipeFile=async()=>({}),recipeFileUrl=async()=>"";'}));
const source='QA Vanilla Cookies\nSugar 120 g\nFlour 250 g\nMethod\n1. Mix sugar and flour.\n2. Bake at 180 C for 12 minutes.';
try{
 await page.goto(origin+'/recipes.html');
 // Generate a minimal real Word document, using a standards-compliant ZIP.
 const xml='<?xml version="1.0" encoding="UTF-8"?>';
 const parts={'[Content_Types].xml':xml+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
 '_rels/.rels':xml+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
 'word/document.xml':xml+'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+source.split('\n').map(t=>`<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`).join('')+'</w:body></w:document>'};
 async function* entries(){for(const [name,text]of Object.entries(parts))yield {path:name,bytes:new TextEncoder().encode(text)};}
 const chunks=[];for await(const chunk of recipeZip(entries()))chunks.push(chunk);const docx=Buffer.concat(chunks);
 async function extract(bytes,name,type){return page.evaluate(async({b64,name,type})=>{const {extractRecipeFile,parseRecipeText}=await import('/assets/ordering/recipe-import.js');const file=new File([Uint8Array.from(atob(b64),c=>c.charCodeAt(0))],name,{type});const text=await extractRecipeFile(file);return {text,parsed:parseRecipeText(text)};},{b64:Buffer.from(bytes).toString('base64'),name,type});}
 let imported=await extract(docx,'cookies.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document');assert.match(imported.text,/Sugar 120 g/);assert.equal(imported.parsed.recognized,2);checks.push('Real DOCX text and ingredient rows');
 const fixture=await browser.newPage();await fixture.setContent(`<pre style="font:24px Arial;line-height:2">${source}</pre>`);const pdf=await fixture.pdf({format:'A4'});imported=await extract(pdf,'cookies.pdf','application/pdf');assert.match(imported.text,/Sugar\s+120 g/);assert.equal(imported.parsed.recognized,2);checks.push('Text PDF extraction');
 const image=await fixture.screenshot();imported=await extract(image,'cookies.png','image/png');assert.match(imported.text,/Sugar\s+120\s*g/i);assert.ok(imported.parsed.recognized>=2);checks.push('Photo OCR using locally hosted worker, WASM and language data');
 await fixture.setContent(`<img src="data:image/png;base64,${image.toString('base64')}" style="width:100%">`);const scan=await fixture.pdf({format:'A4'});imported=await extract(scan,'scanned-cookies.pdf','application/pdf');assert.match(imported.text,/Sugar\s+120\s*g/i);checks.push('Scanned PDF page rendering and OCR');await fixture.close();
 const doc=blankRecipe();doc.name='QA Component Cake';doc.variants[0].groups[0].ingredients=[{id:'flour',name:'Flour',quantity:'424',unit:'g',notes:'Sifted'}];doc.variants[0].methods[0].steps[0].instruction='Fold gently. Bake until set.';doc.variants[0].packaging={description:'Acetate cake box',dimensions:'10 × 10 × 6.5 inches',photos:[{file_id:'photo',caption:'Packaging'}]};doc.variants[0].equipment=[{name:'Offset spatula',notes:'Small blade'}];doc.photos=[{file_id:'photo',caption:'Finished cake'}];
 const child=structuredClone(doc);child.name='QA Sponge';child.photos=[];child.variants[0].packaging={};child.variants[0].groups[0].ingredients[0].quantity='100';child.variants[0].yield.quantity='100';child.variants[0].yield.unit='g';
 doc.variants[0].components=[{id:'sponge',version_id:'child-v1',variant_id:child.variants[0].id,quantity:'50',unit:'g'}];
 const record={id:'parent',code:'R-QA',version:1,version_id:'parent-v1',status:'production',updated_at:'2026-09-30T00:00:00Z',document:doc,links:[{version_id:'child-v1',recipe_id:'child'}],files:[{id:'photo',mime_type:'image/png',path:'fixture'}]},component={...record,id:'child',code:'R-SPONGE',version_id:'child-v1',document:child,links:[]};
 for(const layout of ['kitchen','presentation']){
  await page.evaluate(async({record,component,photo})=>{window.print=()=>{window.printReady=true;};window.printReady=false;const {openRecipeExport}=await import('/assets/ordering/recipe-print.js');await openRecipeExport({record,production:{variant_id:record.document.variants[0].id,factor:'1.15'},kitchen:false,api:async()=>component,fileUrl:async()=>photo,dialog:(title,html)=>{document.querySelector('#recipe-dialog-body').innerHTML=html;document.querySelector('#recipe-dialog').showModal();}});},{record,component,photo:'data:image/png;base64,'+image.toString('base64')});
  await page.locator('[name=layout]').selectOption(layout);await page.locator('[name=production]').check();if(layout==='presentation')await page.locator('[name=paper]').selectOption('Letter');await page.getByRole('button',{name:'Prepare printable recipe',exact:true}).click();await page.waitForFunction(()=>window.printReady===true);
  const printable=page.locator('.recipe-print-root');assert.match(await printable.innerText(),/487.6 g/);assert.match(await printable.innerText(),/57.5 g/);assert.match(await printable.innerText(),/Component for QA Component Cake/);
  await page.emulateMedia({media:'print'});await page.pdf({path:join(out,`${layout}.pdf`),preferCSSPageSize:true,printBackground:true});await page.screenshot({path:join(out,`${layout}.png`),fullPage:true});await page.emulateMedia({media:'screen'});checks.push(`${layout} PDF: scaled main formula, pinned component, photos and separate references`);
 }
 assert.deepEqual(errors,[]);console.log(checks.map(x=>'PASS '+x).join('\n'));
}finally{await writeFile(join(out,'results.json'),JSON.stringify({checks,errors},null,2));await browser.close();await new Promise(r=>server.close(r));}
