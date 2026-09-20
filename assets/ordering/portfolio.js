import { config } from './config.js';
import { safePhotoUrl } from './gallery-import.js';

const gallery = location.pathname.endsWith('pastries.html') ? 'pastries' : 'custom-orders';
const isPastries = gallery === 'pastries';
const legacy = document.querySelector(gallery === 'pastries' ? '.pastries-db' : '.customorders-db');
const categoryMenu = document.querySelector(gallery === 'pastries' ? '.categories-dropdown' : '.dropdown-customorders');
const oldBlocks = [categoryMenu?.closest('.row'), document.querySelector('.search-customorders')?.closest('.row'), legacy, document.querySelector('.pagination')?.closest('.d-flex')].filter(Boolean);
const root = document.createElement('div'); root.className = 'portfolio';
oldBlocks[0].before(root);
oldBlocks.forEach(element => { element.classList.add('portfolio-legacy'); element.hidden = true; });
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let items = [], categories = [], total = 0, generation = 0, controller;
let query = isPastries ? '' : new URLSearchParams(location.search).get('q')?.slice(0, 120) || '';
let category = new URLSearchParams(location.search).get('category_name') || '';
root.innerHTML = `<form class="portfolio-controls${isPastries ? ' portfolio-controls--pastries' : ''}">${isPastries ? '' : `<label>Find a design<input type="search" name="query" maxlength="120" placeholder="Try Pikachu, Pokémon, or a theme" value="${esc(query)}"></label>`}<label>Category<select name="category"><option value="">All categories</option></select></label>${isPastries ? '' : '<button type="submit">Search</button>'}</form><p class="portfolio-count" role="status" aria-live="polite">Loading photos…</p><div class="${isPastries ? 'portfolio-groups' : 'portfolio-grid'}" data-portfolio-results></div><p class="portfolio-error" role="alert" hidden></p><button class="portfolio-more" type="button" hidden>Load more photos</button><dialog class="portfolio-lightbox" aria-label="Gallery photo"><button type="button" aria-label="Close photo">×</button><img alt=""><p></p></dialog>`;
const $ = selector => root.querySelector(selector);
const form = $('form'), more = $('.portfolio-more'), lightbox = $('dialog'), results = $('[data-portfolio-results]');
async function browse(offset, signal) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/gallery_api`, {
    method: 'POST', headers: { apikey: config.supabasePublishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_action: 'browse', p_payload: { gallery, query, category, offset } }), signal,
  });
  if (!response.ok) throw new Error('The gallery could not be loaded. Please try again.');
  return response.json();
}
function previousGallery() {
  root.remove(); oldBlocks.forEach(element => { element.hidden = false; });
  const script = document.createElement('script'); script.src = `assets/js/${gallery === 'pastries' ? 'pastries' : 'customorders'}.js`; document.body.append(script);
}
function photoCard(item, index) {
  return `<figure class="portfolio-card"><button type="button" data-photo="${index}" aria-label="View ${esc(item.title || item.category + ' design')}"><img src="${esc(safePhotoUrl(item.photo_url))}" alt="${esc(item.title || item.category + ' design')}" width="400" height="400" loading="lazy" decoding="async"></button>${item.title || item.description ? `<figcaption>${item.title ? `<h3>${esc(item.title)}</h3>` : ''}${item.description ? `<p>${esc(item.description)}</p>` : ''}</figcaption>` : ''}</figure>`;
}
function paint() {
  if (isPastries) {
    const groups = new Map(categories.map(name => [name, []]));
    items.forEach((item, index) => {
      if (!groups.has(item.category)) groups.set(item.category, []);
      groups.get(item.category).push(photoCard(item, index));
    });
    results.innerHTML = [...groups].filter(([, photos]) => photos.length).map(([name, photos], index) => `<section class="portfolio-category" aria-labelledby="pastry-category-${index}"><h2 id="pastry-category-${index}">${esc(name)}</h2><div class="portfolio-grid">${photos.join('')}</div></section>`).join('');
    $('.portfolio-count').textContent = total ? `${items.length} photos` : 'No photos in this category.';
  } else {
    results.innerHTML = items.map(photoCard).join('');
    $('.portfolio-count').textContent = total ? `Showing ${items.length} of ${total} ${query ? 'matching ' : ''}photos` : 'No matching photos. Try another keyword or category.';
  }
  more.textContent = 'Load more photos'; more.hidden = isPastries || items.length >= total;
}
async function load(reset = true, initial = false) {
  const current = ++generation; controller?.abort(); controller = new AbortController();
  const activeController = controller;
  let timeout;
  const readPage = offset => {
    clearTimeout(timeout); timeout = setTimeout(() => activeController.abort(), 20000);
    return browse(offset, activeController.signal);
  };
  if (reset) { items = []; results.innerHTML = ''; $('.portfolio-count').textContent = 'Loading photos…'; }
  more.disabled = true; $('.portfolio-error').hidden = true;
  try {
    let result = await readPage(items.length);
    if (current !== generation) return;
    if (!result.enabled) { previousGallery(); return; }
    if (initial && !category) {
      const oldIndex = new URLSearchParams(location.search).get('category');
      if (oldIndex !== null && /^\d+$/.test(oldIndex) && result.categories[Number(oldIndex)]) {
        category = result.categories[Number(oldIndex)]; result = await readPage(0);
      }
    }
    if (current !== generation) return;
    if (isPastries) {
      // Fetch every metadata page before grouping, so a category cannot be cut
      // off by the API's page size. Photo bytes still load lazily as you scroll.
      const allItems = [...result.items];
      while (allItems.length < result.total) {
        const next = await readPage(allItems.length);
        if (current !== generation) return;
        if (!next.enabled || !next.items.length) throw new Error('Gallery changed while loading. Please retry.');
        allItems.push(...next.items);
      }
      items = allItems;
    } else items.push(...result.items);
    total = result.total; categories = result.categories;
    form.elements.category.innerHTML = '<option value="">All categories</option>' + result.categories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    form.elements.category.value = category;
    paint();
  } catch (error) {
    if (current !== generation) return;
    $('.portfolio-error').textContent = 'The photos couldn’t be loaded. Please try again.'; $('.portfolio-error').hidden = false;
    $('.portfolio-count').textContent = items.length ? `${items.length} photos loaded` : '';
    more.hidden = false; more.textContent = 'Try again';
  } finally { clearTimeout(timeout); if (current === generation) more.disabled = false; }
}
function applySearch() {
  query = isPastries ? '' : form.elements.query.value.trim(); category = form.elements.category.value;
  const url = new URL(location.href); url.searchParams.delete('category'); url.searchParams.delete('page');
  for (const [key, value] of [['q', query], ['category_name', category]]) { if (value) url.searchParams.set(key, value); else url.searchParams.delete(key); }
  history.replaceState(null, '', url); void load();
}
form.addEventListener('submit', event => { event.preventDefault(); applySearch(); });
form.elements.category.addEventListener('change', applySearch);
more.addEventListener('click', () => void load(false));
root.addEventListener('click', event => {
  const button = event.target.closest('[data-photo]'); if (!button) return;
  const item = items[Number(button.dataset.photo)];
  const image = lightbox.querySelector('img'); image.src = safePhotoUrl(item.photo_url); image.alt = item.title || `${item.category} design`;
  lightbox.querySelector('p').textContent = [item.title, item.description].filter(Boolean).join(' — ');
  lightbox.showModal();
});
lightbox.querySelector('button').addEventListener('click', () => lightbox.close());
void load(true, true);
