# Recipe system release review — 30 September 2026

## Release state

Implemented on `codex/recipe-system`, based on `823f2be`. The backend is deployed;
website publication is blocked by production-repository integration access.
The owner-approved product decisions are implemented: owner-only approval,
selected chef/kitchen permissions, hidden private information in kitchen mode,
exact component requirements with optional batch rounding, costing included,
and 30 daily / 12 monthly recipe backup retention in the dedicated Drive folder.

The owner explicitly approved deployment on 30 September. Both migrations and
recipe-backup Edge Function v1 are deployed. All 44 private Drive slots were
verified before connection. The daily archive completed at 05:43 UTC and the
unattended scheduler made its matching monthly copy at 05:45 UTC.

Live checks: four unauthorized HTTP requests returned 401; twelve rollback-only
database checks passed for owner/chef/kitchen permissions, publication, version
isolation, duplication and private-data protection. No test accounts or formulas
persisted. The downloaded Drive archive restored successfully into an isolated
database with checksums and relationships verified. It contains 16 initial
configuration/actor records, zero recipes and zero uploaded files; this does not
verify photo-volume capacity.

[PR #39](https://github.com/PlayerBC/TLBK-Website/pull/39) is ready for review.
Creating the upstream PR still returns HTTP 403: Resource not accessible by
integration. The live recipe page returns 404 until production source publication.

## Delivered

| Area | Implemented behavior |
| --- | --- |
| Library | Alphabetical pagination; search/filters; categories/tags; favorites, pins and recently used |
| Structured formulas | Named sizes, yield/portions/weights/pans, grouped ingredient rows, drag reorder, methods, baking stages, equipment, packaging and photos |
| Production | Six scaling modes, exact fractions, explicit rounding, base/scaled quantities, ingredient totals, component requirements/leftovers and checkoffs |
| Production records | Planned/actual completed yield tied to the exact saved version |
| Formula safety | Immutable versions, separate published pointer, draft recovery, optimistic edit checks, compare/restore/duplicate and recoverable deletion |
| Components/variations | Saved version references, explicit update adoption, cycle/deletion checks and differences from a pinned variation base |
| R&D | Separate test logs/photos/proposed formulas and owner-only promotion |
| Costing | Master ingredients/suppliers/packaging/equipment, supplier links, price history, ingredient/component/packaging cost snapshots, extra costs and live cost preview |
| Allergens | Derivation from ingredient/component data with manual override |
| Imports | Reviewed DOCX, text/scanned PDF, image OCR and pasted-text drafts; private retained source |
| Exports | Kitchen/presentation print layouts; A4/Letter; PDF via browser printing; selected/category books; ingredient CSV |
| Privacy | Role-checked private APIs and bucket; server-side kitchen data filtering; expiring file access |
| Backups | Coherent database snapshot, actual file bytes, complete ZIP manifest, Drive verification, retention/retry/status and independent manual download |
| Recovery | Isolated reconstruction, checksums, full nested-value comparison, relationships and post-restore audit sequence verification |

## Reproducible bugs found and fixed during implementation

- A PDF cleanup call used an unsupported API; corrected it and exercised a real PDF.
- OCR used the wrong export form; corrected it and tested both an image and a
  scanned PDF with local worker/WASM/language assets.
- Linked-component quantities were initially omitted from combined CSV/PDF output;
  exports now expand pinned component versions at the required quantities.
- Component and linked packaging costs were incomplete; both now contribute to
  saved historical cost snapshots and current previews.
- Portion-size scaling incorrectly increased piece count; it now keeps count
  stable and scales mass, with separate piece-count scaling.
- Draft edits and mutable component sources could affect production visibility;
  published versions and explicit component adoption now remain separate.
- Variation base references could expose an unpublished source through kitchen
  access; only readable production components participate in that traversal.
- Nested private cost fields and R&D photo links needed server-side filtering;
  kitchen API/file authorization checks now cover them.
- Removing a former staff account conflicted with immutable attribution history;
  narrowly allowed foreign-key nulling preserves the historical formula itself.
- Upload confirmation did not fully verify object metadata; size and MIME must now
  agree with the reserved private file record.
- Failed manual backups lost their automatic retry request; the request now persists.
- Restored explicit audit IDs did not advance the sequence; recovery resets it and
  a test verifies that the next audit insert succeeds.
- Removing a picture from one size could remove it from another size; references
  are now scoped to the edited size.
- Native dialogs obscured error messages; errors now appear inside the active dialog.
- Ingredient suggestions needed brand disambiguation and old-price clearing when
  unlinking a master ingredient; both are implemented.
- Saved export font/page-break choices were ignored in some layouts; corrected and
  exercised through the real print flow.
- JavaScript hashing used about two CPU seconds for a local 100 MiB archive.
  Native/WASM verification reduced the measured workload to about one second.
  Hosted large-library capacity remains unverified, as described below.
- A broad regression caught intermittent delivery-zone form failure. A controlled
  delayed-frame test reproduced the existing dialog's focus callback interrupting
  the field being edited. The callback now preserves active editing focus; the
  controlled reproduction fails before the fix and passes afterward.

## Database changes

Two additive migrations create recipe data/version/resource/test/production/file/
audit/access tables, private helper/API functions, Storage policies and backup
connection/slot/job/snapshot tables. Recipe and backup tables deny direct browser
access. The application uses checked RPCs. Backup worker execution is separate
from the existing order backup system and uses its own Vault token and cron job.

The migration harness applied **75 migrations** in isolated Postgres/PGlite.
The recipe fixtures exercise a cookie, multi-component cake, Basque with two baking
stages, variation, scaled formula, pinned component and R&D promotion.
No customer's live order, inventory, payment or recipe data was used as a fixture.

## Verification evidence

The committed [test result summary](RECIPE-TEST-RESULTS-2026-09-30.json) lists every final suite and its exit code.

The broad runner records per-suite exit codes and logs in
`test-results/full-regression/<run>/results.json`. UI scripts write screenshots,
PDFs and result JSON under `tests/artifacts/recipes` and `tests/artifacts/recipe-io`.
These generated local artifacts are deliberately excluded from the source PR.

| Check | Result |
| --- | --- |
| Unit tests, including exact arithmetic/model/archive checks | 245 passed |
| Existing database behavior | 388 checks passed |
| Voucher database behavior | 37 checks passed |
| Operations database behavior | 25 checks passed |
| Recipe database behavior and access | 23 checks passed |
| Backup database/archive/restore behavior | 6 checks passed |
| Edge Function tests, including Drive failure/partial-upload handling | 115 passed |
| Recipe browser workflow | 13 checks passed |
| Real-file import and PDF export browser workflow | 6 checks passed |
| Responsive viewports | 390, 820 and 1440 pixels; no horizontal overflow in tested views |
| Static production build | 24 pages; private library has noindex |
| Broad website regression before final hash optimization | 61/61 suites passed |
| Fresh release regression after all runtime fixes | 61/61 suites passed; no further reproducible failures in that run |
| Local 100 MiB archive benchmark including file hashing | 1,020 ms elapsed, 999 ms CPU, 54 MiB peak RSS |

The database and browser tests include create/edit/duplicate, scaling without
mutation, saved variations, separate R&D and promotion, versions/restore,
archive/recover, search/filter/pagination across 1,000 recipes, revoked permissions,
private fields/photos, concurrency and price history. Browser tests use isolated
API fixtures; database tests exercise the actual migrations/functions separately.
Together these do not constitute a live hosted acceptance test.

The restore test checks full nested rows, original IDs, relationships, historical
prices, actual attachment bytes and saved production quantities in an isolated
database. Modified bytes are rejected. A post-restore audit insert succeeds.
Live Storage upload and hosted Auth restoration have not been performed.

Reproduce targeted tests with `npm run test:recipes`, the broad regression with
`npm run test:full`, and the static build with `npm run build`. The current local
harness uses Node 24, PGlite, Playwright/Chrome, ExcelJS and JSZip; package-root
environment overrides are supported for the shared Codex dependency installation.

## Remaining limits and release requirements

1. **Website publication remains blocked by GitHub integration access.** The backend
   and scheduler are active, but live browser acceptance requires publishing the
   source to the production repository. The fork PR targets a review baseline;
   merging it there does not publish the website.
2. **Backup volume has a hosted runtime constraint.** The Edge worker processes a
   complete archive in one invocation. Supabase's CPU/wall-clock limits can be
   reached by a large photo/version library. The local 100 MiB benchmark is not a
   hosted guarantee. Test representative volume before importing a large library; use persisted
   continuation or a longer-running scheduled worker if it does not fit.
3. OCR and table parsing produce review drafts, not guaranteed exact transcriptions.
   Word/PDF embedded photos are not automatically split into the recipe photo fields.
   Legacy `.doc` requires conversion; English OCR is bundled.
4. PDF uses browser Print / Save as PDF. Page breaks vary with paper/font choices;
   there is no server-generated PDF attachment workflow or offline PWA cache yet.
5. Variations preserve a resolved formula against a pinned base. Updating the base
   does not automatically merge changes into existing variations.
6. Whole-batch component rounding is per requirement; there is no multi-order
   consolidated production planner, shop-stock deduction or ingredient purchasing
   automation. Costing never changes retail prices.
7. Arbitrary volume-to-weight conversion and egg-weight assumptions are not made.
   Practical rounding requires explicit increments. Allergens are an internal aid.
8. Actual disaster recovery requires reconciling real Auth users and uploading file
   bytes through Storage; the isolated rehearsal does not replace that process.
9. Your provided recipe originals and private preview assets remain local and are
   not published in this source PR. No live batch import has been performed.

Recommended next work: publish the website, record hosted backup capacity,
verify next-day unattended retention, perform a staged hosted recovery, then add
optional offline kitchen viewing and a consolidated production planner as separate
changes. Detailed user and recovery instructions are in [RECIPES.md](RECIPES.md)
and [RECIPE-BACKUPS.md](RECIPE-BACKUPS.md).
