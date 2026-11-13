import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { runInNewContext } from "node:vm";
import { transform } from "@astrojs/compiler-rs";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import ts from "typescript";

const moduleUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const testImage = {
  id: "test-image",
  url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E",
  alt: "Test artwork",
};

async function compileComponent(filename, imports = {}, source) {
  const { code } = transform(
    source ?? (await readFile(new URL(filename, import.meta.url), "utf8")),
    {
      filename,
      internalURL: import.meta.resolve("astro/compiler-runtime"),
      resultScopedSlot: true,
      resolvePath: (specifier) => specifier,
    },
  );
  let compiled = code.replace(/^import ".*\.css";$/gm, "").replace(/^import type .*;$/gm, "");
  for (const [specifier, url] of Object.entries(imports)) {
    compiled = compiled.replaceAll(JSON.stringify(specifier), JSON.stringify(url));
  }
  return moduleUrl(compiled);
}

async function loadArchive() {
  const button = await compileComponent("./Button.astro");
  const filters = new URL("../lib/product-filters.ts", import.meta.url).href;
  const archiveUrl = await compileComponent("./ProductArchive.astro", {
    "@components/ProductFilters.astro": await compileComponent("./ProductFilters.astro", {
      "@components/Button.astro": button,
      "@components/PriceRange.astro": await compileComponent("./PriceRange.astro"),
    }),
    "@components/ProductCard.astro": await compileComponent("./ProductCard.astro", {
      "@components/Button.astro": button,
      "@components/NewBadge.astro": await compileComponent("./NewBadge.astro"),
      "@components/ProductPrice.astro": await compileComponent("./ProductPrice.astro"),
      "astro:assets": moduleUrl(
        `export { default as Image } from ${JSON.stringify(await compileComponent("TestImage.astro", {}, "<img src={Astro.props.src} alt={Astro.props.alt} />"))};`,
      ),
    }),
    "@components/Pagination.astro": await compileComponent("./Pagination.astro", {
      "@components/Button.astro": button,
      "@lib/product-filters": filters,
    }),
    "@lib/product-filters": filters,
  });
  const { default: Archive } = await import(archiveUrl);
  return Archive;
}

