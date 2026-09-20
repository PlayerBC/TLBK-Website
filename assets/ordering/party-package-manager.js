import { packageCard, packagePrice, packageEscape as esc, packageInclusions } from './party-packages-view.js';

export function mountPartyPackageManager(root, { role, connected, api }) {
  if (!connected || role !== 'owner') {
    root.innerHTML = '<h1>Party packages</h1><p class="notice">Sign in with the owner account to add or edit party packages.</p>'; return;
  }
  let items = [], settings, draft, mode, busy = false, operation;
  let loaded = false, dirty = false, returnFocus;
  root.innerHTML = `<div class="view-heading"><div><span class="eyebrow">The Little Baker Kitchen</span><h1>Party packages</h1><p>Manage the packages and inclusions on your Party Carts page.</p></div><a class="button button-secondary" href="partycarts.html" target="_blank" rel="noopener">View party carts ↗</a></div>
    <div class="row-actions party-manager-actions"><button class="button" type="button" data-party-new disabled>Add package</button><button class="button button-secondary" type="button" data-party-settings disabled>Edit shared inclusions</button><button class="button button-secondary" type="button" data-party-refresh>Refresh</button></div>
    <p data-party-message role="status" aria-live="polite"></p><div data-party-list class="party-admin-list"></div><div data-party-shared></div>
    <dialog class="party-editor" aria-labelledby="party-editor-title"><form data-party-form><div class="party-editor-top"><h2 id="party-editor-title"></h2><button type="button" class="icon-button" data-party-close aria-label="Close editor">×</button></div><div class="party-editor-layout"><div data-party-fields></div><aside><p class="eyebrow">Preview</p><div class="party-preview" data-party-preview></div></aside></div><p data-party-error role="alert"></p><div class="row-actions"><button type="submit" class="button">Save changes</button><button type="button" class="button button-secondary" data-party-close>Cancel</button></div></form></dialog>`;
  const $ = selector => root.querySelector(selector);
  const dialog = $('dialog'), form = $('[data-party-form]');
  function message(text, error = false) { $('[data-party-message]').textContent = text; $('[data-party-message]').className = error ? 'notice danger' : ''; }
  function lock(value) {
    busy = value; root.dataset.busy = String(value);
    root.querySelectorAll('button,input,textarea').forEach(el => { el.disabled = value; });
    $('[data-party-new]').disabled = value || !loaded;
    $('[data-party-settings]').disabled = value || !loaded;
    if (!value && dialog.open) syncFeatureButtons();
  }
  function markDirty(value) { dirty = value; root.dataset.dirty = String(value); }
  function paint() {
    items.sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    $('[data-party-list]').innerHTML = items.map(p => `<article class="party-admin-item panel"><div><span class="badge">${p.published ? 'Visible' : 'Hidden'}</span>${p.badge ? `<span class="party-admin-badge">${esc(p.badge)}</span>` : ''}<h2>${esc(p.name)}</h2><p>${esc(p.subtitle || p.features[0]?.label || '')}</p><small>Display order: ${p.sort_order} · ${p.features.length} inclusions</small></div><div class="party-admin-item-actions"><strong>${esc(packagePrice(p.price_cents))}</strong><button class="button button-secondary" type="button" data-party-edit="${esc(p.id)}">Edit<span class="sr-only"> ${esc(p.name)}</span></button></div></article>`).join('') || '<p class="notice">No packages yet. Add your first package.</p>';
    $('[data-party-shared]').innerHTML = packageInclusions(settings.inclusions);
  }
  async function load() {
    lock(true); message('Loading party packages…');
    try {
      const result = await api('admin_list');
      if (!root.isConnected) return;
      items = result.items; settings = result.settings; loaded = true; paint(); message('Saved changes appear on the Party Carts page. Hidden packages stay here for later.');
    } catch (error) { message(error.message || 'Packages could not load. Try Refresh.', true); }
    finally { lock(false); }
  }
  const field = (name, label, value, attrs = '') => `<label class="field"><span>${label}</span><input name="${name}" value="${esc(value)}" ${attrs}></label>`;
  function featureRow(feature) {
    return `<div class="party-feature-row" data-party-feature><label class="field">Inclusion<input data-feature-label value="${esc(feature.label)}" required maxlength="200"></label><label class="field"><span>Details <span class="muted">(optional)</span></span><textarea data-feature-detail rows="2" maxlength="1600">${esc(feature.detail)}</textarea></label><div class="row-actions"><button class="button button-secondary" type="button" data-feature-up aria-label="Move inclusion up">↑</button><button class="button button-secondary" type="button" data-feature-down aria-label="Move inclusion down">↓</button><button class="button button-secondary" type="button" data-feature-remove>Remove</button></div></div>`;
  }
  function syncFeatureButtons() {
    const rows = [...form.querySelectorAll('[data-party-feature]')];
    rows.forEach((row, i) => {
      row.querySelector('[data-feature-up]').disabled = i === 0;
      row.querySelector('[data-feature-down]').disabled = i === rows.length - 1;
      row.querySelector('[data-feature-remove]').disabled = rows.length === 1;
    });
    $('[data-feature-add]').disabled = rows.length >= 30;
  }
  function readFeatures() { return [...form.querySelectorAll('[data-party-feature]')].map(row => ({ label: row.querySelector('[data-feature-label]').value.trim(), detail: row.querySelector('[data-feature-detail]').value.trim() })); }
  function readDraft() {
    if (mode === 'settings') return { ...draft, inclusions: readFeatures() };
    const data = new FormData(form);
    return { ...draft, name: data.get('name').trim(), subtitle: data.get('subtitle').trim(), price_cents: Math.round(Number(data.get('price')) * 100), badge: data.get('badge').trim(), sort_order: Number(data.get('sort_order')), published: data.has('published'), features: readFeatures() };
  }
  function preview() {
    const next = readDraft();
    $('[data-party-preview]').innerHTML = mode === 'settings' ? packageInclusions(next.inclusions) : packageCard(next, { preview: true });
  }
  function edit(item, shared = false) {
    mode = shared ? 'settings' : 'package';
    draft = structuredClone(item); operation = crypto.randomUUID(); markDirty(false); returnFocus = document.activeElement;
    $('#party-editor-title').textContent = shared ? 'Shared inclusions' : item.revision === 0 ? 'Add party package' : `Edit ${item.name}`;
    const features = shared ? item.inclusions : item.features;
    $('[data-party-fields]').innerHTML = (shared ? '<p>These inclusions appear once above all packages.</p>' : `${field('name', 'Package name', item.name, 'required maxlength="120"')}${field('subtitle', 'Subtitle <span class="muted">(optional)</span>', item.subtitle, 'maxlength="200"')}<div class="field-row">${field('price', 'Price (PHP)', (item.price_cents / 100).toFixed(2), 'type="number" min="0.01" max="1000000" step="0.01" required')}${field('sort_order', 'Display order', item.sort_order, 'type="number" min="0" max="10000" step="1" required')}</div><p class="muted">Lower display order appears first.</p>${field('badge', 'Badge <span class="muted">(optional)</span>', item.badge, 'maxlength="32" placeholder="Most Popular, New…"')}<label class="check-field"><input type="checkbox" name="published" ${item.published ? 'checked' : ''}>Show on website</label><h3>Package inclusions</h3><p class="muted">Add each serving, flavor choice or extra as an inclusion. Details are optional.</p>`) + `<div data-party-features>${features.map(featureRow).join('')}</div><button class="button button-secondary" type="button" data-feature-add>Add inclusion</button>`;
    $('[data-party-error]').textContent = ''; preview(); syncFeatureButtons(); dialog.showModal(); dialog.scrollTop = 0; form.querySelector('input')?.focus();
  }
  function close() {
    if (busy || (dirty && !confirm('Discard your unsaved package changes?'))) return;
    markDirty(false); dialog.close(); returnFocus?.focus();
  }
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  form.addEventListener('input', () => { markDirty(true); operation = crypto.randomUUID(); preview(); });
  root.addEventListener('click', event => {
    if (busy) return;
    const target = event.target.closest('button'); if (!target) return;
    if (target.hasAttribute('data-party-new')) edit({ id: crypto.randomUUID(), revision: 0, name: '', subtitle: '', price_cents: 0, badge: '', published: true, sort_order: Math.min(10000, Math.max(0, ...items.map(p => p.sort_order)) + 10), features: [{ label: '', detail: '' }] });
    else if (target.hasAttribute('data-party-settings')) edit(settings, true);
    else if (target.hasAttribute('data-party-refresh')) void load();
    else if (target.hasAttribute('data-party-edit')) edit(items.find(p => p.id === target.dataset.partyEdit));
    else if (target.hasAttribute('data-party-close')) close();
    else if (target.matches('[data-feature-add],[data-feature-remove],[data-feature-up],[data-feature-down]')) {
      const row = target.closest('[data-party-feature]');
      if (target.hasAttribute('data-feature-add')) { $('[data-party-features]').insertAdjacentHTML('beforeend', featureRow({ label: '', detail: '' })); $('[data-party-features]').lastElementChild.querySelector('input').focus(); }
      if (target.hasAttribute('data-feature-remove')) { const focusRow = row.nextElementSibling || row.previousElementSibling; row.remove(); focusRow?.querySelector('input').focus(); }
      if (target.hasAttribute('data-feature-up') && row.previousElementSibling) row.previousElementSibling.before(row);
      if (target.hasAttribute('data-feature-down') && row.nextElementSibling) row.nextElementSibling.after(row);
      markDirty(true); operation = crypto.randomUUID(); syncFeatureButtons(); preview();
    }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (busy || !form.reportValidity()) return;
    const next = readDraft(); lock(true); $('[data-party-error]').textContent = '';
    try {
      const result = await api(mode === 'settings' ? 'save_settings' : 'save', mode === 'settings' ? { ...next, operation_id: operation } : { package: next, operation_id: operation });
      if (mode === 'settings') settings = result;
      else { const index = items.findIndex(p => p.id === result.id); if (index < 0) items.push(result); else items[index] = result; }
      markDirty(false); dialog.close(); paint(); message('Saved. Your Party Carts page now uses these details.');
      $('[data-party-new]').focus();
    } catch (error) { $('[data-party-error]').textContent = error.message || 'Could not save. Your edits are still here; try again.'; }
    finally { lock(false); }
  });
  void load();
}
