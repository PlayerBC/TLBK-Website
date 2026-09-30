# Recipe library and costing

Release status: production database and backup worker deployed on 30 September.
The library is not enabled on the live website yet: GitHub integration access to
the production repository blocks publication. PR #39 in the fork is ready for review.

## Access and approval

Open **Recipes & costing** from the dashboard. The owner can grant selected staff
either Chef or Kitchen permission in the recipe settings. Ordinary staff and
customers receive no recipe access automatically.

| Permission | Access |
| --- | --- |
| Owner | All editing, costs, permissions, backups, approval and Production status |
| Chef | Drafts, testing logs, master resources, production records and costs; cannot approve or publish |
| Kitchen | Published production recipes, packaging, special equipment, temporary scaling, checkoffs and printing |

Kitchen responses are filtered on the server. Costs, supplier details, private
notes, R&D, draft formulas and version history are excluded from their responses,
not simply hidden in the interface. Files use the private `recipe-files` bucket
and expiring authorized links. The page has `noindex`; authorization is enforced
separately by the database and Storage policies.

## Create and organize

Create a recipe manually or import a source and review the draft. Each recipe has
a unique internal code, name, description, category/subcategory, tags, status and
saved versions. Custom categories and tags can be edited. Named size variants
have their own yield, ingredient groups, method, baking stages and packaging.

Ingredient rows include original quantity text, unit, ingredient reference,
brand, supplier, notes, optional formula percentage, price snapshot and practical
rounding increment. Drag rows to reorder or use their arrow buttons. Alt+Enter
in an ingredient row adds another row. The editor's section links reduce scrolling.

Use separate groups for sponge, filling, icing, syrup or assembly. Methods support
steps, timers, temperature, equipment, warnings and process photos. Finished
photos, packaging photos, dimensions, special equipment, production notes and
private notes have their own fields. Multiple baking stages can retain different
top/bottom heat, actual temperature, fan, time and cooling/freezing information.

The library is alphabetical and paginated. Search/filter by name or ingredient,
category, tag, status, flavor, product line, version, author and update date.
Favorites, pins and recently used views are personal to each account.

## Preserve approved formulas

Saving creates an immutable version. A new draft does not replace the published
production version. Only the owner can explicitly approve or publish a version.
Draft autosave is a separate recovery record and never republishes a recipe.
Concurrent edits are checked using a revision number before saving.

History supports viewing, comparing, duplicating and restoring prior versions.
Restoring creates a new version; it does not rewrite the old record. Deletion is
recoverable. Referenced components cannot be deleted while a parent needs them.

Duplicate as an independent recipe, variation or testing copy. Variations retain
their base version and display changed rows. Existing variations do not silently
adopt later changes to the base. This implementation stores a reproducible resolved
formula rather than dynamically inheriting mutable values at production time.

R&D logs keep their own dated observations, changes, baking settings, rating,
next test, photos and proposed formula. A successful test can be explicitly
promoted into a new version. Editing a testing log does not edit the approved recipe.

## Production and scaling

Kitchen view uses large controls and no formula-editing controls. Choose a size and
scale by multiplier, yield, pieces, portion weight, batter/dough weight or pan count.
Base and production ingredient quantities appear together. Original formula values
remain unchanged. Save a scaled copy only when a new saved recipe is intended.

Scaling uses rational arithmetic, including mixed and additive fractions. Exact
values are preserved; display rounding is explicit. Whole-gram or row-specific
practical increments show a rounded marker. Units convert only within compatible
weight or volume units. Cups are not guessed into grams, and eggs are not guessed
into a weight. Baking times and temperatures are never multiplied automatically.

For portion-size scaling, the number of pieces stays the same and ingredient mass
changes. For piece scaling, the portion size stays the same and piece count changes.

Linked components point to a saved approved version and named size. Their required
quantity is expressed in the component yield unit. An available update is shown
for explicit adoption. Ingredient totals and CSV/PDF exports expand linked
components. Exact component quantities are the default; optional whole batches
show the required amount, prepared amount and leftovers. Rounding is applied per
linked component requirement, not as a cross-order production optimizer.

Ingredient/step checkoffs are temporary. Owner/chef users can record completed
production with planned and actual yield against the exact version used. These
records do not modify formulas. Kitchen permission alone cannot record or edit
production records.

## Costs and allergens

Maintain reusable ingredients, suppliers, packaging and equipment. Supplier item
links and price history are retained. Add ingredient purchase size, purchase price
and unit; compatible-unit conversions calculate cost per quantity used. Packaging
can reference a priced master item. Labor, utilities and other costs are separate
optional amounts.

Saved recipes capture historical cost snapshots, including pinned component and
packaging costs. A current cost preview is separate. A master price update does
not rewrite historical costs, approved formulas or shop selling prices. Missing
prices and unsupported unit conversions remain visibly incomplete rather than
being represented as a complete zero-cost formula.

Allergens derive from selected master ingredients and pinned components, with an
explicit manual override. This is an internal recipe aid, not a certification of
allergen compliance or cross-contact safety.

## Imports and exports

Supported imports: `.docx`, text/scanned PDF, common image files and pasted text.
Extraction and OCR run locally in the browser with vendored libraries and English
OCR data. The source is retained privately when saved. Review ingredients, units,
fractions, yields and instructions before approval; OCR can misread them.

Limits: 25 MB per uploaded file, 100 PDF pages and 250,000 extracted characters.
Old `.doc` files need conversion to `.docx`. Embedded product/process photos are
not automatically extracted from Word/PDF into the photo fields; add those photos
separately. Complex table layouts and handwriting may need substantial correction.
Imports never infer that an incomplete formula is ready for production.

**Print / PDF** opens a prepared print layout; choose Save as PDF in the browser.
Choose kitchen A or branded presentation B, A4/Letter, typography, spacing,
page-break preferences and optional content. Packaging, special equipment and
extra notes use a separate reference page when content exists. Export a single
recipe, selected recipes or a category/book with an alphabetical contents page.
Pagination is browser-generated; inspect the print preview when changing fonts.

Ingredient CSV preserves structured rows and protects spreadsheet text cells from
formula injection. Combined totals do not merge ingredients with incompatible units.

## Backups and recovery

See [RECIPE-BACKUPS.md](RECIPE-BACKUPS.md) for the exact archive contents,
schedule, retention, deployment steps, recovery procedure and runtime limits.
See [RECIPE-RELEASE-2026-09-30.md](RECIPE-RELEASE-2026-09-30.md) for test evidence
and outstanding production verification.