test("archive renders the requested page and caches other cards in inert templates", async () => {
  const Archive = await loadArchive();
  const container = await AstroContainer.create();
  const products = Array.from({ length: 241 }, (_, index) => ({
    id: `${index}`,
    slug: `art-${index}`,
    name: `Art ${index}`,
    collection: "originals",
    subcategories: ["Animals", "Landscapes"],
    orientation: "Portrait",
    isNew: index === 0 || index === 20,
    price: { amount: 1000 + index, currency: "CAD" },
    description: "",
    variations: [],
    images: index === 0 || index === 20 ? [testImage] : [],
  }));
  const render = (query = "", items = products) =>
    container.renderToString(Archive, {
      props: { products: items },
      request: new Request(`https://example.test/products/originals${query}`),
    });

  const visibleList = (html) =>
    html.match(/<ul\b[^>]*aria-label="Products"[^>]*>([\s\S]*?)<\/ul>/)[1];
  const first = await render();
  assert.equal((visibleList(first).match(/data-product-id=/g) ?? []).length, 20);
  assert.equal((first.match(/data-product-id=/g) ?? []).length, 241);
  assert.doesNotMatch(visibleList(first), /data-product-id="20"/);
  assert.doesNotMatch(first, /Apply filters|rel="prev"/);
  assert.doesNotMatch(first, /data-clear-filters|Clear filters/);
  assert.match(first, /<template data-product-cache/);
  assert.match(first, /rel="next"/);
  assert.match(first, /method="get" action="\/products\/originals"/);
  assert.match(first, /<price-range\b/);
  assert.match(visibleList(first), /class="new-badge[^"]*"[^>]*>New<\/span>/);
  assert.match(
    visibleList(first),
    /class="product-card__media\b[^"]*"[^>]*>[\s\S]*?new-ribbon[\s\S]*?<\/div>/,
  );
  assert.equal((first.match(/class="new-badge/g) ?? []).length, 2);
  const second = await render("?page=2");
  assert.match(visibleList(second), /class="new-badge[^"]*"[^>]*>New<\/span>/);

  const middle = await render("?category=Animals&orientation=Portrait&minPrice=1010&page=5");
  assert.equal((visibleList(middle).match(/data-product-id=/g) ?? []).length, 20);
  assert.match(visibleList(middle), /data-product-id="90"/);
  assert.doesNotMatch(visibleList(middle), /data-product-id="89"|data-product-id="110"/);
  assert.doesNotMatch(middle, /data-clear-filters|Clear filters/);
  assert.match(middle, /aria-current="page" aria-label="Page 5"/);
  assert.match(middle, /aria-label="Page 4"/);
  assert.match(middle, /aria-label="Page 6"/);
  assert.match(middle, /aria-label="Page 1"/);
  assert.match(middle, /aria-label="Page 12"/);
  assert.doesNotMatch(middle, /aria-label="Page 2"/);
  assert.match(middle, /category=Animals&amp;orientation=Portrait&amp;minPrice=1010&amp;page=6/);
  assert.match(middle, /name="category" value="Animals" checked/);
  assert.match(middle, /min="1000" max="1240" step="1" value="1010"/);
  assert.doesNotMatch(visibleList(middle), /new-badge/);

  const last = await render("?page=13");
  assert.equal((visibleList(last).match(/data-product-id=/g) ?? []).length, 1);
  assert.match(last, /rel="prev"/);
  assert.doesNotMatch(last, /rel="next"/);
  const empty = await render("", []);
  assert.match(empty, /No products are currently available/);
  assert.doesNotMatch(empty, /<price-range\b/);
  assert.match(empty, /aria-label="Product pages" hidden/);
  const sparse = [
    { ...products[0], subcategories: ["Animals"], orientation: "Portrait" },
    { ...products[1], subcategories: ["Landscapes"], orientation: "Landscape" },
  ];
  const narrowed = await render("?orientation=Portrait", sparse);
  assert.match(narrowed, /<label\b[^>]*hidden[^>]*>\s*<input[^>]*value="Landscapes"/);
  const stale = await render("?category=Landscapes&orientation=Portrait", sparse);
  assert.match(stale, /No products match your filters/);
  assert.equal((visibleList(stale).match(/data-product-id=/g) ?? []).length, 0);
  assert.match(stale, /name="category" value="Landscapes" checked/);
  assert.match(stale, /data-filter-count[^>]*>\(0\)/);
});

test("shared price markup shows accessible regular/sale prices, including free sales", async () => {
  const { default: Price } = await import(await compileComponent("./ProductPrice.astro"));
  const container = await AstroContainer.create();
  const render = (amount, regularAmount = amount) =>
    container.renderToString(Price, {
      props: {
        price: amount === null ? null : { amount, currency: "USD" },
        regularPrice: { amount: regularAmount, currency: "USD" },
      },
    });
  const sale = await render(20000, 25000);
  assert.match(sale, /Regular price:/);
  assert.match(sale, /<s\b[^>]*>\$250\.00<\/s>/);
  assert.match(sale, /Sale price:/);
  assert.match(sale, /product-price__sale[^>]*>\$200\.00/);
  assert.match(await render(0, 25000), /product-price__sale[^>]*>\$0\.00/);
  const regular = await render(25000);
  assert.match(regular, /\$250\.00/);
  assert.doesNotMatch(regular, /<s\b|Sale price:|Regular price:/);
  assert.doesNotMatch(await render(null), /product-price|\$/);

  const Archive = await loadArchive();
  const archive = await container.renderToString(Archive, {
    props: {
      products: [
        {
          id: "sale",
          slug: "sale",
          name: "Sale artwork",
          collection: "originals",
          subcategories: [],
          orientation: null,
          images: [],
          variations: [],
          price: { amount: 20000, currency: "USD" },
          regularPrice: { amount: 25000, currency: "USD" },
        },
      ],
    },
    request: new Request("https://example.test/products/originals"),
  });
  assert.match(archive, /<s\b[^>]*>\$250\.00<\/s>/);
  assert.match(archive, /product-price__sale[^>]*>\$200\.00/);
});

test("product pages render the selected variation's price and single-variation sale price", async () => {
  const layout = await compileComponent("PriceTestLayout.astro", {}, "<slot />");
  const unusedMedia = moduleUrl(`
    function unused() { throw new Error("Media is not part of this test"); }
    export { unused as Image, unused as Swiper, unused as SwiperButtonNext,
      unused as SwiperButtonPrev, unused as SwiperPagination, unused as SwiperSlide,
      unused as SwiperWrapper };
  `);
  const container = await AstroContainer.create();
  const variations = [
    {
      id: "small",
      size: "Small",
      quantity: 1,
      price: { amount: 10000, currency: "USD" },
      regularPrice: { amount: 10000, currency: "USD" },
      inventory: [{ quantity: 1 }],
    },
    {
      id: "large",
      size: "Large",
      quantity: 1,
      price: { amount: 2000, currency: "USD" },
      regularPrice: { amount: 25000, currency: "USD" },
      inventory: [{ quantity: 1 }],
    },
  ];
  const render = async (sizes, isNew = false) => {
    const product = {
      id: "art",
      slug: "sale-art",
      name: "Sale artwork",
      collection: "originals",
      description: "",
      images: [],
      inStock: true,
      isNew,
      variations: sizes,
      price: variations[1].price,
      regularPrice: variations[1].regularPrice,
    };
    const { default: Page } = await import(
      await compileComponent("../pages/products/[category]/[slug].astro", {
        "@layouts/SiteLayout.astro": layout,
        "@components/Button.astro": await compileComponent("./Button.astro"),
        "@components/NewBadge.astro": await compileComponent("./NewBadge.astro"),
        "@components/ProductPrice.astro": await compileComponent("./ProductPrice.astro"),
        "@lib/load-products": moduleUrl(
          `export async function loadProducts() { return [${JSON.stringify(product)}]; }`,
        ),
        "astro:assets": unusedMedia,
        "astro-swiper": unusedMedia,
      })
    );
    return container.renderToString(Page, {
      params: { category: "originals", slug: "sale-art" },
      request: new Request("https://example.test/products/originals/sale-art"),
    });
  };
  const multi = await render(variations, true);
  assert.match(multi, /class="new-badge[^"]*"[^>]*>New<\/span>/);
  assert.match(multi, /class="product-header__media\b[^"]*"[^>]*>\s*<span class="new-ribbon\b/);
  assert.doesNotMatch(multi.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)[1], /new-ribbon/);
  assert.match(multi, /<option value="small" selected/);
  assert.match(multi, /data-variation-price="small"(?![^>]*hidden)[^>]*>[\s\S]*?\$100\.00/);
  const sale = multi.match(/data-variation-price="large" hidden[^>]*>([\s\S]*?)<\/p>/)[1];
  assert.match(sale, /<s\b[^>]*>\$250\.00<\/s>/);
  assert.match(sale, /product-price__sale[^>]*>\$20\.00/);
  const single = await render([variations[1]]);
  assert.match(single, /<s\b[^>]*>\$250\.00<\/s>/);
  assert.match(single, /product-price__sale[^>]*>\$20\.00/);
  assert.doesNotMatch(single, /product-size-selector/);
  assert.doesNotMatch(single, /new-badge/);
});

