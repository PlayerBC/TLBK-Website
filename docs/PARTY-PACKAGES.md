# Party package management

Owners open **Dashboard → Party packages** to edit the four existing Party Carts packages, add packages, set prices, add or reorder inclusion rows, enter optional details/subtitles/badges, set display order, or hide a package. Shared service and delivery inclusions are editable in one place. Saved visible packages are read by `partycarts.html`; inquiries still go to `contactus.html`.

Each package also has **Delete** beside Edit. A confirmation names the package before permanently removing it from the dashboard and public page. Cancel leaves it unchanged; a failed request keeps it listed with an error and allows retry. Deletion requires a verified owner and the current revision, so an edit in another window must be reviewed before deletion. Apply `20260920163641_delete_party_packages.sql` before publishing this control. The migration itself does not remove any packages or change shared inclusions or custom cart items.

The dashboard also opens directly at `manage.html#packages`. **Customize your own cart → Edit cart items** manages the separate list of treats: add names, edit them, move them up or down, or remove them. The original twelve names are seeded by `20260920162116_editable_party_cart_items.sql`. This list has its own revision and retry key, so saving it does not overwrite packages or shared inclusions. The public page retains its existing introduction, blue customization section, See More Options link, carousel, header, and footer. Its package text uses the original Chelsea Market typeface.

The migration `20260920093709_party_packages.sql` seeds only the four visible source packages. Prices, quantities, flavor lists, the Most Popular/New badges, and the existing Quezon City delivery exclusions are preserved. It does not create shop products or change checkout, orders, stock, galleries, or blogs. Apply it before publishing the client update.

The private `tlb.party_packages` and `tlb.party_package_settings` tables have RLS enabled and no browser table grants. `party_packages_api` provides an explicit public projection; every administrative operation checks a verified user against the canonical owner role. Revisions prevent overwriting another window's edits. A stable package ID and save operation ID make response-loss retries safe. Package content is rendered as escaped text, not HTML.

Run the existing backend suite and `node tests/ui/party-packages.mjs`. The browser suite uses fixture data and mock authentication; it does not mutate production. `PGLITE_PACKAGE_ROOT`, `PLAYWRIGHT_PACKAGE_ROOT`, and `BROWSER_EXECUTABLE_PATH` can point to external test dependencies. Screenshots go under ignored `test-results/party-packages`.

## Party cart photos

The public page uses the approved split layout: introductory text beside a full-photo viewer and thumbnail strip. All 17 original photos are seeded by `20260920165643_party_cart_photos.sql`, with the cart photo from the approved preview first. Header, footer, package details, original font, and custom cart section remain in place.

The slideshow advances every **3 seconds** while idle and wraps from the last image to the first. Activity restarts the idle timer. A resting pointer or focus left on an arrow/thumbnail does not block autoplay: it resumes after three idle seconds. An open enlarged gallery, hidden tabs, and an offscreen viewer pause automatic playback. Pause/Play lets visitors control it. Reduced-motion visitors start paused and can opt into playback. Automatic changes scroll only the thumbnail strip, never the page. Next/previous changes slide smoothly over 0.6 seconds using the home carousel’s easing, including in the enlarged gallery. Incoming images decode before transitioning; rapid clicks keep the latest requested image. Reduced-motion visitors see instant changes.

Owners use **Dashboard → Party packages → Party cart photos** to upload several files, drag with mouse/touch, reorder with arrow keys, replace images, edit optional captions, hide photos, or remove them. **Save photos** publishes the complete order atomically; **Reset changes** restores the last saved gallery. Navigation warns about drafts and waits for uploads/saves. Failed saves retain drafts and use the same retry ID.

Uploads reuse the existing browser image converter and verified-owner upload endpoint. Supported JPG, PNG, WebP, AVIF, GIF, BMP, and HEIC files (up to 25 MB each) become WebP at most 1600 px and 5 MB before storage. Animated files become a still frame. Unsupported or corrupt files show an error. Existing repository photos keep their original URLs. Removing a photo removes its gallery entry; shared public storage objects are not physically deleted.

The new `tlb.party_cart_gallery` table is private, with RLS and no browser grants. `party_cart_photos_api` exposes only visible photo IDs, URLs, and captions publicly; every draft/save operation requires a verified owner. Revision checks prevent another browser from overwriting a newer order. Apply this migration before publishing the new client files. It does not alter existing packages, customization items, gallery portfolios, shop products, or orders.

Run `node tests/ui/party-cart-photos.mjs` for the 3-second loop, idle/pause/reduced-motion behavior, WebP resizing, owner management, retry, touch/keyboard ordering, and mobile checks. It uses browser fixtures only. Optionally set `PARTY_PHOTO_ASSETS_ROOT` to a full repository asset checkout for screenshots with the original photographs.

The public page shows an explicit retry state on a fetch failure rather than outdated hardcoded prices. Hiding every package shows a contact prompt. The photo carousel and customization section remain intact.
