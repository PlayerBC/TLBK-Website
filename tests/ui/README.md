# Browser checks

These tests cover the explicitly labelled sample storefront, pickup/delivery
review, exact mixed-cookie selection pricing, disabled sample submission, empty
real catalog, all unconfigured staff sections, and desktop/mobile layout.
They do not impersonate real accounts or send orders/emails to a provider.

Use Node 24, install Playwright and its Chromium browser in a development environment,
then run `node tests/ui/run.mjs`. Playwright may be supplied through
`PLAYWRIGHT_PACKAGE_ROOT=/path/to/node_modules`. A locally available Chromium can
be selected with `BROWSER_EXECUTABLE_PATH=/path/to/chromium`. Optional screenshots
are written only when `UI_SCREENSHOT_DIR` points to an existing directory.
The test starts its own localhost server and closes it on completion.

Connected Supabase browser testing and actual inbox tests are separately required
by docs/ACCEPTANCE.md after the owner completes docs/SETUP.md.


## Optional product labels

Run `npm run test:labels` to check optional labels, saved text and color, and their manager/storefront behavior. Set `PLAYWRIGHT_PACKAGE_ROOT` to the directory containing the `playwright` package if it is not locally installed, and `BROWSER_EXECUTABLE_PATH` if using a separately installed Chromium browser.

`product-labels.mjs` uses the real manager and shop UI with a local mock of the client module. It blocks external requests and does not connect to Supabase, send emails, or change real products. The checks include saving and reopening labels, disabling them without losing their settings, options remaining independent, unsafe saved values, and mobile layout.

## Product photo order

Run `npm run test:product-photos` for native mouse and touch dragging, keyboard movement, save/reopen behavior, unsaved field preservation, upload/remove interactions, cancellation and staff access. The test uses local API/image fixtures and blocks every external request. `PHOTO_TEST_OUTPUT` selects its screenshot/results directory; it defaults to `tests/artifacts/product-photos`. The Playwright and Chromium environment overrides above apply.

## Checkout feedback regression

Run `npm run test:checkout` for phone-format checks and the isolated checkout browser test. The browser test uses local fixtures and blocks external requests. It covers buyer/recipient phone validation, enabling social usernames only after platform selection, and preserving pickup line breaks on checkout and saved orders. The same Playwright and browser environment overrides above apply.


## Customer booking calendar

Run `npm run test:customer-calendar` for the date/model checks and isolated popup
browser regression. The fixture blocks external requests and never writes live
orders or sends email. It checks navigation limits, closed dates, keyboard control,
selection/clearing and restoration. It uses the same Playwright and Chromium
environment overrides described above.
