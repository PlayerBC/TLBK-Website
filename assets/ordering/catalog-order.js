import { catalogProductGroups, orderedCatalogProducts } from './catalog-ordering.js?v=multi-category-1';

const grip = '<svg width="16" height="24" viewBox="0 0 16 24" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="5" cy="6" r="1.6"/><circle cx="11" cy="6" r="1.6"/><circle cx="5" cy="12" r="1.6"/><circle cx="11" cy="12" r="1.6"/><circle cx="5" cy="18" r="1.6"/><circle cx="11" cy="18" r="1.6"/></svg>';

// Pointer events support mouse and touch without interfering with page scrolling
// outside the handles. Escape and drops outside the list leave the draft intact.
function bindOrderDrag(list, canMove, onMove, signal) {
  let drag, frame;
  const rows = () => [...list.querySelectorAll('[data-order-item]')];
  function clear() {
    const previous = drag; drag = null; cancelAnimationFrame(frame);
    previous?.ghost?.remove();
    rows().forEach(row => row.classList.remove('catalog-dragging', 'catalog-drop-target'));
    if (previous?.handle.hasPointerCapture(previous.pointerId)) previous.handle.releasePointerCapture(previous.pointerId);
    return previous;
  }
  function target() {
    const box = list.getBoundingClientRect();
    if (drag.x < box.left || drag.x > box.right || drag.y < box.top || drag.y > box.bottom) return null;
    const hit = document.elementFromPoint(drag.x, drag.y)?.closest('[data-order-item]');
    if (hit && list.contains(hit)) return Number(hit.dataset.orderItem);
    return rows().map(row => ({ index: Number(row.dataset.orderItem), distance: Math.abs(drag.y - row.getBoundingClientRect().top - row.offsetHeight / 2) })).sort((a,b) => a.distance-b.distance)[0]?.index ?? null;
  }
  function preview() {
    const to = target();
    rows().forEach(row => row.classList.toggle('catalog-drop-target', Number(row.dataset.orderItem) === to && to !== drag.from));
  }
  function scroll() {
    if (!drag?.ghost) return;
    if (!list.isConnected || !canMove()) { clear(); return; }
    const dialog = list.closest('dialog'), box = dialog.getBoundingClientRect();
    if (drag.y < Math.max(0,box.top)+55) dialog.scrollTop -= 12;
    if (drag.y > Math.min(innerHeight,box.bottom)-55) dialog.scrollTop += 12;
    preview(); frame = requestAnimationFrame(scroll);
  }
  list.addEventListener('pointerdown', event => {
    const handle = event.target.closest('[data-order-handle]');
    if (drag || !event.isPrimary || event.button !== 0 || !handle || handle.disabled || !canMove()) return;
    const row = handle.closest('[data-order-item]'), box = row.getBoundingClientRect();
    drag = { handle, row, from: Number(row.dataset.orderItem), pointerId: event.pointerId, startX:event.clientX, startY:event.clientY, x:event.clientX, y:event.clientY, offsetX:event.clientX-box.x, offsetY:event.clientY-box.y, width:box.width, height:box.height };
    handle.focus({preventScroll:true}); handle.setPointerCapture(event.pointerId);
  }, {signal});
  list.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!canMove()) { clear(); return; }
    drag.x = event.clientX; drag.y = event.clientY;
    if (!drag.ghost && Math.hypot(drag.x-drag.startX,drag.y-drag.startY)<6) return;
    event.preventDefault();
    if (!drag.ghost) {
      drag.ghost = drag.row.cloneNode(true); drag.ghost.removeAttribute('data-order-item');
      drag.ghost.className = 'catalog-order-row catalog-order-ghost'; drag.ghost.setAttribute('aria-hidden','true');
      drag.ghost.querySelectorAll('button').forEach(b => { b.disabled=true; b.tabIndex=-1; });
      drag.ghost.style.width = `${drag.width}px`; drag.ghost.style.height = `${drag.height}px`;
      list.closest('dialog').append(drag.ghost); drag.row.classList.add('catalog-dragging');
      frame = requestAnimationFrame(scroll);
    }
    drag.ghost.style.left = `${drag.x-drag.offsetX}px`; drag.ghost.style.top = `${drag.y-drag.offsetY}px`; preview();
  }, {signal});
  list.addEventListener('pointerup', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.x=event.clientX; drag.y=event.clientY;
    const to=target(), previous=clear();
    if (previous.ghost && to!==null && to!==previous.from && canMove()) { event.preventDefault(); onMove(previous.from,to); }
  }, {signal});
  for (const type of ['pointercancel','lostpointercapture']) list.addEventListener(type,event => { if (event.pointerId===drag?.pointerId) clear(); },{signal});
  list.addEventListener('keydown', event => {
    if (event.key==='Escape' && drag) { event.preventDefault(); event.stopPropagation(); clear(); return; }
    const handle=event.target.closest('[data-order-handle]');
    if (!handle || handle.disabled || !canMove() || drag || event.altKey || event.ctrlKey || event.metaKey) return;
    const from=Number(handle.dataset.orderHandle), last=rows().length-1;
    const destination={ArrowUp:from-1,ArrowLeft:from-1,ArrowDown:from+1,ArrowRight:from+1,Home:0,End:last};
    if (!Object.hasOwn(destination,event.key)) return;
    event.preventDefault(); const to=Math.max(0,Math.min(last,destination[event.key]));
    if (to!==from) onMove(from,to);
  }, {signal});
  list.addEventListener('dragstart', event => event.preventDefault(), {signal});
  signal.addEventListener('abort',clear,{once:true});
}