test("size selection keeps regular and sale prices paired and synchronizes on page load", async () => {
  const source = await readFile(
    new URL("../pages/products/[category]/[slug].astro", import.meta.url),
    "utf8",
  );
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];
  const prices = ["small", "large"].map((id) => ({
    dataset: { variationPrice: id },
    hidden: false,
  }));
  const selector = { value: "small" };
  let pageLoad;
  runInNewContext(ts.transpile(script, { target: ts.ScriptTarget.ES2022 }), {
    document: {
      addEventListener(name, callback) {
        assert.equal(name, "astro:page-load");
        pageLoad = callback;
      },
      querySelector: () => selector,
      querySelectorAll: () => prices,
    },
  });
  pageLoad();
  assert.deepEqual(
    prices.map(({ hidden }) => hidden),
    [false, true],
  );
  selector.value = "large";
  selector.onchange();
  assert.deepEqual(
    prices.map(({ hidden }) => hidden),
    [true, false],
  );
  pageLoad();
  assert.deepEqual(
    prices.map(({ hidden }) => hidden),
    [true, false],
  );
});

test("price range constrains both thumbs and updates prices, track, and accessible bounds", async () => {
  const source = await readFile(new URL("./PriceRange.astro", import.meta.url), "utf8");
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];
  const input = (value) => ({
    value,
    min: "1000",
    max: "2000",
    style: {},
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  });
  const min = input("1000");
  const max = input("1800");
  const minLabel = {};
  const maxLabel = {};
  const nodes = {
    '[name="minPrice"]': min,
    '[name="maxPrice"]': max,
    "[data-min-label]": minLabel,
    "[data-max-label]": maxLabel,
  };
  const styles = {};
  const listeners = new Map();
  let Range;
  runInNewContext(ts.transpile(script, { target: ts.ScriptTarget.ES2022 }), {
    HTMLElement: class {
      dataset = { currency: "CAD" };
      style = { setProperty: (name, value) => (styles[name] = value) };
      querySelector(selector) {
        return nodes[selector];
      }
      addEventListener(name, callback) {
        assert.ok(!listeners.has(name), "reconnecting must not duplicate listeners");
        listeners.set(name, callback);
      }
    },
    customElements: {
      define(name, element) {
        assert.equal(name, "price-range");
        Range = element;
      },
    },
  });
  const range = new Range();
  range.connectedCallback();
  range.connectedCallback();
  assert.equal(listeners.size, 2);
  min.value = "1900";
  listeners.get("input")({ target: min });
  assert.equal(min.value, "1800");
  assert.equal(minLabel.textContent, "CA$18.00");
  assert.equal(styles["--range-start"], "80%");
  assert.equal(max.attributes["aria-valuemin"], "1800");
  max.value = "1500";
  listeners.get("input")({ target: max });
  assert.equal(max.value, "1800");
  assert.equal(maxLabel.textContent, "CA$18.00");
  assert.equal(min.attributes["aria-valuemax"], "1800");
  min.value = max.value = "2000";
  listeners.get("input")({ target: min });
  assert.equal(min.style.zIndex, "2", "lower thumb stays reachable at the upper endpoint");
  min.min = min.max = min.value = max.value = "1000";
  listeners.get("price-range:sync")();
  assert.equal(styles["--range-start"], "0%");
  assert.equal(styles["--range-end"], "0%");
});

