import test from 'node:test';
import assert from 'node:assert/strict';
import { quantitySelection, quantitySaveRows, quantityStatus } from '../assets/ordering/daily-quantities.js';

const dates = ['2026-09-20','2026-09-23'];
const products = [{id:'cake',name:'Ube cake'},{id:'cookies',name:'Cookies'}];
const inventory = [{product_id:'cake',date:dates[0],capacity:5,reserved:3,available:true},{product_id:'cake',date:dates[1],capacity:9,reserved:1,available:true}];
test('new dates are blank, saved limits reappear and differing limits remain mixed',()=>{
  assert.equal(quantitySelection('cookies',dates,inventory).value,'');
  assert.equal(quantitySelection('cake',[dates[0]],inventory).value,'5');
  assert.equal(quantitySelection('cake',dates,inventory).mixed,true);
  assert.deepEqual(quantitySaveRows(products,inventory,dates,{},dates[0]),[]);
  assert.match(quantityStatus(quantitySelection('cake',dates,inventory),dates),/Different saved limits/);
});
test('one edited quantity applies per selected date and never adds to the saved total',()=>{
  const rows=quantitySaveRows(products,inventory,dates,{cake:'12'},dates[0]);
  assert.deepEqual(rows,dates.map(date=>({product_id:'cake',date,capacity:12,available:true})));
  assert.match(quantityStatus(quantitySelection('cake',dates,inventory,{cake:'12'}),dates),/9–11 left/);
});
test('clearing a saved or mixed quantity removes the cap; zero remains an explicit cap',()=>{
  assert.deepEqual(quantitySaveRows(products,inventory,dates,{cake:''},dates[0]).map(row=>row.capacity),[null,null]);
  assert.deepEqual(quantitySaveRows(products,inventory,dates,{cookies:'0'},dates[0]).map(row=>row.capacity),[0,0]);
  assert.equal(quantitySaveRows(products,inventory,dates,{cookies:''},dates[0]).length,0);
});
test('invalid totals and missing dates are rejected, including totals below existing orders',()=>{
  for(const value of ['-1','2.5','abc','1000001'])assert.throws(()=>quantitySaveRows(products,inventory,dates,{cake:value},dates[0]),/whole quantity/);
  assert.throws(()=>quantitySaveRows(products,inventory,dates,{cake:'2'},dates[0]),/3 already ordered/);
  assert.throws(()=>quantitySaveRows(products,inventory,[],{cake:'12'},dates[0]),/Select at least one/);
  assert.throws(()=>quantitySaveRows(products,inventory,dates,{cake:'12'},'2026-10-01'),/future date/);
});
test('explicitly editing a paused product reopens selected dates without touching other products',()=>{
  const paused=[{...inventory[0],available:false}];
  assert.equal(quantitySelection('cake',[dates[0]],paused).paused,true);
  assert.deepEqual(quantitySaveRows(products,paused,[dates[0]],{cake:'5'},dates[0]),[{product_id:'cake',date:dates[0],capacity:5,available:true}]);
});
