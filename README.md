# kellyaodart

Astro website for Kelly AOD Art. Square is the product source of truth.
Content pages are static; shop pages and the product sitemap render on demand.

## Development

Development and CI use Node.js 24.18.0 (`.nvmrc`) and npm 11.16.0 (`package.json`).

```sh
nvm install
nvm use
npm install --global "$(node -p 'require("./package.json").packageManager')"
npm ci
npm run dev
```

Run `npm run build` to create a production build. Builds do not contact Square.
Local development loads `.env`; deployed routes use the host's environment variables.

## Code quality

ESLint checks JavaScript, TypeScript, and Astro components using the recommended
rules. Prettier handles formatting, including Astro, CSS, Markdown, and YAML.

```sh
npm run lint
npm run format:check
```

Use `npm run lint:fix` for auto-fixable lint issues and `npm run format` to format
the project. Generated output and dependencies are excluded.

Zed formats on save using the project's Prettier configuration via
`.zed/settings.json`. Run `npm install` and install Zed's Astro extension for
`.astro` support.

GitHub Actions runs both checks on pull requests and pushes to `main`, using
`.nvmrc`, the npm version in `package.json`, and `npm ci`. Use `npm ci` locally
to install the same locked dependencies. ESLint and formatting are separate
checks: run both commands above before pushing. Neither needs deployment credentials.

## Vercel

Use Vercel's Astro framework preset and `npm run build` as the Build Command.
Remove any Output Directory override: the Vercel adapter generates static
pages and serverless routes in `.vercel/output`.
In the project's environment variables, set `SQUARE_ACCESS_TOKEN` to the
read-only token and `SQUARE_ENVIRONMENT` to `sandbox` for testing (or
`production` for the live catalog). Set them for each deployment environment
you use, then redeploy.

Do not upload `.env`. Square credentials are used server-side at request time.

`/products/originals` and `/products/reproductions` list in-stock products. Each Square
item has a `/products/<category>/<slug>` page, where category is
`originals` or `reproductions`. Product data includes category, description,
orientation, image URLs, variation sizes and prices, plus inventory by
location. The current stock total combines locations; choose a fulfillment
location before using it as a purchasable quantity.

## Square catalog

Create a Square developer app and a **read-only** sandbox token with
`ITEMS_READ` and `INVENTORY_READ` permissions. Put it in a local `.env` file
(never commit that file):

```sh
SQUARE_ACCESS_TOKEN=your-sandbox-token
SQUARE_ENVIRONMENT=sandbox
```

Shop requests fetch the catalog and inventory directly from Square. Successful
results are cached for 60 seconds per function instance, with concurrent requests
sharing one fetch. No disk snapshots, rebuild hooks, or client-side credentials
are involved. New products appear without a redeploy once the cache expires.
Square failures fail the request explicitly rather than showing an empty shop.
Unknown products and category mismatches return 404; sold items keep their pages.
The sitemap index links to `/sitemap-products.xml`, which uses the same live data.
For a live catalog, set `SQUARE_ENVIRONMENT=production`.

The catalog request includes Square's currently undocumented `SALE_PRICE` object type.
Fixed-amount sales are matched to their variation: `price` is the effective selling
price and `regularPrice` preserves its original price. Cards and product pages share
`ProductPrice`, which strikes through the regular price when discounted. Archive
price limits and filtering use the effective price of the cheapest in-stock variation;
its original price always comes from that same variation. Selecting a size updates
both prices on the product page. Deleted sales revert to regular pricing.
Unsupported sale types, invalid amounts/currency, multiple active sales per variation,
and location-specific sales fail explicitly rather than displaying a guessed price.
Location-specific sales require choosing a storefront fulfillment location first.
Sale prices use the same 60-second catalog cache. This is display/filter support;
the Add to Cart markup is not yet a checkout integration.

