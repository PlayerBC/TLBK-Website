# Product and category ordering

In Dashboard → Products, first open **Arrange categories**, then **Arrange products**. Drag the six-dot handles, then click **Save order**. Arrow keys, Home and End also move the focused row. Reordering works on mobile; long lists scroll while dragging near the dialog edge.

Products are grouped by the saved category order; drag only within each category. The list includes hidden products and those excluded by menu filters. The customer's All products view uses category order first and product order within each category, with Uncategorized last. Category ordering also controls the shop's category navigation. Reset restores the saved order. Unsaved changes are retained after a failed save and guarded when closing. Product and category forms no longer require display-order numbers; new entries append, and ordinary edits retain their position.

`reorder_catalog` is an owner-only action on the existing shop API. One transaction validates the full ID list and previous order, then updates only `sort_order`. Missing items, duplicates and stale concurrent changes are rejected. A retry of an already-saved order is harmless. The internal helper has no direct anonymous/authenticated execution grant. Apply `20260921085250_catalog_drag_order.sql` before publishing the frontend.

Validation: `node tests/backend/run.mjs`, `node tests/ui/catalog-order.mjs`, `node tests/ui/product-photos.mjs`, and `node scripts/build-static.mjs`. Browser suites use local fixtures, not customer data.
