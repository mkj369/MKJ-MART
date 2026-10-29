# Replacing the demo catalogue with real products

The demo catalogue (15 products, AI-generated photos in `public/images/demo/`) exists only to show the store
working. Real stores should start without it.

## Option A — new production store (recommended)
Deploy without `--demo` (see [DEPLOYMENT.md](DEPLOYMENT.md)); the database then contains only sizes, colours and
delivery zones. Create your catalogue in the admin.

## Option B — a database that already has demo data
1. Sign in with your **own** administrator account (`npm run admin:create`), not a demo account.
2. Admin → Settings → Demo data → *Remove demo data*. Anything real orders depend on is kept (archived/disabled)
   and reported; everything else flagged demo is deleted.
3. Confirm the launch checklist shows *Demo data removed*.

## Creating products
1. **Categories** (Admin → Categories): e.g. Men → Panjabi, Shirts; Women → Kurtis & sets, Sarees.
2. **Sizes & colours** (Admin → Sizes & colours): add any missing sizes (e.g. waist sizes, shoe sizes).
3. **Products** (Admin → Products → New): name, description, material, care, category, price (৳), optional
   compare-at price, tags, collections; then **variants** — one per size/colour with its own SKU and opening stock
   (recorded in the stock ledger). Save as **Draft** until photos are ready; publishing requires at least one photo.
4. **Photos**: upload JPEG/PNG/WebP/AVIF up to 8 MB and at least 300×300 px. Images are re-encoded to WebP
   (max 1800 px), EXIF/GPS metadata is stripped. For a consistent look use a 3:4 portrait ratio, the same
   background and lighting for every product, at least 1200×1600 px, the first image as the main shot.
5. **Collections** (Admin → Collections) for curated edits on the home page.
6. Check the storefront page of each product (sizes, stock badges, price) before publishing.

Stock changes after launch: Admin → Inventory (adjustments are written to the ledger with a reason). Sales,
cancellations and returns move stock automatically.
