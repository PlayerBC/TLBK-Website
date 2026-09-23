import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { catalogProductGroups, orderedCatalogProducts } from '../../assets/ordering/catalog-ordering.js';

export default async function({db,check,state}) {
  const h=state.harness;
  let first,second,left,right;
  const catalog=()=>h.api('admin_bootstrap',{},h.ids.owner);
  const payload=data=>({
    groups:catalogProductGroups(data.products,data.categories).map(group=>({category_id:group.id||null,ids:group.items.map(item=>item.id)})),
    expected:data.products.map(item=>({id:item.id,category_ids:item.category_ids||[],sort_order:item.sort_order||0,category_sort_orders:item.category_sort_orders||{}})),
  });
  await check('multi-category: a product is one record displayed in every selected section',async()=>{
    left=await h.api('save_category',{category:{name:'Multi left',sort_order:100}},h.ids.owner);
    right=await h.api('save_category',{category:{name:'Multi right',sort_order:101}},h.ids.owner);
    first=await h.product({name:'Shared first',category_ids:[left.id,right.id],category_id:left.id});
    second=await h.product({name:'Shared second',category_ids:[left.id,right.id],category_id:left.id});
    assert.deepEqual(first.category_ids,[left.id,right.id]);
    assert.equal(first.category_id,left.id);
    const shop=await h.api('catalog');
    const groups=catalogProductGroups(shop.products,shop.categories);
    assert.deepEqual(groups.find(x=>x.id===left.id).items.filter(x=>[first.id,second.id].includes(x.id)).map(x=>x.id),[first.id,second.id]);
    assert.deepEqual(groups.find(x=>x.id===right.id).items.filter(x=>[first.id,second.id].includes(x.id)).map(x=>x.id),[first.id,second.id]);
    assert.equal(shop.products.filter(x=>x.id===first.id).length,1);
    assert.equal(orderedCatalogProducts(shop.products,shop.categories).filter(x=>x.id===first.id).length,1);
  })();
  await check('multi-category: each section can save a different product order',async()=>{
    const data=await catalog(),p=payload(data);
    for(const group of p.groups.filter(x=>[left.id,right.id].includes(x.category_id))) {
      const other=group.ids.filter(id=>id!==first.id&&id!==second.id);
      group.ids=group.category_id===left.id?[second.id,first.id,...other]:[first.id,second.id,...other];
    }
    const result=await h.api('reorder_product_categories',p,h.ids.owner);
    const groups=catalogProductGroups(result.items,data.categories);
    assert.deepEqual(groups.find(x=>x.id===left.id).items.slice(0,2).map(x=>x.id),[second.id,first.id]);
    assert.deepEqual(groups.find(x=>x.id===right.id).items.slice(0,2).map(x=>x.id),[first.id,second.id]);
    assert.equal(result.items.filter(x=>x.id===first.id).length,1);
  })();
  await check('multi-category: stale and unauthorized changes cannot alter saved order',async()=>{
    const data=await catalog(),p=payload(data);
    for(const user of [null,h.ids.staff,h.ids.customer,h.ids.unverified])
      await assert.rejects(h.api('reorder_product_categories',p,user),/owner|verified|staff|sign in/i);
    await assert.rejects(h.as(h.ids.owner,()=>db.query("select tlb.reorder_product_categories('[]','[]')")) ,/permission denied/);
    const bad=structuredClone(p);bad.groups.find(x=>x.category_id===left.id).ids.pop();
    await assert.rejects(h.api('reorder_product_categories',bad,h.ids.owner),/catalog changed/);
    const stale=structuredClone(p);stale.expected[0].sort_order=-1;
    await assert.rejects(h.api('reorder_product_categories',stale,h.ids.owner),/order changed/);
  })();
  await check('multi-category: edits and category deletion keep the remaining assignment',async()=>{
    const before=await catalog(),saved=before.products.find(x=>x.id===first.id);
    const edited=await h.api('save_product',{product:{...saved,name:'Shared first edited'},preserve_order:true},h.ids.owner);
    assert.deepEqual(edited.category_ids,[left.id,right.id]);
    assert.deepEqual(edited.category_sort_orders,saved.category_sort_orders);
    await h.api('delete_category',{id:left.id},h.ids.owner);
    const after=(await catalog()).products.find(x=>x.id===first.id);
    assert.deepEqual(after.category_ids,[right.id]);
    assert.equal(after.category_id,right.id);
    assert.deepEqual(Object.keys(after.category_sort_orders),[right.id]);
    assert.equal((await h.api('catalog')).products.filter(x=>x.id===first.id).length,1);
  })();
  await check('multi-category: unknown or duplicate category IDs are rejected',async()=>{
    const base=(await catalog()).products.find(x=>x.id===first.id);
    for(const category_ids of [[right.id,right.id],[randomUUID()]])
      await assert.rejects(h.api('save_product',{product:{...base,category_ids},preserve_order:true},h.ids.owner),/category/i);
    assert.deepEqual((await catalog()).products.find(x=>x.id===first.id).category_ids,[right.id]);
  })();
}
