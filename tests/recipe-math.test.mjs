import test from 'node:test';
import assert from 'node:assert/strict';
import {quantity,exact,multiply,displayQuantity,scaleFactor,scaleIngredients,convert,ingredientTotals,componentPlan,costRecipe} from '../assets/ordering/recipe-math.js';

test('preserves decimal, mixed and additive fractions without floating-point drift',()=>{
  assert.equal(exact(multiply(quantity('424'),quantity('1.15'))),'487.6');
  assert.equal(exact(quantity('1½ + 1/16')),'1.5625');
  assert.equal(exact(quantity('½ + 1/16')),'0.5625');
  assert.equal(exact(multiply(quantity('⅓'),quantity('3'))),'1');
  assert.equal(exact(quantity('1 1/3')),'1 1/3');
  assert.equal(exact(multiply(quantity('0.1'),quantity('0.2'))),'0.02');
  for(const value of ['', '-1','NaN','Infinity','1/0','1e999','2 eggs','1 +'])assert.throws(()=>quantity(value));
});
test('rounding discloses differences and retains the exact original quantity',()=>{
  const display=displayQuantity('487.6',{mode:'whole'});
  assert.equal(display.text,'488');assert.equal(display.rounded,true);assert.equal(exact(display.exact),'487.6');
  assert.equal(displayQuantity('2.25',{mode:'practical',step:'0.5'}).text,'2.5');
  assert.throws(()=>displayQuantity('2',{mode:'practical',step:'0'}));
});
test('six scaling inputs calculate ratios and never mutate master rows',()=>{
  const y={quantity:'1',portions:'6',portion_weight:'175',batch_weight:'1050',pans:'6'};
  for(const [mode,target,expected] of [['multiplier','1.15','1.15'],['yield','2','2'],['pieces','12','2'],['portion','350','2'],['weight','525','0.5'],['pans','3','0.5']])assert.equal(exact(scaleFactor(y,mode,target)),expected);
  assert.throws(()=>scaleFactor({},'pieces','12'));assert.throws(()=>scaleFactor(y,'yield','0'));
  const rows=[{name:'Batter',ingredients:[{name:'Cream cheese',quantity:'424',unit:'g'}]}];
  const before=JSON.stringify(rows),scaled=scaleIngredients(rows,'1.15');
  assert.equal(scaled[0].ingredients[0].scaled_display,'487.6');assert.equal(JSON.stringify(rows),before);
});
test('totals combine compatible units while preserving unknown units and brands',()=>{
  const totals=ingredientTotals([{ingredients:[{name:'Sugar',quantity:'100',unit:'g'},{name:'Sugar',quantity:'0.2',unit:'kg'},{name:'Sugar',quantity:'1',unit:'cup'},{name:'Sugar',brand:'Special',quantity:'50',unit:'g'}]}]);
  assert.equal(totals.length,3);assert.equal(totals.find(r=>r.unit==='g'&&!r.brand).display,'300');
  assert.throws(()=>convert('1','cup','g'));assert.throws(()=>convert('1','tsp','ml'));
  assert.equal(exact(convert('1.5','kg','g')),'1500');
});
test('whole component batches explicitly report surplus, with exact scaling the default',()=>{
  const exactPlan=componentPlan('2','3'),wholePlan=componentPlan('2','3',{wholeBatches:true});
  assert.equal(exact(exactPlan.batches),'1.5');assert.equal(exact(exactPlan.leftover),'0');
  assert.equal(exact(wholePlan.batches),'2');assert.equal(exact(wholePlan.leftover),'1');
});
test('costs preserve purchase price snapshots and mark missing or incompatible costs incomplete',()=>{
  const groups=[{ingredients:[{id:'1',ingredient_id:'cheese',name:'Cream cheese',quantity:'424',unit:'g'}]}];
  const prices={cheese:{amount:'600',quantity:'1.5',unit:'kg',currency:'PHP'}};
  const cost=costRecipe(groups,{prices,additional:[{amount:'30'}],portions:'6',factor:'2'});
  assert.equal(cost.complete,true);assert.equal(exact(cost.ingredient_total),'339.2');assert.equal(exact(cost.total),'399.2');
  prices.cheese.amount='900';assert.equal(cost.lines[0].price_snapshot.amount,'600');
  assert.equal(costRecipe(groups).complete,false);
  assert.equal(costRecipe(groups,{prices:{cheese:{amount:'20',quantity:'1',unit:'cup'}}}).complete,false);
  assert.equal(costRecipe(groups,{prices:{cheese:{amount:'20',quantity:'1',unit:'kg',currency:'USD'}}}).complete,false);
});