export function mountCatalogOrder(root, { kind, items, categories, editable, api, escapeHtml:esc, safeImage, onSaved }) {
  if (kind==='products') items=orderedCatalogProducts(items,categories);
  let saved=structuredClone(items), draft=structuredClone(items), busy=false;
  const lifecycle=new AbortController(), signal=lifecycle.signal;
  const product=kind==='products';
  const groups=product?catalogProductGroups(items,categories):[{id:'categories',name:'Categories',items}];
  const initialOrder=()=>groups.map(group=>group.items.map(item=>item.id));
  let savedGroupOrders=initialOrder(), draftGroupOrders=structuredClone(savedGroupOrders);
  const changed=()=>product
    ? draftGroupOrders.some((ids,i)=>ids.some((id,j)=>id!==savedGroupOrders[i][j]))
    : draft.some((item,i)=>item.id!==saved[i]?.id);
  const snapshot=()=>saved.map(item=>product
    ? {id:item.id,sort_order:item.sort_order||0,category_ids:item.category_ids|| (item.category_id?[item.category_id]:[]),category_sort_orders:item.category_sort_orders||{}}
    : {id:item.id,sort_order:item.sort_order||0});
  root.innerHTML=`<p class="muted" id="catalog-order-help">${editable ? 'Drag the six-dot handles to rearrange. On a keyboard, use the arrow keys. Save the order when finished.' : 'Only an owner can rearrange this list.'}</p>${product ? '<p class="help-text">Drag products within their category. The shop shows categories in your chosen category order, with Uncategorized last. Hidden products keep their place.</p>' : ''}<div data-order-lists></div><p role="status" aria-live="polite" data-order-status></p><div class="catalog-order-actions dialog-actions">${product?'':`<button type="button" class="button button-secondary" data-action="new-category" ${editable?'':'disabled'}>+ Add category</button>`}<button type="button" class="button button-secondary" data-action="close-dialog">Done</button><button type="button" class="button button-secondary" data-order-reset disabled>Reset order</button><button type="button" class="button" data-order-save disabled>Save order</button></div>`;
  const container=root.querySelector('[data-order-lists]'), status=root.querySelector('[data-order-status]');
  container.innerHTML=groups.map((group,i)=>`<section class="catalog-order-group" data-order-group="${i}">${product?`<h3>${esc(group.name)}</h3>`:''}<div class="catalog-order-list" role="list" aria-label="${esc(group.name)} order"></div></section>`).join('')||'<p class="muted">Add products to your menu to arrange them here.</p>';
  const groupItems=(group,gi)=>product
    ? draftGroupOrders[gi].map(id=>draft.find(item=>item.id===id))
    : draft.filter(item=>group.items.some(original=>original.id===item.id));
  function controls() {
    root.dataset.dirty=String(changed()); root.dataset.busy=String(busy);
    root.querySelectorAll('button').forEach(b=>{b.disabled=busy || (!editable && b.dataset.action!=='close-dialog');});
    groups.forEach((group,gi)=>container.querySelectorAll(`[data-order-group="${gi}"] [data-order-handle]`).forEach(b=>{b.disabled=busy || !editable || group.items.length<2;}));
    root.querySelector('[data-order-save]').disabled=busy || !editable || !changed();
    root.querySelector('[data-order-reset]').disabled=busy || !changed();
    root.querySelector('[data-order-save]').textContent=busy?'Saving...':'Save order';
  }
  function paint() {
    groups.forEach((group,gi)=>{
    const list=container.querySelector(`[data-order-group="${gi}"] .catalog-order-list`), rows=groupItems(group,gi);
    list.innerHTML=rows.map((item,i)=>`<div class="catalog-order-row" role="listitem" data-order-item="${i}" data-order-id="${esc(item.id)}"><button type="button" class="catalog-order-handle" data-order-handle="${i}" aria-label="Move ${esc(item.name)}, position ${i+1} of ${rows.length}" aria-describedby="catalog-order-help">${grip}</button>${product?`<div class="catalog-order-photo">${safeImage(item.photos?.[0])?`<img src="${esc(safeImage(item.photos[0]))}" alt="" draggable="false">`:'<span aria-hidden="true">&#9825;</span>'}</div>`:''}<div class="catalog-order-name"><strong>${esc(item.name)}</strong>${product?`<small>${esc(categories.find(c=>c.id===item.category_id)?.name||'Uncategorized')}${item.active?'':' · Hidden'}</small>`:''}</div>${product?'':`<button type="button" class="table-link" data-action="edit-category" data-id="${esc(item.id)}">Edit</button>`}</div>`).join('')||`<p class="muted">${product?'Add products to your menu to arrange them here.':'Add categories to organize your menu.'}</p>`;
    });
    controls();
  }
  groups.forEach((group,gi)=>{
  const list=container.querySelector(`[data-order-group="${gi}"] .catalog-order-list`);
  bindOrderDrag(list,()=>editable && !busy,(from,to)=>{
    const rows=groupItems(group,gi), item=rows[from];
    if (product) {
      draftGroupOrders[gi].splice(from,1);
      draftGroupOrders[gi].splice(to,0,item.id);
    } else {
      const source=draft.indexOf(item), target=draft.indexOf(rows[to]);
      draft.splice(source,1); draft.splice(target,0,item);
    }
    paint();
    status.className='muted'; status.textContent=`${item.name} moved to position ${to+1}. ${changed()?'Save order to publish your changes.':'The saved order is restored.'}`;
    const handle=list.querySelector(`[data-order-handle="${to}"]`); handle.focus({preventScroll:true}); handle.scrollIntoView({block:'nearest'});
  },signal);
  });
  root.addEventListener('click',async event=>{
    const button=event.target.closest('[data-order-save],[data-order-reset]'); if (!button || busy) return;
    if (button.hasAttribute('data-order-reset')) { draft=structuredClone(saved); draftGroupOrders=structuredClone(savedGroupOrders); paint(); status.className='muted'; status.textContent='Saved order restored.'; return; }
    if (!editable || !changed()) return;
    busy=true; controls(); status.className='muted'; status.textContent='Saving order...';
    try {
      const result=product
        ? await api('reorder_product_categories',{groups:groups.map((group,i)=>({category_id:group.id||null,ids:draftGroupOrders[i]})),expected:snapshot()})
        : await api('reorder_catalog',{kind,ids:draft.map(item=>item.id),expected:snapshot()});
      saved=structuredClone(result.items); draft=structuredClone(result.items);
      if (product) { savedGroupOrders=groups.map(group=>catalogProductGroups(saved,categories).find(next=>next.id===group.id)?.items.map(item=>item.id)||[]); draftGroupOrders=structuredClone(savedGroupOrders); }
      paint();
      onSaved(result.items); status.className='notice'; status.textContent='Order saved. Your shop now uses this order.';
    } catch(error) { status.className='notice danger'; status.textContent=`${error.message||'Order could not save.'} Your changes are still here.`; }
    finally { busy=false; controls(); }
  },{signal});
  paint();
  return {
    get dirty(){return changed();}, get busy(){return busy;},
    canLeave(){if(busy){status.textContent='Please wait for the order to finish saving.';return false;}return !changed()||confirm('Discard your unsaved order changes?');},
    destroy(){lifecycle.abort();},
  };
}
