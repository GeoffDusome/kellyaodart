# kellyaodart

Static Astro website for Kelly AOD Art. Square is the product source of truth.
Astro generates a sitemap for `https://kellyaodart.com` during builds.

## Development

Requires Node.js 22.23.4 or newer.

```sh
npm install
node --env-file=.env scripts/square-catalog-snapshot.mjs
npm run dev
```

The Square snapshot is required for archive and product routes. Run
`npm run build` to fetch a fresh snapshot and create a production build.
Local builds load `.env`; deployment builds use the host's environment variables.

## Vercel

Use `npm run build` as the Build Command and `dist` as the Output Directory.
In the project's environment variables, set `SQUARE_ACCESS_TOKEN` to the
read-only token and `SQUARE_ENVIRONMENT` to `sandbox` for testing (or
`production` for the live catalog). Set them for each deployment environment
you use, then redeploy.

Do not upload `.env` or commit the snapshot. Every build fetches its own data
and fails if Square cannot be reached or the credentials are invalid.

`/products/originals` and `/products/prints` list in-stock products. Each Square
item also gets a static `/products/<category>/<slug>` page, where category is
`originals` or `prints`. Product data includes category, description,
orientation, image URLs, variation sizes and prices, plus inventory by
location. The current stock total combines locations; choose a fulfillment
location before using it as a purchasable quantity.

## Square catalog snapshot

Create a Square developer app and a **read-only** sandbox token with
`ITEMS_READ` and `INVENTORY_READ` permissions. Put it in a local `.env` file
(never commit that file):

```sh
SQUARE_ACCESS_TOKEN=your-sandbox-token
```

Run the snapshot with Node.js 20.6 or newer:

```sh
node --env-file=.env scripts/square-catalog-snapshot.mjs
```

The script writes catalog objects and inventory counts to
`data/square-catalog-snapshot.json`; that file is ignored by Git. For a live
catalog, set `SQUARE_ENVIRONMENT=production`.

Catalog conventions agreed so far: originals and prints are separate Square
products, each with its own landing page (`/products/originals` and
`/products/prints`), so no
original-vs-print filter is needed. Originals and new prints have one size;
`Regular` means there are no size choices. Older prints may have multiple size
variations, named with their dimensions (for example `12x12` and `24x24`).
Orientation comes from the Square `Orientation` custom attribute.

Run the local check with
`node --test scripts/square-catalog-snapshot.test.mjs`.
