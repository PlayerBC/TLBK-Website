import {blankRecipe,group,ingredient,method,step,id} from './recipe-model.js';
import {quantity} from './recipe-math.js';
const base=new URL('./vendor/recipe-imports/',import.meta.url);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const amount='[0-9¼½¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞][0-9¼½¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞. /+]*';
const units='g|grams?|kg|mg|ml|l|tsp|tbsp|cups?|pcs?|pieces?|oz|lb|pinch';
const trailing=new RegExp(`^(.+?)\\s+(${amount})\\s*(${units})\\.?$`,'i');
const leading=new RegExp(`^(${amount})\\s*(${units})\\s+(.+)$`,'i');
const onlyAmount=new RegExp(`^(${amount})\\s*(${units})\\.?$`,'i');
export function parseRecipeText(text,{name=''}={}) {
 if(typeof text!=='string'||text.length>250000)throw Error('Import up to 250,000 characters at a time.');
 const doc=blankRecipe(),v=doc.variants[0],lines=text.replaceAll('\r','').split('\n').map(s=>s.trim()).filter(Boolean);
 doc.name=name||lines[0]||'Imported recipe';v.groups=[];v.methods=[];let currentGroup=null,currentMethod=null,inMethod=false;
 const warnings=['Review every quantity, unit and instruction before approving this imported recipe.'];let recognized=0;
 function addIngredient(label,qty,unit){
  try{quantity(qty);}catch{return false;}
  if(!currentGroup){currentGroup=group();currentGroup.ingredients=[];v.groups.push(currentGroup);}
  currentGroup.ingredients.push({...ingredient(),name:label.trim(),quantity:qty.trim(),unit:unit.toLowerCase()});recognized++;return true;
 }
 for(let i=(name?0:1);i<lines.length;i++) {
  const line=lines[i].replace(/^[•●]\s*/,''),methodHeading=/^(?:procedure|method|instructions|assembly|baking|directions)\s*:?$/i.test(line);
  if(methodHeading){inMethod=true;currentMethod=method();currentMethod.name=line.replace(/:$/,'');currentMethod.steps=[];v.methods.push(currentMethod);continue;}
  if(/^yield\s*:/i.test(line)){v.yield.description=line.replace(/^yield\s*:\s*/i,'');warnings.push('Yield text is retained. Set the numeric base yield and unit explicitly.');continue;}
  if(/^(?:updated|version|date)\s*:/i.test(line))continue;
  const suffix=line.match(trailing),prefix=line.match(leading);
  if(!inMethod&&suffix&&addIngredient(suffix[1],suffix[2],suffix[3]))continue;
  if(!inMethod&&prefix&&addIngredient(prefix[3],prefix[1],prefix[2]))continue;
  const next=lines[i+1]?.match(onlyAmount);
  if(!inMethod&&next&&line.length<=100&&addIngredient(line,next[1],next[2])){i++;continue;}
  if(!inMethod&&line.length<80&&(!/[.!?]$/.test(line)||line.endsWith(':'))){
   currentGroup=group();currentGroup.name=line.replace(/:$/,'');currentGroup.ingredients=[];v.groups.push(currentGroup);continue;
  }
  if(!currentMethod){currentMethod=method();currentMethod.name='Imported notes / method · review';currentMethod.steps=[];v.methods.push(currentMethod);}
  currentMethod.steps.push({...step(),instruction:line.replace(/^\d+[.)]\s*/,'')});
 }
 v.groups=v.groups.filter(g=>g.ingredients.length);v.methods=v.methods.filter(m=>m.steps.length);
 if(!v.groups.length){warnings.push('No ingredient rows were identified confidently. Enter them while reviewing the source.');v.groups=[{...group(),ingredients:[]}];}
 doc.private_notes=`Import review notes\n${warnings.join('\n')}\n\nOriginal extracted text\n${text}`;
 doc.import_review={source_text:text,warnings,reviewed:false};return {document:doc,warnings,recognized};
}
let mammothPromise;
function mammoth(){
 if(!mammothPromise)mammothPromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=new URL('mammoth/mammoth.browser.min.js',base).href;script.onload=()=>resolve(globalThis.mammoth);script.onerror=()=>{mammothPromise=null;reject(Error('Word import library could not load.'));};document.head.append(script);});return mammothPromise;
}
async function ocr(file,progress){
 const {default:Tesseract}=await import('./vendor/recipe-imports/tesseract.js/tesseract.esm.min.js');const {createWorker}=Tesseract;
 const worker=await createWorker('eng',1,{workerPath:new URL('tesseract.js/worker.min.js',base).href,corePath:new URL('tesseract.js-core/tesseract-core-lstm.wasm.js',base).href,
  langPath:new URL('languages/',base).href,gzip:false,workerBlobURL:false,cacheMethod:'none',logger:message=>progress(`${message.status}${message.progress!=null?` ${Math.round(message.progress*100)}%`:''}`)});
 try{return (await worker.recognize(file)).data.text;}finally{await worker.terminate();}
}
export async function extractRecipeFile(file,progress=()=>{}) {
 if(!file?.size||file.size>25*1024*1024)throw Error('Choose a recipe file up to 25 MB.');
 const extension=file.name.split('.').at(-1).toLowerCase();
 if(extension==='docx'){progress('Reading Word document locally…');const reader=await mammoth();return (await reader.extractRawText({arrayBuffer:await file.arrayBuffer()})).value;}
 if(extension==='pdf'){
  const pdfjs=await import('./vendor/recipe-imports/pdfjs-dist/pdf.min.mjs');pdfjs.GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/pdf.worker.min.mjs',base).href;
  const loading=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,enableXfa:false}),pdf=await loading.promise;
  try{
   if(pdf.numPages>100)throw Error('Import up to 100 PDF pages at a time. Split larger books into smaller files.');
   const result=[];
   for(let number=1;number<=pdf.numPages;number++){
    progress(`Reading PDF page ${number} of ${pdf.numPages}…`);const page=await pdf.getPage(number),content=await page.getTextContent(),rows=[];
    for(const item of content.items){if(!item.str?.trim())continue;const y=Math.round(item.transform[5]/3)*3;let row=rows.find(r=>Math.abs(r.y-y)<3);if(!row){row={y,items:[]};rows.push(row);}row.items.push({x:item.transform[4],text:item.str});}
    const text=rows.sort((a,b)=>b.y-a.y).map(r=>r.items.sort((a,b)=>a.x-b.x).map(i=>i.text).join('\t')).join('\n');
    if(text.trim().length>30)result.push(text);
    else{
     const viewport=page.getViewport({scale:Math.min(2,2000/page.getViewport({scale:1}).width)}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
     if(canvas.width*canvas.height>12000000)throw Error('This PDF page is too large for photo recognition. Import a smaller image.');
     await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
     const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));result.push(await ocr(blob,progress));canvas.width=canvas.height=1;
    }
    page.cleanup();
   }return result.join('\n\n');
  }finally{await loading.destroy();}
 }
 if(extension==='txt'||file.type==='text/plain')return file.text();
 if(['png','jpg','jpeg','webp'].includes(extension)||file.type.startsWith('image/'))return ocr(file,progress);
 throw Error('Use a Word .docx document, PDF, photo or text file. Save older .doc files as .docx first.');
}
export function openRecipeImport({dialog,close,beginEdit,upload,notify}) {
 dialog('Import a recipe for review',`<form id="recipe-import-form"><p class="recipe-muted">Text recognition runs in your browser. The source is kept privately with the draft when you choose “Review draft”. Imported recipes are never approved automatically.</p><label>Word, PDF, photo or text<input type="file" name="source" accept=".docx,.pdf,.txt,image/jpeg,image/png,image/webp"></label><p data-import-status role="status"></p><label>Or paste your recipe<textarea name="source_text" rows="12" placeholder="Recipe name, ingredient groups and quantities, then method…"></textarea></label><label>Recipe name · optional<input name="recipe_name"></label><div class="recipe-actions"><button type="submit" class="primary">Review draft</button></div></form>`);
 const form=document.querySelector('#recipe-import-form'),status=form.querySelector('[data-import-status]'),textarea=form.elements.source_text;let source=null,loading=false;
 form.elements.source.addEventListener('change',async()=>{
  const file=form.elements.source.files[0];if(!file)return;source=file;loading=true;form.querySelector('[type=submit]').disabled=true;
  try{const text=await extractRecipeFile(file,message=>{if(status.isConnected)status.textContent=message;});if(!form.isConnected)return;textarea.value=text;status.textContent='Text extracted. Check it before creating the review draft.';}
  catch(error){if(status.isConnected){status.textContent=error.message;status.className='recipe-error';}source=null;}
  finally{loading=false;form.querySelector('[type=submit]').disabled=false;}
 });
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(loading)return;const submit=form.querySelector('[type=submit]');submit.disabled=true;
  try{
   if(!textarea.value.trim())throw Error('Paste recipe text or choose a file first.');
   const parsed=parseRecipeText(textarea.value,{name:form.elements.recipe_name.value.trim()});
   if(source){status.textContent='Saving the private source attachment…';const types={docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pdf:'application/pdf',txt:'text/plain'};
    const file=source.type?source:new File([source],source.name,{type:types[source.name.split('.').at(-1).toLowerCase()]||'application/octet-stream'});
    const uploaded=await upload(file);parsed.document.files.push({...uploaded,visibility:'private'});
   }
   if(!form.isConnected)return;close();beginEdit(null,parsed.document);notify(`Imported ${parsed.recognized} ingredient rows. Review the quantities, yield and method before saving.`);
  }catch(error){status.textContent=error.message;status.className='recipe-error';}finally{if(submit.isConnected)submit.disabled=false;}
 });
}
