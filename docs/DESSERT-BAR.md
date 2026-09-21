# Dessert bar

Open **Dashboard → Dessert bar** or manage.html#dessert.

- Add, edit, hide, reorder or delete packages; enter prices, badges, inclusions and optional details.
- Use **Edit shared inclusions** for service details above the packages. This list can be empty.
- Use **Edit dessert bar items** for the customization list.
- Upload photos in **Dessert bar photos**, edit optional captions, hide or remove them, drag to reorder, and click **Save photos**. Uploads reuse the owner-protected image uploader and convert to WebP (up to 1600 px).

The page starts with no packages, shared inclusions, custom items or photos. No party cart content is copied. Each service has its own tables, revisions and API adapters; shared rendering, upload and slideshow code keeps the experience consistent. The original navigation, footer and font are retained. Photos support swiping, a smooth slide, looping and three-second idle autoplay; reduced-motion users navigate manually.

Apply 20260921043715_dessert_bar_content.sql before publishing the frontend. It adds only dessert bar tables, private handlers and public invoker wrappers. Public browsing exposes published content only. All administrative reads and writes require the verified owner. Direct table access stays revoked with RLS and explicit deny policies; stale revisions and retry IDs protect saves.

Validation: node tests/backend/run.mjs, node tests/ui/dessert-bar.mjs, node tests/ui/party-packages.mjs, node tests/ui/party-cart-photos.mjs, and node scripts/build-static.mjs. Browser tests use fixtures only. Existing environment overrides for PGlite, Playwright, Chrome and optional local photo assets are supported.
