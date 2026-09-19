import { escapeHtml as esc, money, formatDate } from './client.js?v=visitors-1';

const label = value => String(value || '').replaceAll('_', ' ').replace(/^\w/, c => c.toUpperCase());
const text = value => String(value ?? '').trim();
const lines = values => values.map(text).filter(Boolean).join('\n');
const previewUrl = new URL('./order-print.html?v=batch-slips-1', import.meta.url).href;

function photoUrl(value) {
  if (typeof value !== 'string' || !(/^(https?:\/\/|assets\/)/.test(value))) return '';
  return new URL(value, document.baseURI).href;
}

function variations(item, product) {
  if (Array.isArray(item.selection_labels) && item.selection_labels.length) {
    return item.selection_labels.map(choice => typeof choice === 'string' ? choice :
      `${choice.group ? choice.group + ': ' : ''}${Number(choice.quantity || choice.count) > 1 ? `${choice.quantity || choice.count} × ` : ''}${choice.label || choice.name || ''}`).join(' · ');
  }
  return Object.entries(item.selections || {}).flatMap(([groupId, choices]) => Object.entries(choices)
    .filter(([, count]) => Number(count) > 0).map(([choiceId, count]) => {
      const group = product?.option_groups?.find(entry => entry.id === groupId);
      const choice = group?.choices?.find(entry => entry.id === choiceId);
      return `${group?.label ? group.label + ': ' : ''}${count > 1 ? `${count} × ` : ''}${choice?.label || choiceId}`;
    })).join(' · ');
}

// Only fields intended for the package are copied into the print document.
// Prices and labels come from the saved order; catalog data supplies its current photo.
function printModel(order, products, settings) {
  const pickup = order.method === 'pickup';
  const buyer = order.buyer || {};
  const social = buyer.social_platform === 'na' ? 'Social contact: N/A' :
    buyer.social_username ? `${label(buyer.social_platform) || 'Social contact'}: ${buyer.social_username}` : 'Social contact: Not recorded';
  const details = [];
  details.push({ title: pickup ? 'Pickup details' : 'Deliver to', value: pickup ? lines([
    `Collector: ${buyer.name || 'Not recorded'}`, order.pickup_address ?? settings.pickup_address,
    order.pickup_hours ?? settings.pickup_hours,
  ]) : lines([
    [order.recipient?.name, order.recipient?.phone].filter(Boolean).join(' | '),
    order.address?.line1, order.address?.line2, [order.address?.locality, order.address?.postal_code].filter(Boolean).join(' '),
  ]) || 'Not recorded' });
  details.push({ title: 'Instructions', value: text(order.instructions) || 'None' });
  const status = [order.refund_label ? 'Refund label' : '', ['cancelled', 'expired'].includes(order.fulfillment_status) ? label(order.fulfillment_status) : '', `Payment: ${label(order.payment_status) || 'Not recorded'}`].filter(Boolean).join(' | ');
  return {
    shop: text(settings.shop_name) || 'The Little Baker Kitchen', reference: text(order.reference) || 'Order',
    date: formatDate(order.fulfillment_date), method: pickup ? 'Pickup' : 'Delivery', status,
    window: text(pickup ? order.pickup_hours ?? settings.pickup_hours : order.delivery_window ?? settings.delivery_window),
    buyer: { name: text(buyer.name) || 'Not recorded', phone: text(buyer.phone) || 'Not recorded', social }, details,
    items: (order.items || []).map((item, index) => {
      const product = products.find(entry => entry.id === item.product_id);
      return { index, name: text(item.name) || product?.name || 'Product', quantity: item.quantity,
        variation: variations(item, product) || 'Standard', photo: photoUrl(product?.photos?.[0]),
        unit: money(item.unit_price_cents), total: money(item.line_total_cents ?? item.quantity * item.unit_price_cents) };
    }),
    subtotal: money(order.subtotal_cents), discount: money(order.discount_cents), fee: money(order.delivery_cents),
    total: money(order.total_cents), promo: text(order.promo_snapshot?.code),
  };
}