test(
  "browser updates facet counts, hides unavailable options, and prevents empty results without requests",
  {
    skip: !process.env.CHROME_BIN,
  },
  async () => {
    const Archive = await loadArchive();
    const container = await AstroContainer.create();
    const products = Array.from({ length: 61 }, (_, index) => ({
      id: `${index}`,
      slug: `art-${index}`,
      name: `Art ${index}`,
      collection: "originals",
      subcategories: [index % 2 ? "Animals" : "Landscapes"],
      orientation: index % 2 ? "Portrait" : "Landscape",
      price: { amount: 1000 + index, currency: "CAD" },
      description: "",
      variations: [],
      isNew: index === 0,
      images: index === 0 ? [testImage] : [],
    }));
    const markup = await container.renderToString(Archive, {
      props: { products },
      request: new Request("http://localhost/products/originals"),
    });
    const transpile = (source) =>
      ts.transpile(source, {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      });
    const filters = moduleUrl(
      transpile(await readFile(new URL("../lib/product-filters.ts", import.meta.url), "utf8")),
    );
    const scripts = await Promise.all(
      ["PriceRange", "ProductFilters", "Pagination", "ProductArchive"].map(async (name) => {
        const source = await readFile(new URL(`./${name}.astro`, import.meta.url), "utf8");
        return moduleUrl(
          transpile(source.match(/<script>([\s\S]*?)<\/script>/)[1]).replaceAll(
            '"@lib/product-filters"',
            JSON.stringify(filters),
          ),
        );
      }),
    );
    const styles = await Promise.all(
      ["NewBadge", "ProductCard"].map(async (name) => {
        const source = await readFile(new URL(`./${name}.astro`, import.meta.url), "utf8");
        return source.match(/<style>([\s\S]*?)<\/style>/)[1];
      }),
    );
    const html = `<!doctype html><html><head><style>${styles.join("\n")}</style></head><body>${markup.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")}
    <script type="module">
      ${scripts.map((url) => `import ${JSON.stringify(url)};`).join("\n")}
      try {
        const check = (condition, message) => { if (!condition) throw new Error(message); };
        document.dispatchEvent(new Event("astro:page-load"));
        const root = document.querySelector("[data-product-archive]");
        const list = root.querySelector(".products__list");
        const nav = root.querySelector(".pagination");
        const min = root.querySelector('[name="minPrice"]');
        const max = root.querySelector('[name="maxPrice"]');
        const change = (input) => input.dispatchEvent(new Event("input", { bubbles: true }));
        const select = (name, value) => {
          const input = root.querySelector('[name="' + name + '"][value="' + value + '"]');
          input.checked = true; change(input);
        };
        const option = (name, value) =>
          root.querySelector('[name="' + name + '"][value="' + value + '"]').closest("[data-filter-option]");
        const feedback = root.querySelector("[data-filter-feedback]");
        check(list.children.length === 20 && !root.querySelector("[data-clear-filters]"), "initial page without clear control");
        const ribbon = list.querySelector(".new-ribbon");
        const media = ribbon.closest(".product-card__media");
        const ribbonBox = ribbon.getBoundingClientRect();
        const mediaBox = media.getBoundingClientRect();
        check(Math.abs(ribbonBox.top - mediaBox.top) < 1 && Math.abs(ribbonBox.left - mediaBox.left) < 1, "ribbon anchored to image corner");
        const matrix = new DOMMatrix(getComputedStyle(ribbon.querySelector(".new-badge")).transform);
        check(Math.abs(Math.atan2(matrix.b, matrix.a) * 180 / Math.PI + 45) < 0.1, "diagonal ribbon");
        check(getComputedStyle(ribbon).overflow === "hidden" && getComputedStyle(ribbon).pointerEvents === "none", "ribbon clipped without blocking clicks");
        check(option("category", "Animals").textContent.includes("(30)"), "count across all pages");
        nav.querySelector('[rel="next"]').click();
        check(list.firstElementChild.dataset.productId === "20", "next page");
        select("category", "Animals");
        check(list.children.length === 20 && list.firstElementChild.dataset.productId === "1", "category resets page");
        check(!nav.querySelector('[rel="prev"]'), "active controls");
        select("category", "Landscapes");
        check(list.firstElementChild.dataset.productId === "0", "OR categories");
        select("orientation", "Portrait");
        check(list.firstElementChild.dataset.productId === "1", "AND orientation");
        check(!option("category", "Landscapes").hidden && option("category", "Landscapes").textContent.includes("(0)"), "selected zero-count option stays visible");
        const animals = root.querySelector('[name="category"][value="Animals"]');
        const landscapes = root.querySelector('[name="category"][value="Landscapes"]');
        const beforeRemoval = location.search;
        animals.checked = false; change(animals);
        check(animals.checked && feedback.textContent && location.search === beforeRemoval, "reject empty OR deselection");
        landscapes.checked = false; change(landscapes);
        check(!landscapes.checked && option("category", "Landscapes").hidden, "selected zero-count option can be removed");
        check(option("orientation", "Landscape").hidden, "hide unavailable orientation");
        min.value = "1030"; change(min);
        check(list.children.length === 15 && nav.hidden, "live price filtering");
        max.value = "1030"; change(max);
        check(max.value === "1030" && list.children.length === 0 && nav.hidden, "allow empty price range");
        check(root.querySelector("[data-max-label]").textContent === "CA$10.30", "retain empty range label");
        check(!feedback.textContent && location.search.includes("maxPrice=1030"), "retain empty range URL without rejection");
        check(root.querySelector("[data-results-status]").textContent.includes("No products match"), "empty range message");
        max.value = "1060"; change(max);
        check(list.children.length === 15, "widen price range to recover");
        min.value = "1060"; change(min);
        check(list.children.length === 0 && !feedback.textContent, "allow empty minimum price change");
        min.value = min.min; change(min);
        animals.checked = false; change(animals);
        const portrait = root.querySelector('[name="orientation"][value="Portrait"]');
        portrait.checked = false; change(portrait);
        check(min.value === "1000" && max.value === "1060", "restore price values manually");
        check(root.querySelector("[data-min-label]").textContent === "CA$10.00", "restore price label");
        check(list.children.length === 20 && !nav.hidden && !location.search && !feedback.textContent, "recover by widening price and deselecting filters");
        check(!option("category", "Landscapes").hidden && !option("orientation", "Landscape").hidden, "restore available options");
        max.value = "1000"; change(max);
        check(option("category", "Animals").hidden, "hide zero-count unselected option");
        select("category", "Animals");
        check(!animals.checked && list.children.length === 1 && feedback.textContent, "prevent forced incompatible selection");
        max.value = max.max; change(max);
        document.dispatchEvent(new Event("astro:page-load"));
        nav.querySelector('[aria-label="Page 4"]').click();
        check(list.children.length === 1 && list.firstElementChild.dataset.productId === "60", "last page");
        check(!nav.querySelector('[rel="next"]') && nav.querySelector('[rel="prev"]'), "last page controls");
        check(location.search === "?page=4", "page URL");
        document.body.dataset.browserResult = "passed";
      } catch (error) {
        document.body.dataset.browserResult = "failed: " + error.message;
      }
    </script></body></html>`;
    let requests = 0;
    const server = createServer((request, response) => {
      if (!request.url.startsWith("/products/originals")) {
        response.writeHead(404).end();
        return;
      }
      requests++;
      response.writeHead(200, { "Content-Type": "text/html" }).end(html);
    });
    const profile = await mkdtemp(join(tmpdir(), "archive-browser-"));
    try {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const { stdout } = await promisify(execFile)(
        process.env.CHROME_BIN,
        [
          "--headless",
          "--disable-gpu",
          "--disable-background-networking",
          "--no-first-run",
          `--user-data-dir=${profile}`,
          "--dump-dom",
          `http://127.0.0.1:${server.address().port}/products/originals`,
        ],
        { timeout: 20_000, maxBuffer: 2_000_000 },
      );
      assert.equal(stdout.match(/data-browser-result="([^"]*)"/)?.[1], "passed");
      assert.equal(requests, 1, "filtering and pagination must not reload the archive");
    } finally {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(profile, { recursive: true, force: true });
    }
  },
);
