import { config } from './config.js';
import { safePhotoUrl } from './gallery-import.js';

const gallery = location.pathname.endsWith('pastries.html') ? 'pastries' : 'custom-orders';
const legacy = document.querySelector(gallery === 'pastries' ? '.pastries-db' : '.customorders-db');
const categoryMenu = document.querySelector(gallery === 'pastries' ? '.categories-dropdown' : '.dropdown-customorders');
const oldBlocks = [categoryMenu?.closest('.row'), document.querySelector('.search-customorders')?.closest('.row'), legacy, document.querySelector('.pagination')?.closest('.d-flex')].filter(Boolean);
const root = document.createElement('div'); root.className = 'portfolio';
oldBlocks[0].before(root);
oldBlocks.forEach(element => { element.classList.add('portfolio-legacy'); element.hidden = true; });
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let items = [], total = 0, generation = 0, controller;
let query = new URLSearchParams(location.search).get('q')?.slice(0, 120) || '';
let category = new URLSearchParams(location.search).get('category_name') || '';
root.innerHTML = `<form class="portfolio-controls"><label>${gallery === 'pastries' ? 'Find pastries' : 'Find a design'}<input type="search" name="query" maxlength="120" placeholder="Try Pikachu, Pokémon, or a theme" value="${esc(query)}"></label><label>Category<select name="category"><option value="">All categories</option></select></label><button type="submit">Search</button></form><p class="portfolio-count" role="status" aria-live="polite">Loading photos…</p><div class="portfolio-grid"></div><p class="portfolio-error" role="alert" hidden></p><button class="portfolio-more" type="button" hidden>Load more photos</button><dialog class="portfolio-lightbox" aria-label="Gallery photo"><button type="button" aria-label="Close photo">×</button><img alt=""><p></p></dialog>`;
const $ = selector => root.querySelector(selector);
const form = $('form'), more = $('.portfolio-more'), lightbox = $('dialog');
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
function paint() {
  $('.portfolio-grid').innerHTML = items.map((item, index) => `<figure class="portfolio-card"><button type="button" data-photo="${index}" aria-label="View ${esc(item.title || item.category + ' design')}"><img src="${esc(safePhotoUrl(item.photo_url))}" alt="${esc(item.title || item.category + ' design')}" width="400" height="400" loading="lazy" decoding="async"></button>${item.title || item.description ? `<figcaption>${item.title ? `<h3>${esc(item.title)}</h3>` : ''}${item.description ? `<p>${esc(item.description)}</p>` : ''}</figcaption>` : ''}</figure>`).join('');
  $('.portfolio-count').textContent = total ? `Showing ${items.length} of ${total} ${query ? 'matching ' : ''}photos` : 'No matching photos. Try another keyword or category.';
  more.textContent = 'Load more photos'; more.hidden = items.length >= total;
}
async function load(reset = true, initial = false) {
  const current = ++generation; controller?.abort(); controller = new AbortController();
  const activeController = controller;
  const timeout = setTimeout(() => activeController.abort(), 20000);
  if (reset) { items = []; $('.portfolio-grid').innerHTML = ''; $('.portfolio-count').textContent = 'Loading photos…'; }
  more.disabled = true; $('.portfolio-error').hidden = true;
  try {
    let result = await browse(items.length, controller.signal);
    if (current !== generation) return;
    if (!result.enabled) { previousGallery(); return; }
    if (initial && !category) {
      const oldIndex = new URLSearchParams(location.search).get('category');
      if (oldIndex !== null && /^\d+$/.test(oldIndex) && result.categories[Number(oldIndex)]) {
        category = result.categories[Number(oldIndex)]; result = await browse(0, controller.signal);
      }
    }
    if (current !== generation) return;
    items.push(...result.items); total = result.total;
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
  query = form.elements.query.value.trim(); category = form.elements.category.value;
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
