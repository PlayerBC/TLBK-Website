# Party package management

Owners open **Dashboard → Party packages** to edit the four existing Party Carts packages, add packages, set prices, add or reorder inclusion rows, enter optional details/subtitles/badges, set display order, or hide a package. Shared service and delivery inclusions are editable in one place. Saved visible packages are read by `partycarts.html`; inquiries still go to `contactus.html`.

The migration `20260920093709_party_packages.sql` seeds only the four visible source packages. Prices, quantities, flavor lists, the Most Popular/New badges, and the existing Quezon City delivery exclusions are preserved. It does not create shop products or change checkout, orders, stock, galleries, or blogs. Apply it before publishing the client update.

The private `tlb.party_packages` and `tlb.party_package_settings` tables have RLS enabled and no browser table grants. `party_packages_api` provides an explicit public projection; every administrative operation checks a verified user against the canonical owner role. Revisions prevent overwriting another window's edits. A stable package ID and save operation ID make response-loss retries safe. Package content is rendered as escaped text, not HTML.

Run the existing backend suite and `node tests/ui/party-packages.mjs`. The browser suite uses fixture data and mock authentication; it does not mutate production. `PGLITE_PACKAGE_ROOT`, `PLAYWRIGHT_PACKAGE_ROOT`, and `BROWSER_EXECUTABLE_PATH` can point to external test dependencies. Screenshots go under ignored `test-results/party-packages`.

The public page shows an explicit retry state on a fetch failure rather than outdated hardcoded prices. Hiding every package shows a contact prompt. The photo carousel and customization section remain intact.