function element(doc, html) {
  const template = doc.createElement('template');
  template.innerHTML = html;
  return template.content.firstElementChild;
}

function createSlip(doc, model) {
  return element(doc, `<article class="slip" data-order-reference="${esc(model.reference)}">
    <header class="slip-header"><p class="slip-brand">${esc(model.shop)}</p><h1 class="slip-reference">${esc(model.reference)}</h1>
      <p class="slip-method">${esc(model.method.toUpperCase())}</p><p class="slip-date">${esc(model.date)}${model.window ? ` | ${esc(model.window)}` : ''}</p><p class="slip-state">${esc(model.status)}</p></header>
    <div class="slip-body"><div class="slip-left"><h2 class="slip-heading slip-item-heading">Items to prepare</h2><div class="slip-items"></div></div>
      <div class="slip-right"><section class="slip-buyer"><h2 class="slip-heading">Buyer</h2><p class="slip-buyer-name">${esc(model.buyer.name)}</p><p class="slip-buyer-phone">${esc(model.buyer.phone)}</p><p class="slip-buyer-social">${esc(model.buyer.social)}</p></section><div class="slip-details"></div><p class="slip-signoff">Prepared: ______ &nbsp; Checked: ______</p></div></div>
    <footer class="slip-footer"><span class="slip-number">Slip 000 of 000</span><span>Keep all slips with this order</span></footer></article>`);
}

function itemCard(doc, item, value, continued = false) {
  return element(doc, `<section class="slip-item" data-item-index="${item.index}" data-continued="${continued}">
    <div class="slip-photo">${!continued && item.photo ? `<img src="${esc(item.photo)}" alt="${esc(item.name)}" referrerpolicy="no-referrer">` : continued ? 'Options continued' : 'No photo'}</div>
    <div class="slip-item-copy"><h3 class="slip-item-title">${continued ? `<span class="slip-continuation">Item ${item.index + 1} continued</span>` : `<span class="slip-quantity">${esc(item.quantity)}×</span>${esc(item.name)}`}</h3>
    <p class="slip-variation">${esc(value)}</p>${continued ? '' : `<p class="slip-price"><span>${esc(item.quantity)} × ${esc(item.unit)}</span><strong>${esc(item.total)}</strong></p>`}</div></section>`);
}

function detailCard(doc, title, value, continued = false) {
  return element(doc, `<section class="slip-detail"><h2 class="slip-heading">${esc(title)}${continued ? ' (continued)' : ''}</h2><p>${esc(value)}</p></section>`);
}

function paymentCard(doc, model) {
  return element(doc, `<section class="slip-payment"><h2 class="slip-heading">Payment breakdown - entire order</h2><dl>
    <div><dt>Subtotal</dt><dd>${esc(model.subtotal)}</dd></div><div><dt>Discount${model.promo ? ` (${esc(model.promo)})` : ''}</dt><dd>−${esc(model.discount)}</dd></div>
    <div><dt>${model.method === 'Pickup' ? 'Pickup' : 'Delivery'} fee</dt><dd>${esc(model.fee)}</dd></div><div class="slip-total"><dt>Order total</dt><dd>${esc(model.total)}</dd></div></dl></section>`);
}

const fits = column => column.scrollHeight <= column.clientHeight + 1;

// Measure real wrapping at the physical print size. Extra-long option lists and
// instructions split at a word boundary; all characters are retained on later slips.
function appendText(pages, getPage, selector, make, value) {
  let remaining = String(value), continued = false;
  while (remaining) {
    let page = pages.at(-1), column = page.querySelector(selector);
    let block = make(remaining, continued);
    column.append(block);
    if (fits(selector === '.slip-items' ? page.querySelector('.slip-left') : column)) return;
    block.remove();
    if (column.children.length) {
      page = getPage(); column = page.querySelector(selector);
      block = make(remaining, continued); column.append(block);
      if (fits(selector === '.slip-items' ? page.querySelector('.slip-left') : column)) return;
      block.remove();
    }
    let low = 0, high = remaining.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      block = make(remaining.slice(0, middle), continued); column.append(block);
      const fit = fits(selector === '.slip-items' ? page.querySelector('.slip-left') : column);
      block.remove();
      if (fit) low = middle; else high = middle - 1;
    }
    if (!low) throw new Error('These order details cannot fit on a 5 × 4 inch slip. Please check the order details and try again.');
    const boundary = remaining.lastIndexOf(' ', low - 1);
    if (boundary > low / 2) low = boundary + 1;
    // Do not split a Unicode surrogate pair at the page boundary.
    if (/[\uD800-\uDBFF]/.test(remaining[low - 1])) low--;
    column.append(make(remaining.slice(0, low), continued));
    remaining = remaining.slice(low); continued = true;
    if (remaining) getPage();
  }
}

