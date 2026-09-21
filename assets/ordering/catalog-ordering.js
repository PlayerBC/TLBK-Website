// Categories define the menu sections; each section retains its own product order.
const byPosition = (a,b) => (a.sort_order||0)-(b.sort_order||0) || a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id));
export function catalogProductGroups(products, categories) {
  const groups=[...categories].sort(byPosition).map(category=>({id:category.id,name:category.name,items:[]}));
  const uncategorized={id:'',name:'Uncategorized',items:[]};
  const byId=new Map(groups.map(group=>[group.id,group]));
  for(const product of products) (byId.get(product.category_id)||uncategorized).items.push(product);
  return [...groups,uncategorized].filter(group=>group.items.length).map(group=>({...group,items:group.items.sort(byPosition)}));
}
export const orderedCatalogProducts = (products,categories) => catalogProductGroups(products,categories).flatMap(group=>group.items);
