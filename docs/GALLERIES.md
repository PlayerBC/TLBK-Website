# Photo galleries

The owner dashboard has separate **Custom Orders** and **Pastries** galleries. These are portfolios, independent of shop products. Blogs are outside this migration.

## Daily use

1. Open **Photo galleries** in the dashboard and choose a gallery.
2. Choose **Upload photos**. Multiple selections are edited one at a time.
3. Preview the converted WebP, choose/type a category, and enter hidden keywords, one phrase per line. Names and descriptions are optional.
4. Save. Use **Edit** to replace an image or change its details, **Show in gallery** to hide/restore it, and **Remove** to remove its gallery record.

JPG, PNG, WebP, AVIF, GIF, BMP and HEIC/HEIF are accepted, up to 25 MB per source. The browser resizes to at most 1600 px on the longest edge and encodes WebP at quality 0.82 before storage. Smaller images aren't enlarged. Animation becomes a still image. HEIC decoding loads pinned `heic2any@0.0.4` only when native decoding fails; unsupported files show a conversion error rather than uploading originals. Files over 60 megapixels are rejected. Saved files must pass the existing server's real JPEG/PNG/WebP byte validation and 5 MB limit. The owner-only public image upload service is shared with shop photos.

Public search uses category, optional name/description and hidden keywords. Accent-insensitive prefix search matches `Pokemon`, `Pokémon`, and `Pika`. All query words must match. The server returns 24 photos per request, with **Load more** until every result is reachable; there is no total-result cap. Keywords are never returned in public API responses. Photos without titles don't receive invented visible titles.

## MongoDB import

Export each collection separately as a JSON array or newline-delimited JSON, including `_id`, photo records and the `spec_id: "categories"` document. The importer accepts Atlas extended JSON IDs, `picture`, `category`, `title`, optional `description`, and string/array `keywords`. It rejects invalid records before starting rather than silently dropping them. The original image links remain in use; this does not copy the old image binaries to Supabase or delete files from GitHub.

Choose **Import MongoDB JSON**, inspect the photo/category counts, and confirm the import. Imports run in atomic batches of 100, deduplicated by gallery plus original MongoDB ID. Retrying skips already imported rows and preserves subsequent edits. A failed later batch can be retried safely. Repeated image URLs with distinct IDs/categories are retained because they can represent intentional gallery entries.

For a new gallery, import and review images before **Use this gallery on website**. Until enabled, the public page uses its previous gallery source. The old backend is not deleted. Each gallery switches independently.

Uploaded image URLs are public even when their gallery record is hidden. Removing a record doesn't delete the underlying file, which may be referenced elsewhere. No automatic storage cleanup deletes shared images.

## Database and access

Apply `20260919094640_photo_galleries.sql` before deploying the frontend. It adds private `tlb.galleries` and `tlb.gallery_photos` tables and `public.gallery_api`. It does not modify ordering data, existing auth methods or email processing. Schema changes are additive. A browser with the owner account can manage galleries; staff and customer accounts cannot edit them.

Tables have RLS enabled, no direct browser grants, and no permissive policies. The narrow definer RPC intentionally exposes only published gallery fields for public browse and checks the verified owner role before every admin action. Revisions reject stale edits/deletions. GIN full-text and gallery/category indexes support searching and browsing.

Supabase advisors flag the deliberate [definer RPC grants](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) and [RLS without direct policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). These follow the existing private-schema API model; local database tests exercise anon/customer/staff denial, owner success and omitted hidden fields. Do not resolve those notices by granting table access or adding public policies.

## Verification

The supplied September 19 Atlas backups were imported: 503 Custom Orders records with 921 keywords, and 120 Pastries records. Every imported field was compared against the prepared exports with zero mismatches. All custom-order entries are visible. Three pastry entries referencing missing `assets/pastries/Christmas2024/` files are preserved but hidden: Christmas Macarons (Box of 10), Macaron Tower (30pcs), and Macaron Tower (30pcs) - 2. Replace their photos in the dashboard before showing them. Existing category metadata and additional categories referenced by photos were retained.

The missing `Drip14.webp` was recovered from the repository's `Drip14.HEIC` using the new browser conversion routine: 1,379,983 bytes to 222,520 bytes, 1200 × 1600 px. The recovered WebP ships with this change. The original HEIC and all other existing image files are retained. Production gallery settings are enabled so the new public pages use the imported records when this frontend is deployed.

- `node --test tests/gallery-import.test.mjs`
- `node tests/backend/run.mjs` (with the existing PGlite dependency setup)
- `node tests/ui/galleries.mjs` (with Playwright and Chrome configured)
- `node scripts/build-static.mjs`

Browser fixtures test real WebP output and dimensions, queued uploads, optional text, visibility, import retries, roles, every result beyond the first 24, failed-page retry, overlapping searches, lightbox and mobile layouts. No production uploads or orders are created by tests.
