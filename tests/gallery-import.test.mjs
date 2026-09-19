import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGalleryExport, safePhotoUrl } from '../assets/ordering/gallery-import.js';
const photo = { _id: { $oid: 'abc123' }, type: 'item', picture: 'https://example.test/cake.webp', category: 'Characters', keywords: ['Pikachu', 'Pokémon'] };
test('Atlas arrays, wrappers, extended IDs, category order and optional text', () => {
  const documents = [{ spec_id: 'categories', categories: ['Wedding', 'Characters'] }, photo];
  for (const input of [documents, { documents }]) {
    const result = parseGalleryExport(JSON.stringify(input));
    assert.deepEqual(result.categories, ['Wedding', 'Characters']);
    assert.equal(result.photos[0].title, ''); assert.equal(result.photos[0].description, '');
    assert.deepEqual(result.photos[0].keywords, ['Pikachu', 'Pokémon']); assert.equal(result.photos[0].legacy_id, 'abc123');
  }
});
test('newline JSON and string keywords are preserved', () => {
  const result = parseGalleryExport([photo, { ...photo, _id: 'two', keywords: 'Pikachu Pokémon cake' }].map(JSON.stringify).join('\n'));
  assert.deepEqual(result.photos[1].keywords, ['Pikachu Pokémon cake']);
});
test('bad or ambiguous exports fail visibly instead of silently dropping records', () => {
  for (const change of [{ picture: 'javascript:alert(1)' }, { category: '' }, { keywords: { secret: 1 } }, { _id: null }, { type: 'settings' }]) assert.throws(() => parseGalleryExport(JSON.stringify([{ ...photo, ...change }])), /Record 1/);
  assert.throws(() => parseGalleryExport(JSON.stringify([photo, photo])), /duplicate/);
  assert.throws(() => parseGalleryExport('db.find({})'), /JSON/);
  assert.equal(safePhotoUrl('https://user:password@example.test/a.webp'), '');
});
