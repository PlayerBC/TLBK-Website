import test from 'node:test';import assert from 'node:assert/strict';
import {blankRecipe,normalizeRecipe,scaledCopy,applyVariation,differences,csvIngredients,productionPlan} from '../assets/ordering/recipe-model.js';
import {parseRecipeText} from '../assets/ordering/recipe-import.js';
test('temporary scaling can become a separate copy without modifying source or baking settings',()=>{
 const d=blankRecipe(),v=d.variants[0];d.name='Cookies';v.groups[0].ingredients=[{id:'a',name:'Sugar',quantity:'100',unit:'g'}];v.baking=[{top:'180',minutes:'15'}];const before=JSON.stringify(d);
 const copy=scaledCopy(d,v.id,'1.5');assert.equal(copy.variants[0].groups[0].ingredients[0].quantity,'150');assert.equal(copy.variants[0].baking[0].minutes,'15');assert.notEqual(copy.variants[0].id,v.id);assert.equal(JSON.stringify(d),before);
});
test('variation overrides retain pinned source values and report the difference',()=>{
 const d=blankRecipe(),v=d.variants[0],g=v.groups[0];g.ingredients=[{id:'flour',name:'Flour',quantity:'26',unit:'g'}];
 const changed=applyVariation(d,[{variant_id:v.id,group_id:g.id,row_id:'flour',action:'replace',ingredient:{quantity:'14'}}]);
 assert.equal(d.variants[0].groups[0].ingredients[0].quantity,'26');assert.equal(changed.variants[0].groups[0].ingredients[0].quantity,'14');assert.equal(differences(d,changed).length,1);
});
test('portion-size scaling increases weights without doubling pieces and scales linked packaging counts',()=>{
 const d=blankRecipe(),v=d.variants[0];v.yield={quantity:'24',unit:'cookies',portions:'24',portion_weight:'100',batch_weight:'2400',pans:'2'};v.groups[0].ingredients=[{id:'sugar',name:'Sugar',quantity:'120',unit:'g'}];v.additional_costs=[{name:'Box',resource_id:'box',quantity:'2',amount:'40',unit:'pc'}];
 const larger=scaledCopy(d,v.id,'2',{mode:'portion',target:'200'}).variants[0];assert.equal(larger.yield.quantity,'24');assert.equal(larger.yield.portions,'24');assert.equal(larger.yield.batch_weight,'4800');assert.equal(larger.yield.portion_weight,'200');
 const double=scaledCopy(d,v.id,'2').variants[0];assert.equal(double.yield.quantity,'48');assert.equal(double.additional_costs[0].quantity,'4');assert.equal(d.variants[0].yield.quantity,'24');
});
test('imports keep uncertain source text and do not invent a numeric yield',()=>{
 const text='Vanilla Cookies\nYield: 24 cookies\nBatter\nSugar\t120g\nFlour\t1½ kg\nMethod\n1. Mix the ingredients.\n2. Bake at 180 C for 15 minutes.';
 const result=parseRecipeText(text);assert.equal(result.recognized,2);assert.equal(result.document.name,'Vanilla Cookies');assert.equal(result.document.variants[0].groups[0].ingredients[1].quantity,'1½');assert.equal(result.document.variants[0].yield.quantity,'1');assert.match(result.document.private_notes,/Yield: 24 cookies/);assert.equal(result.document.variants[0].methods[0].steps.length,2);
 assert.equal(parseRecipeText('Unknown\nSomething without a quantity.').recognized,0);
});
test('CSV export neutralizes spreadsheet formulas in ingredient names',()=>{
 const d=blankRecipe(),v=d.variants[0];v.groups[0].ingredients=[{id:'x',name:'=DANGEROUS()',quantity:'1',unit:'g'}];
 assert.match(csvIngredients(d,v.id),/"'=DANGEROUS\(\)"/);
});
test('older sparse documents receive optional UI defaults without changing their formula',()=>{
 const d={name:'Older recipe',variants:[{id:'base',name:'Standard',yield:{quantity:'2',unit:'cakes'},groups:[],methods:[]}]};
 const normalized=normalizeRecipe(d);assert.deepEqual(normalized.variants[0].components,[]);assert.equal(normalized.variants[0].yield.quantity,'2');assert.equal(d.variants[0].components,undefined);
});
test('production totals expand pinned components and disclose whole-batch leftovers',async()=>{
 const parent=normalizeRecipe({name:'Cake',variants:[{id:'cake',name:'Cake',yield:{quantity:'1',unit:'cake'},groups:[{name:'Assembly',ingredients:[{id:'a',name:'Sugar',quantity:'10',unit:'g'}]}],components:[{id:'filling',version_id:'filling-v1',variant_id:'filling',quantity:'100',unit:'g'}]}]});
 const child=normalizeRecipe({name:'Filling',variants:[{id:'filling',name:'Filling',yield:{quantity:'400',unit:'g'},groups:[{name:'Filling',ingredients:[{id:'b',name:'Sugar',quantity:'100',unit:'g'}]}]}]});
 const record={version_id:'cake-v1',document:parent},loadRecipe=async()=>({version:1,version_id:'filling-v1',document:child});
 const exact=await productionPlan(record,'cake','3',{loadRecipe});assert.equal(exact.totals[0].display,'105');assert.equal(exact.components[0].leftover,'0');
 const whole=await productionPlan(record,'cake','3',{loadRecipe,wholeComponents:true});assert.equal(whole.totals[0].display,'130');assert.equal(whole.components[0].leftover,'100');
 assert.equal(parent.variants[0].groups[0].ingredients[0].quantity,'10');
});
