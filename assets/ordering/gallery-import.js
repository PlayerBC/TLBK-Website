// MongoDB exports are data only. Never evaluate shell/JavaScript export syntax.
export function safePhotoUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; }
  catch { return ''; }
}

export function parseGalleryExport(text) {
  let data;
  const source = text.replace(/^\uFEFF/, '').trim();
  try { data = JSON.parse(source); }
  catch {
    try { data = source.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line)); }
    catch { throw new Error('Choose a JSON array or newline-delimited JSON export from MongoDB.'); }
  }
  const records = Array.isArray(data) ? data : Array.isArray(data?.documents) ? data.documents : [data];
  const categories = [], photos = [], ids = new Set();
  for (const [index, record] of records.entries()) {
    const fail = message => { throw new Error(`Record ${index + 1}: ${message}`); };
    if (!record || typeof record !== 'object' || Array.isArray(record)) fail('expected a photo or category document.');
    if (record.spec_id === 'categories') {
      if (!Array.isArray(record.categories) || record.categories.some(c => typeof c !== 'string' || !c.trim() || c.length > 100)) fail('invalid category list.');
      categories.push(...record.categories.map(c => c.trim()));
      continue;
    }
    if (record.type && record.type !== 'item') fail(`unsupported document type “${record.type}”. Export the gallery collection only.`);
    const photo_url = safePhotoUrl(record.picture ?? record.photo_url);
    if (!photo_url || photo_url.length > 4096) fail('missing or invalid HTTPS picture URL.');
    const category = typeof record.category === 'string' ? record.category.trim() : '';
    if (!category || category.length > 100) fail('a category is required (up to 100 characters).');
    const title = record.title ?? record.name ?? '';
    const description = record.description ?? '';
    if (typeof title !== 'string' || title.length > 200 || typeof description !== 'string' || description.length > 2000) fail('invalid optional name or description.');
    let keywords = record.keywords ?? record.tags ?? [];
    // A string is kept intact as a phrase; Postgres also indexes each word.
    if (typeof keywords === 'string') keywords = keywords.trim() ? [keywords.trim()] : [];
    if (!Array.isArray(keywords) || keywords.length > 100 || keywords.some(k => typeof k !== 'string' || !k.trim() || k.length > 100)) fail('keywords must be text or a list of text (up to 100 characters each).');
    const rawId = record._id?.$oid ?? record._id ?? record.legacy_id;
    if (!['string', 'number'].includes(typeof rawId) || !String(rawId).trim() || String(rawId).length > 300) fail('missing original MongoDB _id; export with IDs included.');
    const legacy_id = String(rawId);
    if (ids.has(legacy_id)) fail(`duplicate record ID ${legacy_id}.`);
    ids.add(legacy_id);
    photos.push({ legacy_id, photo_url, category, title, description, keywords: [...new Set(keywords.map(k => k.trim()))], published: true, sort_order: photos.length });
  }
  if (!photos.length) throw new Error('This export has no photos. Export all photo documents as well as the category document.');
  categories.push(...photos.map(p => p.category));
  return { photos, categories: [...new Set(categories)] };
}
