# The Little Baker Kitchen's Website
The main components of the website are a homepage to show expertise in making custom cakes, a portfolio page for clients to easily find our past works based on the theme they want, and a blog page for me to post recipe tutorials / limited time promos.

## Features

- **Home Page**: Introduces visitors to The Little Baker Kitchen with a captivating carousel of our best creations.
- **Specialties Section**: Detailed pages for each category of our offerings, including Custom Orders, Pastries, Party Carts, and Dessert Bars.
- **FAQ Page**: Answers to common questions our customers have.
- **Blogs Page**: Articles and updates about our bakery and the latest trends in baking.
- **Contact Us Page**: A form for customers to reach out to us with inquiries or orders.

## Technologies Used

- HTML5
- CSS3
- JavaScript
- Bootstrap 5
- jQuery

## Website Pages
- Home 
- About Us
- Pastries
- Custom Orders
- Party Carts & Events
- Blogs
- Testimonials
- FAQ

## Ordering-system development draft

The original website and assets are preserved. The ordering pages are additive:

- `shop.html`: menu, options/mixed boxes, date selection, cart, guest checkout, secure order access and manual-payment proof.
- `account.html`: signup, verified email accounts, recovery and private order history.
- `manage.html`: products/photos/categories, quantities per date, orders, manual review, amendments, promo codes, delivery zones, shop settings and team access.

The actual ordering catalog starts empty and paused. `shop.html?demo=1` is an
explicitly labelled sample design flow; it cannot create an order, accept a
payment, create an account, or send email. It does not populate the database.

The production implementation uses Supabase PostgreSQL/Auth/Storage/Edge Functions
and Resend. Public configuration is blank until the owner sets up a separate test
project and sender. Secret/service keys never belong in browser code.

Read [draft status](docs/DRAFT-STATUS.md), [setup](docs/SETUP.md),
[service options and costs](docs/SERVICES.md), and the
[owner acceptance checklist](docs/ACCEPTANCE.md). No live payment gateway or courier
integration is used. The owner performs the acceptance tests; technical tests do
not establish real email receipt or hosted concurrency.

### Local development and checks

Serve the repository with `npm run dev` (Python), or another static web server.
No framework rewrite or runtime package install is needed for the static pages.
`npm run build` copies public website files and all original assets to `dist/`;
`node scripts/build-static.mjs --preview` additionally marks pages noindex.
Backend SQL, tests and service secrets are not copied to the public output.

Use Node 24 for the automated checks. Install the pinned database-test dependency
with `npm ci --prefix tests/backend`, then run `npm test` for six shop-rule,
30 database-contract, and eight mocked Edge Function checks. The optional browser
suite is documented in [tests/ui/README.md](tests/ui/README.md).

### Review and eventual GitHub merge

This development branch is based on main commit
`571de6e9fcb51a70bafc1483a0b6fe11752f5198`. No changes have been pushed to the original
repository's main branch or published to thelittlebakerkitchen.com.

The owner-created fork is [PlayerBC/TLBK-Website](https://github.com/PlayerBC/TLBK-Website).
The draft is prepared on `development/ordering-system` for a draft pull request
within that fork; both main branches stay unchanged pending approval.

After the owner records acceptance and explicitly approves release:
1. Push the development branch to the authorized fork and open a pull request
   targeting `BrentChuaTLBK/bakery-website` main. Review the diff and any intervening
   main changes; resolve conflicts on the development branch.
2. Configure the separate production Supabase project, owner roles, real menu,
   capacities, contacts and payment details; verify production email/DNS/scheduler.
3. Set only the production Supabase URL/public key in public config. Add the exact
   production Auth callbacks, allowed browser origin and Business Site URL.
4. Merge only after explicit owner approval, using the existing repository's
   established website deployment. Keep the existing domain/CNAME unchanged.
5. Check original pages, customer order flow and staff operations after release.
   If needed, revert the website deployment commit; retain backend order records.

This walkthrough is not authorization to merge or deploy to the live domain.

GitHub connection status: write access to `PlayerBC/TLBK-Website` was verified by
successfully creating `development/ordering-system`. Brent explicitly approved
uploading this draft to that branch and opening a draft pull request. The
accompanying handoff confirms the saved commit and pull request after GitHub
returns them. Do not change either main branch while reviewing.