function paginate(doc, model) {
  const host = doc.querySelector('#slips');
  const pages = [];
  const newPage = () => { const page = createSlip(doc, model); host.append(page); pages.push(page); return page; };
  newPage();
  for (const item of model.items) appendText(pages, newPage, '.slip-items', (value, continued) => itemCard(doc, item, value, continued), item.variation);
  let last = pages.at(-1), payment = paymentCard(doc, model);
  last.querySelector('.slip-left').append(payment);
  if (!fits(last.querySelector('.slip-left'))) {
    payment.remove(); last = newPage(); last.querySelector('.slip-left').append(payment);
  }
  const detailPages = [pages[0]];
  const nextDetails = () => {
    const page = pages[detailPages.length] || newPage(); detailPages.push(page); return page;
  };
  for (const detail of model.details) appendText(detailPages, nextDetails, '.slip-details', (value, continued) => detailCard(doc, detail.title, value, continued), detail.value);
  // Repeat the complete address/instructions when they fit on one slip; otherwise
  // continue them across the numbered slips, with buyer and reference on every page.
  if (detailPages.length === 1) {
    for (const page of pages.slice(1)) page.querySelector('.slip-details').innerHTML = pages[0].querySelector('.slip-details').innerHTML;
  }
  // The complete payment breakdown always belongs to the final slip, even when
  // additional pages were needed only for delivery details or instructions.
  if (payment.closest('.slip') !== pages.at(-1)) {
    payment.remove(); pages.at(-1).querySelector('.slip-left').append(payment);
  }
  pages.forEach((page, index) => {
    page.querySelector('.slip-number').textContent = `Slip ${index + 1} of ${pages.length}`;
    const cards = [...page.querySelectorAll('.slip-item')];
    page.querySelector('.slip-item-heading').textContent = cards.length ? `Items ${Number(cards[0].dataset.itemIndex) + 1}-${Number(cards.at(-1).dataset.itemIndex) + 1} of ${model.items.length}` : 'Order details';
    if (index < pages.length - 1) page.querySelector('.slip-item-heading').append(` | Totals on slip ${pages.length}`);
    if (!fits(page.querySelector('.slip-left')) || !fits(page.querySelector('.slip-details')) || page.scrollHeight > page.clientHeight + 1) {
      throw new Error('These order details cannot fit on a 5 × 4 inch slip. Please check the order details and try again.');
    }
  });
  return pages;
}

async function readyImages(doc) {
  await Promise.all([...doc.images].map(img => new Promise(resolve => {
    let timer;
    const done = () => {
      clearTimeout(timer); img.removeEventListener('load', done); img.removeEventListener('error', done);
      if (!img.complete || !img.naturalWidth) img.parentElement.textContent = 'Photo unavailable';
      resolve();
    };
    if (img.complete) return done();
    img.addEventListener('load', done); img.addEventListener('error', done);
    timer = setTimeout(done, 8000);
  })));
}

function waitForPreview(preview) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      try {
        if (preview.closed) { clearInterval(timer); resolve(null); return; }
        if (preview.location.href === previewUrl && preview.document.readyState === 'complete') {
          clearInterval(timer); resolve(preview.document);
        } else if (Date.now() - start > 10000) {
          throw new Error('The print preview could not load. Close it and try printing again.');
        }
      } catch (error) {
        clearInterval(timer); reject(error);
      }
    }, 50);
  });
}

