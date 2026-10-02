import assert from 'node:assert/strict';
import {recipeBrowserHarness} from './recipe-audit-harness.mjs';
import {blankRecipe} from '../../assets/ordering/recipe-model.js';

const t=await recipeBrowserHarness(),owner=t.h.ids.owner,checks=[];
const api=(action,payload={})=>t.api(owner,action,payload);
const d=blankRecipe();d.name='Search safety cake';
d.variants[0].groups[0].ingredients=[{id:'flour',name:'Flour',quantity:'100',unit:'g',cost_snapshot:{amount:'100',quantity:'1000',unit:'g'}}];
d.variants[0].methods[0].steps[0].instruction='Mix and bake.';
const record=await api('create',{document:d,status:'final'}),original=await api('get',{id:record.id});
const changedName='Search safety unsaved name';
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
async function editorStays(page){await page.waitForTimeout(800);assert.equal(await page.locator('[data-path=name]').inputValue(),changedName);assert.equal(await page.locator('.recipe-cost-overview').count(),0);assert.equal(await page.locator('.recipe-library').count(),0);assert.match(await page.locator('[data-save-status]').innerText(),/Unsaved|Working copy/);assert.deepEqual((await api('get',{id:record.id})).document,original.document);}
try{
 for(let trial=1;trial<=3;trial++)await check(`Costing search debounce cannot discard an opened recipe's unsaved edit (trial ${trial})`,async()=>{
  const {page,context}=await t.pageFor(owner);try{await page.goto(t.origin+'/recipes.html');await page.locator('[data-tab=costing]').click();await page.locator('[data-cost-product]').waitFor();await page.locator('.recipe-cost-row-details>summary').click();await page.locator('[data-cost-filter=query]').fill('Search safety');await page.getByRole('button',{name:'Open costing',exact:true}).click();await page.locator('#recipe-dialog [data-cost-value=base_cost]').waitFor();await page.locator('[data-dialog-close]').click();await page.getByRole('button',{name:'Edit recipe',exact:true}).click();await page.locator('[data-path=name]').fill(changedName);await editorStays(page);}finally{await context.close();}
 });
 for(const method of ['Open recipe','Edit'])await check(`Library search followed immediately by ${method} preserves unsaved edits`,async()=>{
  const {page,context}=await t.pageFor(owner);try{await page.goto(t.origin+'/recipes.html');await page.locator('.recipe-card').filter({has:page.getByRole('heading',{name:d.name,exact:true})}).waitFor();await page.locator('[data-filter=query]').fill('Search safety');await page.locator('.recipe-card').filter({has:page.getByRole('heading',{name:d.name,exact:true})}).getByRole('button',{name:method,exact:true}).click();if(method==='Open recipe')await page.getByRole('button',{name:'Edit recipe',exact:true}).click();await page.locator('[data-path=name]').fill(changedName);await editorStays(page);}finally{await context.close();}
 });
 for(const action of ['costing_overview','list'])await check(`Already in-flight ${action} response cannot replace a new unsaved editor`,async()=>{
  const {page,context}=await t.pageFor(owner);let gated=false,startedResolve,releaseResolve;const started=new Promise(r=>startedResolve=r),release=new Promise(r=>releaseResolve=r);
  await context.exposeFunction('auditSearchNavigationApi',async(a,p)=>{if(gated&&a===action){startedResolve();await release;}return(await t.api(owner,a,p,true)).result;});
  await context.route('**/assets/ordering/client.js*',route=>route.fulfill({contentType:'text/javascript',body:`export const ready=Promise.resolve(),auth={getSession:async()=>({data:{session:{user:{id:${JSON.stringify(owner)}}}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})};export const recipeApi=(action,payload={})=>window.auditSearchNavigationApi(action,payload);export const recipeFileUrl=async()=>'';export const uploadRecipeFile=async()=>{throw Error('No upload fixture')};`}));
  try{await page.goto(t.origin+'/recipes.html');if(action==='costing_overview'){await page.locator('[data-tab=costing]').click();await page.locator('[data-cost-product]').waitFor();}else await page.locator('[data-filter=query]').waitFor();gated=true;await page.locator(action==='list'?'[data-filter=query]':'[data-cost-filter=query]').fill('Search safety');await started;await page.getByRole('button',{name:'+ New recipe',exact:true}).click();await page.locator('[data-path=name]').fill(changedName);releaseResolve();await editorStays(page);}finally{releaseResolve();await context.close();}
 });
 await check('Both normal settled searches continue to filter correctly after a return from editing',async()=>{
  const {page,context}=await t.pageFor(owner);try{await page.goto(t.origin+'/recipes.html');await page.locator('[data-filter=query]').fill('No such recipe');await page.getByRole('heading',{name:'No recipes here yet',exact:true}).waitFor();await page.locator('[data-filter=query]').fill('Search safety');await page.getByRole('heading',{name:d.name,exact:true}).waitFor();await page.locator('[data-tab=costing]').click();await page.locator('[data-cost-product]').waitFor();await page.locator('[data-cost-filter=query]').fill('No such recipe');await page.getByText('No products match. Set a recipe size to Saleable Product Costing or change the filters.',{exact:true}).waitFor();await page.locator('[data-cost-filter=query]').fill('Search safety');await page.locator('[data-cost-product]').waitFor();assert.equal(await page.locator('[data-cost-product]').count(),1);}finally{await context.close();}
 });
 assert.deepEqual(t.errors,[]);console.log(`Recipe search navigation complete: ${checks.length} checks.`);
}finally{await t.close();}

