# Party package management

Owners open **Dashboard → Party packages** to edit the four existing Party Carts packages, add packages, set prices, add or reorder inclusion rows, enter optional details/subtitles/badges, set display order, or hide a package. Shared service and delivery inclusions are editable in one place. Saved visible packages are read by `partycarts.html`; inquiries still go to `contactus.html`.

Each package also has **Delete** beside Edit. A confirmation names the package before permanently removing it from the dashboard and public page. Cancel leaves it unchanged; a failed request keeps it listed with an error and allows retry. Deletion requires a verified owner and the current revision, so an edit in another window must be reviewed before deletion. Apply `20260920163641_delete_party_packages.sql` before publishing this control. The migration itself does not remove any packages or change shared inclusions or custom cart items.

The dashboard also opens directly at `manage.html#packages`. **Customize your own cart → Edit cart items** manages the separate list of treats: add names, edit them, move them up or down, or remove them. The original twelve names are seeded by `20260920162116_editable_party_cart_items.sql`. This list has its own revision and retry key, so saving it does not overwrite packages or shared inclusions. The public page retains its existing introduction, blue customization section, See More Options link, carousel, header, and footer. Its package text uses the original Chelsea Market typeface.

The migration `20260920093709_party_packages.sql` seeds only the four visible source packages. Prices, quantities, flavor lists, the Most Popular/New badges, and the existing Quezon City delivery exclusions are preserved. It does not create shop products or change checkout, orders, stock, galleries, or blogs. Apply it before publishing the client update.

The private `tlb.party_packages` and `tlb.party_package_settings` tables have RLS enabled and no browser table grants. `party_packages_api` provides an explicit public projection; every administrative operation checks a verified user against the canonical owner role. Revisions prevent overwriting another window's edits. A stable package ID and save operation ID make response-loss retries safe. Package content is rendered as escaped text, not HTML.

Run the existing backend suite and `node tests/ui/party-packages.mjs`. The browser suite uses fixture data and mock authentication; it does not mutate production. `PGLITE_PACKAGE_ROOT`, `PLAYWRIGHT_PACKAGE_ROOT`, and `BROWSER_EXECUTABLE_PATH` can point to external test dependencies. Screenshots go under ignored `test-results/party-packages`.

The public page shows an explicit retry state on a fetch failure rather than outdated hardcoded prices. Hiding every package shows a contact prompt. The photo carousel and customization section remain intact.
