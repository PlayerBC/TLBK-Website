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
