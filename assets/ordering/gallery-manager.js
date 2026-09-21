import { parseGalleryExport, safePhotoUrl } from './gallery-import.js';
import { prepareGalleryImage, galleryImageAccept } from './gallery-image.js';

const names = { 'custom-orders': 'Custom Orders', pastries: 'Pastries' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kb = bytes => `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function mountGalleryManager(root, { role, connected, api, upload }) {
  if (!connected || role !== 'owner') {
    root.innerHTML = '<h1>Photo galleries</h1><p class="notice">Sign in with the owner account to manage gallery photos.</p>'; return;
  }
  let gallery = 'custom-orders', items = [], categories = [], total = 0, enabled = false, revision = 1;
  let offset = 0, query = '', category = '', request = 0, busy = false, imported = null, loaded = false;
  let draft = null, prepared = null, queue = [], previewUrl = '', uploadedUrl = '';
  root.innerHTML = `<div class="page-heading"><div><p class="eyebrow">THE LITTLE BAKER KITCHEN</p><h1>Photo galleries</h1><p class="muted">Your past creations, ready to inspire the next order.</p></div></div>
    <div class="gallery-tabs" role="group" aria-label="Choose gallery">${Object.entries(names).map(([slug, name]) => `<button type="button" class="button button-secondary" data-gallery="${slug}" aria-pressed="${slug === gallery}">${name}</button>`).join('')}</div>
    <p class="notice" data-gallery-status></p>
    <section class="panel gallery-tools"><div class="row-actions"><label class="button">Upload photos<input data-gallery-upload type="file" accept="${galleryImageAccept}" multiple class="gallery-file"></label><label class="button button-secondary">Import MongoDB JSON<input data-gallery-import type="file" accept=".json,.jsonl,.ndjson,application/json" class="gallery-file"></label><button class="button button-secondary" type="button" data-gallery-publish></button><a data-gallery-link target="_blank" rel="noopener">View page ↗</a></div>
      <p class="muted">Photos are automatically converted to WebP, up to 1600 px. JPG, PNG, WebP, AVIF, GIF, BMP, and HEIC · up to 25 MB each. Animated images become a still photo.</p>
      <form data-gallery-filter class="gallery-filters"><label>Search photos<input name="query" type="search" maxlength="120" placeholder="Category, name, or hidden keywords"></label><label>Category<select name="category"><option value="">All categories</option></select></label><button class="button button-secondary" type="submit">Search</button></form>
    </section>
    <p data-gallery-message role="status" aria-live="polite"></p><div data-gallery-import-preview></div><p data-gallery-count></p><div class="gallery-admin-grid" data-gallery-items></div><button type="button" class="button button-secondary" data-gallery-more hidden>Load more photos</button>
    <dialog closedby="none" class="gallery-editor" aria-labelledby="gallery-editor-title"><form data-gallery-editor><div class="gallery-editor-heading"><h2 id="gallery-editor-title">Photo details</h2><button type="button" class="icon-button" data-gallery-close aria-label="Close photo editor">×</button></div><div class="gallery-editor-layout"><div><img class="gallery-photo-preview" alt="Photo preview" data-gallery-preview><p class="muted" data-gallery-file-info></p><label>Replace photo<input type="file" accept="${galleryImageAccept}" data-gallery-replace></label><p class="muted">Gallery image links are public. Hiding a photo removes it from the gallery.</p></div><div class="gallery-fields"><label>Category<input name="category" list="gallery-category-options" required maxlength="100" placeholder="Choose or type a category"></label><datalist id="gallery-category-options"></datalist><label>Hidden search keywords<textarea name="keywords" rows="4" placeholder="Pikachu&#10;Pokémon"></textarea><small>One keyword or phrase per line. Customers can search these, but won’t see the keyword list.</small></label><label>Name <span class="muted">(optional)</span><input name="title" maxlength="200"></label><label>Description <span class="muted">(optional)</span><textarea name="description" rows="3" maxlength="2000"></textarea></label><label class="gallery-checkbox"><input type="checkbox" name="published" checked> Show in gallery</label></div></div><p data-gallery-editor-message role="status"></p><div class="row-actions"><button type="submit" class="button">Save photo</button><button type="button" class="button button-secondary" data-gallery-close>Cancel</button><span data-gallery-queue class="muted"></span></div></form></dialog>`;
  const $ = selector => root.querySelector(selector);
  const dialog = $('dialog'), form = $('[data-gallery-editor]');
  root.addEventListener('error', event => {
    if (!event.target.matches?.('.gallery-image-button img')) return;
    const note = document.createElement('span'); note.className = 'gallery-image-missing';
    note.textContent = 'Image unavailable. Edit to replace it.'; event.target.replaceWith(note);
  }, true);
  const message = (text, error = false) => { $('[data-gallery-message]').textContent = text; $('[data-gallery-message]').className = error ? 'notice danger' : ''; };
  function lock(value) {
    busy = value; root.dataset.busy = String(value);
    root.querySelectorAll('button,input,select,textarea').forEach(input => { input.disabled = value; });
    $('[data-gallery-publish]').disabled = value || !loaded;
  }
  function revokePreview() { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = ''; }
  function closeEditor() { if (busy) return; revokePreview(); queue = []; prepared = null; uploadedUrl = ''; dialog.close(); }
  dialog.addEventListener('cancel', event => event.preventDefault());
  function paint() {
    if (!root.isConnected) return;
    $('[data-gallery-status]').textContent = enabled ? `${names[gallery]} is using this gallery. Saved changes appear on the website.` : `${names[gallery]} is being prepared. Add or import your photos, review them, then use this gallery on the website.`;
    $('[data-gallery-publish]').textContent = 'Use this gallery on website';
    $('[data-gallery-publish]').hidden = enabled;
    $('[data-gallery-link]').href = gallery === 'pastries' ? 'pastries.html' : 'customorders.html';
    const select = $('[data-gallery-filter] select');
    select.innerHTML = '<option value="">All categories</option>' + categories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join(''); select.value = category;
    $('[data-gallery-count]').textContent = `${items.length} of ${total} photos${query ? ' matching your search' : ''}`;
    $('[data-gallery-items]').innerHTML = items.map(item => `<article class="gallery-admin-card"><button type="button" class="gallery-image-button" data-gallery-edit="${esc(item.id)}" aria-label="Edit ${esc(item.title || item.category + ' photo')}"><img src="${esc(safePhotoUrl(item.photo_url))}" alt="${esc(item.title || item.category + ' design')}" loading="lazy" decoding="async"></button><div><strong>${esc(item.title || item.category)}</strong><p>${esc(item.category)} · ${item.published ? 'Visible' : 'Hidden'}</p><p class="gallery-keywords">${esc(item.keywords.join(' · ') || 'No search keywords')}</p><div class="row-actions"><button type="button" class="button button-secondary" data-gallery-edit="${esc(item.id)}">Edit</button><button type="button" class="button button-secondary" data-gallery-delete="${esc(item.id)}">Remove</button></div></div></article>`).join('') || '<p class="empty-state">No photos found. Upload photos or import your existing gallery.</p>';
    $('[data-gallery-more]').hidden = items.length >= total;
  }
  async function load(reset = true) {
    const ticket = ++request;
    if (reset) { offset = 0; items = []; total = 0; paint(); }
    loaded = false;
    lock(true); message('Loading photos…');
    try {
      const result = await api('admin_list', { gallery, query, category, offset });
      if (ticket !== request || !root.isConnected) return;
      items = reset ? result.items : [...items, ...result.items]; offset = items.length;
      ({ categories, total, enabled, revision } = result);
      loaded = true;
      paint(); message('');
    } catch (error) { if (ticket === request) message(error.message, true); }
    finally { if (ticket === request) lock(false); }
  }
  async function selectImage(file) {
    prepared = null; uploadedUrl = ''; lock(true);
    $('[data-gallery-editor-message]').textContent = 'Converting photo to WebP…';
    try {
      const result = await prepareGalleryImage(file);
      if (!root.isConnected) return;
      prepared = result; revokePreview(); previewUrl = URL.createObjectURL(result.file);
      $('[data-gallery-preview]').src = previewUrl;
      $('[data-gallery-file-info]').textContent = `${kb(result.originalSize)} original → ${kb(result.file.size)} WebP · ${result.width} × ${result.height} px`;
      $('[data-gallery-editor-message]').textContent = 'WebP ready. Add the photo details and save.';
    } catch (error) { $('[data-gallery-editor-message]').textContent = error.message; }
    finally { lock(false); }
  }
  async function edit(item = null, file = null) {
    draft = item; prepared = null; uploadedUrl = ''; revokePreview(); form.reset();
    for (const name of ['category', 'title', 'description']) form.elements[name].value = item?.[name] || '';
    form.elements.keywords.value = item?.keywords.join('\n') || '';
    form.elements.published.checked = item?.published ?? true;
    $('#gallery-category-options').innerHTML = categories.map(c => `<option value="${esc(c)}"></option>`).join('');
    $('[data-gallery-preview]').removeAttribute('src');
    if (item) $('[data-gallery-preview]').src = safePhotoUrl(item.photo_url);
    $('[data-gallery-file-info]').textContent = '';
    $('[data-gallery-editor-message]').textContent = '';
    $('[data-gallery-queue]').textContent = queue.length ? `${queue.length} more photos after this one` : '';
    form.querySelector('[type="submit"]').textContent = queue.length ? 'Save and next photo' : 'Save photo';
    if (!dialog.open) dialog.showModal();
    if (file) await selectImage(file);
    form.elements.category.focus();
  }
  root.addEventListener('change', async event => {
    const input = event.target;
    if (busy) return;
    if (input.matches('[data-gallery-upload]')) {
      queue = [...input.files]; input.value = '';
      if (queue.length) await edit(null, queue.shift());
    } else if (input.matches('[data-gallery-replace]')) {
      const file = input.files[0]; input.value = ''; if (file) await selectImage(file);
    } else if (input.matches('[data-gallery-import]')) {
      const file = input.files[0]; input.value = ''; imported = null;
      $('[data-gallery-import-preview]').innerHTML = '';
      if (!file) return;
      try {
        if (file.size > 30 * 1024 * 1024) throw new Error('Choose an export under 30 MB or split it into smaller exports.');
        imported = parseGalleryExport(await file.text());
        $('[data-gallery-import-preview]').innerHTML = `<section class="panel gallery-import-preview"><h2>Import into ${names[gallery]}</h2><p>${imported.photos.length} photos · ${imported.categories.length} categories</p><p>Existing image links and keywords will be preserved. Previously imported IDs are skipped, so your later edits stay intact.</p><p>${esc(imported.categories.join(' · '))}</p><button type="button" class="button" data-gallery-confirm-import>Import ${imported.photos.length} photos</button><button type="button" class="button button-secondary" data-gallery-cancel-import>Cancel</button></section>`;
      } catch (error) { message(error.message, true); }
    }
  });
  root.addEventListener('submit', async event => {
    event.preventDefault(); event.stopPropagation(); if (busy) return;
    if (event.target.matches('[data-gallery-filter]')) {
      query = event.target.elements.query.value.trim(); category = event.target.elements.category.value; await load(); return;
    }
    if (event.target !== form || !form.reportValidity()) return;
    if (!draft && !prepared) { $('[data-gallery-editor-message]').textContent = 'Choose a photo that can be converted before saving.'; return; }
    const keywords = form.elements.keywords.value === draft?.keywords.join('\n') ? draft.keywords : [...new Set(form.elements.keywords.value.split(/\r?\n/).map(k => k.trim()).filter(Boolean))];
    if (keywords.length > 100 || keywords.some(k => k.length > 100)) { $('[data-gallery-editor-message]').textContent = 'Use up to 100 keywords, each up to 100 characters.'; return; }
    const photo = { id: draft?.id, revision: draft?.revision, sort_order: draft?.sort_order || 0, category: form.elements.category.value.trim(), title: form.elements.title.value.trim(), description: form.elements.description.value.trim(), keywords, published: form.elements.published.checked };
    const savingGallery = gallery;
    lock(true); $('[data-gallery-editor-message]').textContent = 'Saving photo…';
    try {
      if (prepared && !uploadedUrl) uploadedUrl = (await upload(prepared.file, { kind: 'product' })).url;
      photo.photo_url = uploadedUrl || draft?.photo_url;
      await api('save', { gallery: savingGallery, photo });
      lock(false);
      if (!root.isConnected) return;
      if (queue.length) { await edit(null, queue.shift()); return; }
      closeEditor(); await load(); message('Photo saved.');
    } catch (error) { $('[data-gallery-editor-message]').textContent = error.message; }
    finally { lock(false); }
  });
  root.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button || busy) return;
    try {
      if (button.hasAttribute('data-gallery-close')) closeEditor();
      else if (button.dataset.gallery) {
        gallery = button.dataset.gallery; query = ''; category = ''; imported = null;
        $('[data-gallery-filter]').reset(); $('[data-gallery-import-preview]').innerHTML = '';
        root.querySelectorAll('[data-gallery]').forEach(b => b.setAttribute('aria-pressed', b.dataset.gallery === gallery));
        await load();
      } else if (button.dataset.galleryEdit) await edit(items.find(p => p.id === button.dataset.galleryEdit));
      else if (button.dataset.galleryDelete) {
        const item = items.find(p => p.id === button.dataset.galleryDelete);
        if (!confirm(`Remove this ${item.category} photo from the gallery?`)) return;
        lock(true); await api('delete', { gallery, id: item.id, revision: item.revision }); await load(); message('Photo removed.');
      } else if (button.hasAttribute('data-gallery-more')) await load(false);
      else if (button.hasAttribute('data-gallery-publish')) {
        if (!confirm(`Use these ${names[gallery]} photos on the website? Check the imported images and categories first.`)) return;
        lock(true); await api('set_enabled', { gallery, enabled: true, revision }); await load();
      } else if (button.hasAttribute('data-gallery-cancel-import')) { imported = null; $('[data-gallery-import-preview]').innerHTML = ''; }
      else if (button.hasAttribute('data-gallery-confirm-import') && imported) {
        lock(true); let added = 0, skipped = 0;
        const data = imported, importingGallery = gallery;
        for (let start = 0; start < data.photos.length; start += 100) {
          message(`Importing ${Math.min(start + 100, data.photos.length)} of ${data.photos.length} photos…`);
          const result = await api('import', { gallery: importingGallery, photos: data.photos.slice(start, start + 100), categories: data.categories });
          added += result.added; skipped += result.skipped;
        }
        imported = null; $('[data-gallery-import-preview]').innerHTML = ''; await load();
        message(`Import complete: ${added} photos added, ${skipped} already imported. Review the photos before using the gallery on the website.`);
      }
    } catch (error) { message(`${error.message}${imported ? ' You can retry the import; completed records will be skipped.' : ''}`, true); }
    finally { lock(false); }
  });
  void load();
}
