// Category order controls the sections; products have a separate position in each.
const byPosition = (a,b) => (a.sort_order||0)-(b.sort_order||0) || a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id));

export function productCategoryIds(product, categories) {
  const known = new Set(categories.map(category => category.id));
  const assigned = Array.isArray(product.category_ids) ? product.category_ids : [product.category_id];
  return [...new Set(assigned)].filter(id => typeof id === 'string' && known.has(id));
}

export function catalogProductGroups(products, categories) {
  const groups=[...categories].sort(byPosition).map(category=>({id:category.id,name:category.name,items:[]}));
  const uncategorized={id:'',name:'Uncategorized',items:[]};
  const byId=new Map(groups.map(group=>[group.id,group]));
  for (const product of products) {
    const ids=productCategoryIds(product,categories);
    if (!ids.length) uncategorized.items.push(product);
    else for (const id of ids) byId.get(id).items.push(product);
  }
  return [...groups,uncategorized].filter(group=>group.items.length).map(group=>({
    ...group,items:group.items.sort((a,b)=>
      (Number(a.category_sort_orders?.[group.id] ?? a.sort_order)||0)-(Number(b.category_sort_orders?.[group.id] ?? b.sort_order)||0)
      || a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id)))
  }));
}

// Admin lists keep one row per real product, even when it is in several sections.
export function orderedCatalogProducts(products,categories) {
  const seen=new Set();
  return catalogProductGroups(products,categories).flatMap(group=>group.items).filter(product=>{
    if (seen.has(product.id)) return false;
    seen.add(product.id);return true;
  });
}
