import { eventPage } from './event-page.js?v=dessert-bar-1';
import { prepareGalleryImage, galleryImageAccept } from './gallery-image.js';
import { bindProductPhotoOrder } from './product-photos.js?v=photo-order-1';
import { packageEscape as esc } from './party-packages-view.js';

export function mountPartyCartPhotos(root, { role, connected, api, upload, page = 'party' }) {
  const service = eventPage(page);
  if (!connected || role !== 'owner') { root.innerHTML = ''; return; }
  let items = [], saved = [], revision, operation, busy = false, dirty = false, loaded = false;
  root.innerHTML = `<section class="panel cart-photo-manager"><div class="section-heading"><div><h2>${service.photoName} photos</h2><p>Manage the pictures in your ${service.pageName} slideshow.</p></div><button type="button" class="button button-secondary" data-cart-photo-refresh>Refresh photos</button></div><p class="muted" id="cart-photo-help">Drag photos to rearrange them, or use the arrow keys on a photo. The first visible photo opens the slideshow. Click Save photos to publish your changes.</p><div class="row-actions"><label class="button cart-photo-upload">Upload photos<input type="file" accept="${galleryImageAccept}" multiple data-cart-photo-upload></label></div><p class="help-text">JPG, PNG, WebP, AVIF, GIF, BMP or HEIC \u00b7 up to 25 MB each. Photos convert to WebP and resize to at most 1600 px before uploading. Animated images become a still photo.</p><p role="status" aria-live="polite" data-cart-photo-message></p><div class="cart-photo-grid" data-cart-photo-list></div><div class="cart-photo-save row-actions"><button type="button" class="button" data-cart-photo-save disabled>Save photos</button><button type="button" class="button button-secondary" data-cart-photo-reset disabled>Reset changes</button><span class="muted" data-cart-photo-state></span></div></section>`;
  const $ = selector => root.querySelector(selector), list = $('[data-cart-photo-list]');
  const message = (text, error = false) => { const el = $('[data-cart-photo-message]'); el.textContent = text; el.className = error ? 'notice danger' : ''; };
  function controls() {
    root.dataset.busy = String(busy); root.dataset.dirty = String(dirty);
    root.querySelectorAll('button,input').forEach(el => { el.disabled = busy || !loaded; });
    $('[data-cart-photo-refresh]').disabled = busy;
    $('[data-cart-photo-save]').disabled = busy || !loaded || !dirty;
    $('[data-cart-photo-reset]').disabled = busy || !dirty;
    $('[data-cart-photo-state]').textContent = dirty ? 'Unsaved photo changes' : loaded ? `${items.length} photos \u00b7 ${items.filter(p => p.published).length} visible` : '';
    list.querySelectorAll('[data-photo-move]').forEach(el => { el.disabled = busy || items.length < 2; });
  }
  function changed() { dirty = true; operation = crypto.randomUUID(); controls(); }
  function paint() {
    list.innerHTML = items.map((p, i) => `<article class="cart-photo-card" data-photo-index="${i}"><button type="button" class="photo-reorder cart-photo-reorder" data-photo-move="${i}" aria-describedby="cart-photo-help" aria-label="Move photo ${i + 1} of ${items.length}"><img src="${esc(p.photo_url)}" alt="${esc(p.caption || `${service.photoName} photo ${i + 1}`)}" loading="lazy" draggable="false"><span class="photo-grip" aria-hidden="true"><svg width="12" height="20" viewBox="0 0 12 20" fill="currentColor" focusable="false" style="display:block"><circle cx="3" cy="4" r="1.5"/><circle cx="9" cy="4" r="1.5"/><circle cx="3" cy="10" r="1.5"/><circle cx="9" cy="10" r="1.5"/><circle cx="3" cy="16" r="1.5"/><circle cx="9" cy="16" r="1.5"/></svg></span></button><div class="cart-photo-fields"><span class="badge">${i + 1}${p.published ? '' : ' \u00b7 Hidden'}</span><label><span>Caption <span class="muted">(optional)</span></span><input data-cart-photo-caption="${i}" value="${esc(p.caption)}" maxlength="200"></label><label class="cart-photo-visible"><input type="checkbox" data-cart-photo-visible="${i}" ${p.published ? 'checked' : ''}>Show on website</label><div class="row-actions"><label class="button button-secondary cart-photo-upload">Replace<input type="file" accept="${galleryImageAccept}" data-cart-photo-replace="${i}"></label><button type="button" class="button button-secondary" data-cart-photo-remove="${i}" aria-label="Remove photo ${i + 1}">Remove</button></div></div></article>`).join('') || '<p class="notice">No photos yet. Upload photos to start your slideshow.</p>';
    controls();
  }
  async function load() {
    if (dirty && !confirm('Discard your unsaved photo changes and load the saved photos?')) return;
    busy = true; controls(); message('Loading party cart photos...');
    try {
      const data = await api('admin_get'); if (!root.isConnected) return;
      items = data.items; saved = structuredClone(items); revision = data.revision;
      loaded = true; dirty = false; operation = crypto.randomUUID(); paint(); message('');
    } catch (error) { message(error.message || 'Photos could not load. Try Refresh photos.', true); }
    finally { busy = false; controls(); }
  }
  bindProductPhotoOrder(list, { canMove: () => loaded && !busy, onMove: (from, to) => {
    const [item] = items.splice(from, 1); items.splice(to, 0, item); changed(); paint();
    message(`Photo moved to position ${to + 1}. Save photos to publish the new order.`);
    $(`[data-photo-move="${to}"]`).focus({ preventScroll: true });
  } });
  root.addEventListener('input', event => {
    if (busy) return;
    const input = event.target;
    if (input.hasAttribute('data-cart-photo-caption')) { items[Number(input.dataset.cartPhotoCaption)].caption = input.value; changed(); }
  });
  root.addEventListener('change', async event => {
    if (busy) return;
    const input = event.target;
    if (input.hasAttribute('data-cart-photo-visible')) { items[Number(input.dataset.cartPhotoVisible)].published = input.checked; changed(); paint(); return; }
    if (!input.matches('[data-cart-photo-upload],[data-cart-photo-replace]')) return;
    const files = [...input.files]; input.value = ''; if (!files.length) return;
    const replacing = input.hasAttribute('data-cart-photo-replace'), index = Number(input.dataset.cartPhotoReplace);
    if (!replacing && files.length + items.length > 500) { message('This slideshow supports up to 500 photos. Remove unused photos before adding more.', true); return; }
    busy = true; controls(); const failures = []; let added = 0;
    try {
      for (const [n, file] of files.entries()) {
        message(`Converting and uploading photo ${n + 1} of ${files.length}...`);
        try {
          const prepared = await prepareGalleryImage(file);
          const uploaded = await upload(prepared.file, { kind: 'product' });
          if (!root.isConnected) return;
          if (replacing) items[index] = { ...items[index], photo_url: uploaded.url };
          else items.push({ id: crypto.randomUUID(), photo_url: uploaded.url, caption: '', published: true });
          added++; changed(); paint();
        } catch (error) { failures.push(`${file.name}: ${error.message}`); }
      }
      message(`${added ? `${added} photo${added === 1 ? '' : 's'} ready. Click Save photos to publish. ` : ''}${failures.join(' ')}`, failures.length > 0);
    } finally { busy = false; controls(); }
  });
  root.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button || busy) return;
    if (button.hasAttribute('data-cart-photo-refresh')) { await load(); return; }
    if (button.hasAttribute('data-cart-photo-reset')) {
      if (!confirm('Discard your unsaved photo changes?')) return;
      items = structuredClone(saved); dirty = false; paint(); message('Saved photos restored.'); return;
    }
    if (button.hasAttribute('data-cart-photo-remove')) {
      const index = Number(button.dataset.cartPhotoRemove);
      if (!confirm(`Remove photo ${index + 1}${items[index].caption ? ` (${items[index].caption})` : ''} from the slideshow? Click Save photos to apply this change.`)) return;
      items.splice(index, 1); changed(); paint(); message('Photo removed from this draft. Save photos to publish.'); return;
    }
    if (!button.hasAttribute('data-cart-photo-save') || !dirty) return;
    busy = true; controls(); message('Saving photos...');
    try {
      const result = await api('save', { items, revision, operation_id: operation });
      if (!root.isConnected) return;
      items = result.items; saved = structuredClone(items); revision = result.revision; dirty = false;
      paint(); message(`Saved. The ${service.pageName} page now uses these photos and this order.`);
    } catch (error) { message(`${error.message || 'Photos could not save.'} Your photo changes are still here.`, true); }
    finally { busy = false; controls(); }
  });
  void load();
}
