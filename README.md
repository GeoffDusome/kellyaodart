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

Catalog conventions agreed so far: originals and reproductions are separate Square
products, each with its own landing page (`/products/originals` and
`/products/reproductions`), so no
original-vs-reproduction filter is needed. Square category `Reproductions` maps
to reproductions; `Originals` maps to originals.
Originals and new reproductions have one size;
`Regular` means there are no size choices. Older reproductions may have multiple size
variations, named with their dimensions (for example `12x12` and `24x24`).
Orientation comes from the Square `Orientation` custom attribute.

Run the local check with
`node --test src/lib/products.test.mjs src/lib/square.test.mjs`.

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