Catalog conventions agreed so far: originals and reproductions are separate Square
products, each with its own landing page (`/products/originals` and
`/products/reproductions`), so no
original-vs-reproduction filter is needed. Square category `Reproductions` maps
to reproductions; `Originals` maps to originals.
Originals and new reproductions have one size;
`Regular` means there are no size choices. Older reproductions may have multiple size
variations, named with their dimensions (for example `12x12` and `24x24`).
Orientation comes from the Square `Orientation` custom attribute.
The item-level boolean custom attribute `New` controls `Product.isNew` and a shared
diagonal `NewBadge` ribbon over the top-left image corner on cards and product pages.
Only an explicitly checked value shows the
badge; unchecked or unset values do not. Changes appear after the catalog cache
expires (up to 60 seconds); the flag does not expire automatically.

Archives filter instantly in the browser and display 20 matching products per page. Category
options come from assigned subcategories beneath the current collection, including
nested ancestors; assigning a subcategory alone also places an item in its parent
collection. Category and orientation selections use OR within each group and AND
between groups. A two-thumb price slider uses the full collection's lowest and highest
displayed prices (the cheapest in-stock variation), in cents. Products without a price
remain visible until a price limit is narrowed. Checkboxes and price changes update results
immediately and reset to page one; no Apply button or additional request is needed.
Category and orientation options show live counts across the full collection, applying
the other filter groups and price range but ignoring selections within their own group.
Unavailable options are hidden; selected options remain visible and removable even at
zero. Checkbox changes that would turn nonempty results into an empty set are rejected
with an explanation, restoring the previous selections. Price changes may show an empty
state; widen the range or deselect filters to recover. Outdated shared links
can still show an empty state and use the same controls to recover.
Filter and page changes replace the current URL without navigation, so shared links and
reloads preserve selections without adding a history entry for every slider movement.
Numbered pagination shows the current page, its neighbors,
and the first and last pages, with ellipses across gaps. Previous/Next links appear only
when another page exists in that direction. Only the current page's cards are in the live
product list; remaining cards are stored in inert HTML templates, so their images are not
loaded until displayed. The full catalog's card markup and lightweight filter data still
ship with the page; reconsider server pagination if that payload becomes too large.
Without JavaScript, the filter submit button and pagination use server-rendered results.
`ProductFilters`, `PriceRange`, `ProductCard`, and `Pagination` own their respective UI;
`ProductArchive` coordinates filtering and the displayed cards.

Run the local check with
`node --test src/lib/products.test.mjs src/lib/square.test.mjs`.
Check archive filtering, pagination, and the price slider with
`node --test src/lib/product-filters.test.mjs src/components/ProductArchive.test.mjs`.
Set `CHROME_BIN` to a Chrome/Chromium executable when running that command to also
exercise live filtering, empty-state recovery, and pagination in an isolated headless browser.

## Twitch

Register an app at <https://dev.twitch.tv/console/apps> and put these variables
in your local `.env` and Vercel's Production/Preview environments:

```sh
TWITCH_CLIENT_ID=your-app-client-id
TWITCH_CLIENT_SECRET=your-app-client-secret
TWITCH_CHANNEL=channel_login
```

Use the channel's login name, not a URL. Never prefix credentials with `PUBLIC_`.
Restart `npm run dev` after editing `.env`, or redeploy on Vercel.

The home and `/live` pages call `/api/twitch-live` once on page load. The player
shows the live stream or, when offline, the most recent archived broadcast
(VOD), muted and without autoplay. Enable past-broadcast storage in Twitch to
make VODs available; if none are saved or they have expired, only the Twitch
link is shown.
The player uses the current hostname as Twitch's required `parent`, including
preview domains. Twitch requires HTTPS outside localhost and a minimum 400px
player width; smaller screens use the external link.

App tokens are cached until shortly before expiry and successful status checks
for 60 seconds per function instance (and at Vercel's CDN). Errors return 503,
not a false offline status. The calendar's "next show" can be added when the
calendar integration exists.

Run the integration's mocked check with `node --test src/lib/twitch.test.mjs`.