function arrangeSheets(doc, slips, paper) {
  const host = doc.querySelector('#slips');
  host.replaceChildren();
  doc.querySelector('#paper-style').textContent = `@page{size:${paper === 'letter' ? 'Letter' : 'A4'} landscape;margin:0}`;
  for (let index = 0; index < slips.length; index += 4) {
    const sheet = doc.createElement('section');
    sheet.className = 'print-sheet';
    sheet.dataset.paper = paper;
    sheet.setAttribute('aria-label', `Sheet ${index / 4 + 1}`);
    sheet.append(...slips.slice(index, index + 4));
    host.append(sheet);
  }
}

// Opening the tab happens synchronously on the click, before optional batch
// loading. This avoids popup blocking while each selected saved order is fetched.
export async function printOrderSlips(source, { products = [], settings = {} } = {}) {
  const preview = window.open(previewUrl, '_blank');
  if (!preview) throw new Error('Allow pop-ups for this site, then try printing again.');
  let doc;
  try {
    doc = await waitForPreview(preview);
    if (!doc) return;
    const button = doc.querySelector('.print-slips'), status = doc.querySelector('[role="status"]');
    const paperChoice = doc.querySelector('#paper-size');
    if (!button || !status || !paperChoice) throw new Error('The print preview could not load. Close it and try printing again.');
    doc.querySelector('.close-preview').addEventListener('click', () => preview.close());
    if (preview.getComputedStyle(doc.documentElement).getPropertyValue('--order-slip-layout').trim() !== 'ready') {
      throw new Error('The print layout could not load. Close this preview and try again.');
    }
    status.textContent = 'Loading selected orders…';
    const loaded = typeof source === 'function' ? await source() : source;
    const orders = Array.isArray(loaded) ? loaded : [loaded];
    if (!orders.length || orders.some(order => !order)) throw new Error('No orders are available to print. Select your orders and try again.');
    if (preview.closed) return;
    const models = orders.map(order => printModel(order, products, settings));
    doc.title = `${models.length === 1 ? models[0].reference : `${models.length} orders`} - preparation slips`;
    status.textContent = 'Preparing order slips…';
    const slips = models.flatMap(model => paginate(doc, model));
    await readyImages(doc);
    if (preview.closed) return;
    try { if (localStorage.getItem('order-slip-paper') === 'letter') paperChoice.value = 'letter'; } catch { /* Paper choice remains available without storage. */ }
    const resize = () => doc.documentElement.style.setProperty('--preview-scale', Math.min(1, Math.max(.1, (preview.innerWidth - 24) / ((paperChoice.value === 'letter' ? 279.4 : 297) * 96 / 25.4))));
    const arrange = () => {
      const paper = paperChoice.value === 'letter' ? 'letter' : 'a4';
      arrangeSheets(doc, slips, paper); resize();
      const count = Math.ceil(slips.length / 4);
      status.textContent = `${orders.length} order${orders.length === 1 ? '' : 's'} · ${slips.length} slip${slips.length === 1 ? '' : 's'} · ${count} sheet${count === 1 ? '' : 's'}. Slips are 5″ wide × 4″ high. Choose matching paper in the print dialog, landscape, Actual size / 100%, with headers and footers off.`;
    };
    arrange(); preview.addEventListener('resize', resize);
    paperChoice.addEventListener('change', () => {
      arrange();
      try { localStorage.setItem('order-slip-paper', paperChoice.value); } catch { /* Preferences are optional. */ }
    });
    button.textContent = `Print ${orders.length === 1 ? 'order' : `${orders.length} orders`}`;
    button.disabled = false;
    paperChoice.disabled = false;
    button.addEventListener('click', () => { preview.focus(); preview.print(); });
    preview.focus();
  } catch (error) {
    if (!preview.closed && doc) {
      doc.querySelector('#slips')?.replaceChildren();
      const status = doc.querySelector('[role="status"]');
      if (status) status.textContent = error.message;
    }
    throw error;
  }
}
