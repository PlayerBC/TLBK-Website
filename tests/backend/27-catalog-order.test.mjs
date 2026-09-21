import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { orderedCatalogProducts } from '../../assets/ordering/catalog-ordering.js';

export default async function({db,check,state}) {
  const h=state.harness;
  const get=kind=>h.api('admin_bootstrap',{},h.ids.owner).then(data=>kind==='products'?orderedCatalogProducts(data.products,data.categories):data.categories.sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)||a.name.localeCompare(b.name)));
  const snapshot=items=>items.map(({id,sort_order,category_id})=>({id,sort_order:sort_order||0,category_id:category_id||null}));
  const reverseGroups=items=>[...new Set(items.map(x=>x.category_id||''))].flatMap(category=>items.filter(x=>(x.category_id||'')===category).map(x=>x.id).reverse());
  const payload=(kind,items,ids=kind==='products'?reverseGroups(items):items.map(x=>x.id).reverse())=>({kind,ids,expected:snapshot(items)});
  const save=p=>h.api('reorder_catalog',p,h.ids.owner);
  let products, categories, reordered;
  await check('catalog order: owner authorization and private helper are enforced',async()=>{
    await h.product({name:'Reorder hidden product',active:false,sort_order:41});
    for(const name of ['Reorder category A','Reorder category B'])await h.api('save_category',{category:{name,sort_order:0}},h.ids.owner);
    categories=await get('categories');
    for(const category of categories.slice(-2))for(let i=0;i<3;i++)await h.product({name:category.name+' product '+i,category_id:category.id,sort_order:i,active:i!==2});
    products=await get('products');
    for(const user of [null,h.ids.staff,h.ids.customer,h.ids.unverified])await assert.rejects(h.api('reorder_catalog',payload('products',products),user),/owner|verified|staff|sign in/i);
    await assert.rejects(h.as(h.ids.owner,()=>db.query("select tlb.reorder_catalog('products','[]','[]')")),/permission denied/);
  })();
  await check('catalog order: one save reorders all products and preserves every detail',async()=>{
    const p=payload('products',products);
    reordered=(await save(p)).items;
    assert.deepEqual(reordered.map(x=>x.id),p.ids);
    for(const [index,item] of reordered.entries()) {
      assert.equal(item.sort_order,index+1);
      const original=products.find(x=>x.id===item.id);
      assert.deepEqual({...item,sort_order:original.sort_order},{...original});
    }
    assert.deepEqual((await save(p)).items,reordered); // Lost response retry.
    const shop=await h.api('catalog');
    assert.deepEqual(shop.products.map(x=>x.id),reordered.filter(x=>x.active).map(x=>x.id));
  })();
  await check('catalog order: stale, duplicate, missing and foreign IDs cannot partly change order',async()=>{
    const before=await get('products'),base=payload('products',before);
    for(const p of [{...base,ids:base.ids.slice(1)},{...base,ids:[base.ids[0],...base.ids.slice(0,-1)]},{...base,ids:[randomUUID(),...base.ids.slice(1)]},{...base,ids:null},{...base,expected:[]},{...base,kind:'orders'}])await assert.rejects(save(p));
    assert.deepEqual(await get('products'),before);
    const next=(await save(payload('products',before))).items;
    await assert.rejects(save(payload('products',before,[...base.ids.slice(1),base.ids[0]])),/changed|within each category/);
    assert.deepEqual(await get('products'),next);
  })();
  await check('catalog order: categories reorder independently and appear in shop order',async()=>{
    const before=await get('products');
    const result=await save(payload('categories',categories));
    assert.deepEqual(result.items.map(x=>x.id),categories.map(x=>x.id).reverse());
    assert.deepEqual((await h.api('catalog')).categories.map(x=>x.id),result.items.map(x=>x.id));
    assert.deepEqual((await get('products')).sort((a,b)=>a.id.localeCompare(b.id)),[...before].sort((a,b)=>a.id.localeCompare(b.id)));
    const shop=await h.api('catalog');
    assert.deepEqual(shop.products.map(x=>x.id),orderedCatalogProducts(before,result.items).filter(x=>x.active).map(x=>x.id));
    for(const category of result.items)assert.deepEqual(shop.products.filter(x=>x.category_id===category.id).map(x=>x.id),before.filter(x=>x.active&&x.category_id===category.id).map(x=>x.id));
    categories=result.items;
  })();
  await check('catalog order: normal edits keep saved positions and new entries append',async()=>{
    const existing=(await get('products'))[0];
    const edited=await h.api('save_product',{product:{...existing,name:'Edited without moving',sort_order:999},preserve_order:true},h.ids.owner);
    assert.equal(edited.sort_order,existing.sort_order);
    const max=Math.max(...(await get('products')).map(x=>x.sort_order||0));
    const added=await h.api('save_product',{product:{...existing,id:randomUUID(),name:'Appended product',sort_order:0},preserve_order:true},h.ids.owner);
    assert.equal(added.sort_order,max+1);
    const category=categories[0];
    const changed=await h.api('save_category',{category:{id:category.id,name:'Renamed category'},preserve_order:true},h.ids.owner);
    assert.equal(changed.sort_order,category.sort_order);
    const addedCategory=await h.api('save_category',{category:{name:'Appended category'},preserve_order:true},h.ids.owner);
    assert.equal(addedCategory.sort_order,Math.max(...categories.map(x=>x.sort_order))+1);
  })();
  await check('catalog order: a newly added item makes an old list stale',async()=>{
    const before=await get('products');await h.product();
    await assert.rejects(save(payload('products',before)),/catalog changed/);
  })();
}
