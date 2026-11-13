import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProducts } from "./products.ts";
import { getArchiveState } from "./product-filters.ts";

test("normalizes archive and product data from a Square snapshot", () => {
  const snapshot = {
    catalog: [
      {
        id: "art-1",
        type: "ITEM",
        item_data: {
          name: "Square Artwork",
          description: "Test description",
          variations: [
            {
              id: "regular",
              item_variation_data: {
                name: "Regular",
                price_money: { amount: 2500, currency: "USD" },
              },
            },
          ],
          categories: [{ id: "reproductions" }],
          image_ids: ["image-1"],
        },
        custom_attribute_values: {
          orientation: {
            name: "Orientation",
            custom_attribute_definition_id: "orientation",
            selection_uid_values: ["square"],
          },
        },
      },
      {
        id: "art-2",
        type: "ITEM",
        item_data: {
          name: "Multi Size Print",
          variations: [
            {
              id: "small",
              item_variation_data: {
                name: "12x12",
                price_money: { amount: 3000, currency: "USD" },
              },
            },
            {
              id: "large",
              item_variation_data: {
                name: "24x24",
                price_money: { amount: 5000, currency: "USD" },
              },
            },
          ],
          categories: [{ id: "reproductions" }],
        },
      },
      {
        id: "sold",
        type: "ITEM",
        item_data: {
          name: "Sold Original",
          variations: [{ id: "sold-variation", item_variation_data: { name: "Regular" } }],
          categories: [{ id: "originals" }],
        },
      },
      { id: "reproductions", type: "CATEGORY", category_data: { name: "Reproductions" } },
      { id: "originals", type: "CATEGORY", category_data: { name: "Originals" } },
      { id: "image-1", type: "IMAGE", image_data: { url: "https://example.test/art.jpg" } },
      {
        id: "orientation",
        type: "CUSTOM_ATTRIBUTE_DEFINITION",
        custom_attribute_definition_data: {
          name: "Orientation",
          selection_config: {
            allowed_selections: [{ uid: "square", name: "Square / Circle" }],
          },
        },
      },
    ],
    inventory: [
      { catalog_object_id: "regular", location_id: "loc-1", state: "IN_STOCK", quantity: "3" },
      { catalog_object_id: "small", location_id: "loc-1", state: "IN_STOCK", quantity: "0" },
      { catalog_object_id: "large", location_id: "loc-1", state: "IN_STOCK", quantity: "2" },
    ],
  };

  const products = normalizeProducts(snapshot);
  const squareArtwork = products.find((product) => product.id === "art-1");
  const multiSize = products.find((product) => product.id === "art-2");
  const sold = products.find((product) => product.id === "sold");

  assert.equal(squareArtwork.collection, "reproductions");
  assert.equal(squareArtwork.orientation, "Square / Circle");
  assert.equal(squareArtwork.images[0].url, "https://example.test/art.jpg");
  assert.equal(squareArtwork.variations[0].size, null);
  assert.equal(squareArtwork.price.amount, 2500);
  assert.deepEqual(
    multiSize.variations.map(({ name, size, quantity }) => [name, size, quantity]),
    [
      ["12x12", "12x12", 0],
      ["24x24", "24x24", 2],
    ],
  );
  assert.equal(multiSize.price.amount, 5000);
  assert.equal(sold.inStock, false);
});

test("reproductions archive includes only reproductions, case-insensitively", () => {
  const names = ["Reproductions", "REPRODUCTIONS", "Originals", "Other"];
  const products = normalizeProducts({
    catalog: names.flatMap((name) => [
      { id: name, type: "CATEGORY", category_data: { name } },
      {
        id: `item-${name}`,
        type: "ITEM",
        item_data: {
          name,
          categories: [{ id: name }],
          variations: [{ id: `variation-${name}`, item_variation_data: { name: "Regular" } }],
        },
      },
    ]),
    inventory: names.map((name) => ({
      catalog_object_id: `variation-${name}`,
      state: "IN_STOCK",
      quantity: "1",
    })),
  });

  assert.deepEqual(
    products
      .filter((product) => product.collection === "reproductions" && product.inStock)
      .map((product) => product.id)
      .sort(),
    ["item-REPRODUCTIONS", "item-Reproductions"],
  );
  assert.equal(products.find((product) => product.name === "Originals").collection, "originals");
  assert.equal(products.find((product) => product.name === "Other").collection, null);
});

test("New custom attribute flags only explicitly enabled products", () => {
  const catalog = [true, false, undefined].map((value, index) => ({
    id: `item-${index}`,
    type: "ITEM",
    item_data: { name: `Item ${index}` },
    custom_attribute_values:
      value === undefined
        ? {}
        : {
            "Square:new-field-key": { name: "New", boolean_value: value },
          },
  }));
  assert.deepEqual(
    normalizeProducts({ catalog, inventory: [] }).map(({ isNew }) => isNew),
    [true, false, false],
  );
  catalog[0].custom_attribute_values["Square:new-field-key"].boolean_value = "false";
  assert.throws(() => normalizeProducts({ catalog, inventory: [] }), /Invalid Square New flag/);
});

test("sorts New products first, then Square creation date newest first, with alphabetical ties", () => {
  const entries = [
    ["regular-newest", "A recent item", "2026-11-13T22:00:00Z", false],
    ["new-old", "An old flagged item", "2025-01-01T00:00:00Z", true],
    ["new-latest", "Z latest flagged item", "2026-11-13T15:00:00-05:00", true],
    ["new-previous", "A previous flagged item", "2026-11-13T19:00:00Z", true],
    ["new-undated", "An undated flagged item", undefined, true],
    ["regular-tie-z", "Z tied item", "2026-01-01T00:00:00Z", false],
    ["regular-tie-a", "A tied item", "2026-01-01T00:00:00Z", false],
    ["regular-undated", "An undated item", undefined, false],
  ];
  const catalog = entries.map(([id, name, created_at, isNew]) => ({
    id,
    type: "ITEM",
    created_at,
    updated_at: "2027-01-01T00:00:00Z",
    item_data: { name },
    custom_attribute_values: { new: { name: "New", boolean_value: isNew } },
  }));
  const products = normalizeProducts({ catalog, inventory: [] });
  const expected = [
    "new-latest",
    "new-previous",
    "new-old",
    "new-undated",
    "regular-newest",
    "regular-tie-a",
    "regular-tie-z",
    "regular-undated",
  ];
  assert.deepEqual(
    products.map(({ id }) => id),
    expected,
  );
  assert.equal(products[0].createdAt, "2026-11-13T15:00:00-05:00");
  assert.deepEqual(
    getArchiveState(products, new URLSearchParams()).products.map(({ id }) => id),
    expected,
  );
  catalog[0].created_at = "not-a-date";
  assert.throws(
    () => normalizeProducts({ catalog, inventory: [] }),
    /Invalid Square creation date/,
  );
});

test("resolves collections and filter categories through Square category ancestry", () => {
  const catalog = [
    { id: "originals", type: "CATEGORY", category_data: { name: "Originals" } },
    { id: "prints", type: "CATEGORY", category_data: { name: "Reproductions" } },
    { id: "other", type: "CATEGORY", category_data: { name: "Unrelated" } },
    {
      id: "animals",
      type: "CATEGORY",
      category_data: { name: "Animals", parent_category: { id: "originals" } },
    },
    {
      id: "birds",
      type: "CATEGORY",
      category_data: { name: "Birds", parent_category: { id: "animals" } },
    },
    {
      id: "landscapes",
      type: "CATEGORY",
      category_data: { name: "Landscapes", parent_category: { id: "prints" } },
    },
    {
      id: "cycle",
      type: "CATEGORY",
      category_data: { name: "Cycle", parent_category: { id: "cycle" } },
    },
    ...[
      ["nested", ["birds", "animals", "other"]],
      ["print", ["landscapes"]],
      ["root", ["originals"]],
      ["broken", ["missing", "cycle"]],
    ].map(([id, categories]) => ({
      id,
      type: "ITEM",
      item_data: { name: id, categories: categories.map((id) => ({ id })) },
    })),
  ];
  const products = normalizeProducts({ catalog, inventory: [] });
  const nested = products.find(({ id }) => id === "nested");
  assert.equal(nested.collection, "originals");
  assert.deepEqual(nested.categories, ["Birds", "Animals", "Unrelated"]);
  assert.deepEqual(nested.subcategories, ["Birds", "Animals"]);
  const print = products.find(({ id }) => id === "print");
  assert.equal(print.collection, "reproductions");
  assert.deepEqual(print.subcategories, ["Landscapes"]);
  assert.deepEqual(products.find(({ id }) => id === "root").subcategories, []);
  assert.equal(products.find(({ id }) => id === "broken").collection, null);
});

function saleSnapshot() {
  return {
    catalog: [
      {
        id: "art",
        type: "ITEM",
        item_data: {
          name: "Sale artwork",
          variations: [
            {
              id: "small",
              item_variation_data: {
                name: "Small",
                price_money: { amount: 10000, currency: "USD" },
              },
            },
            {
              id: "large",
              item_variation_data: {
                name: "Large",
                price_money: { amount: 25000, currency: "USD" },
              },
            },
            {
              id: "sold",
              item_variation_data: { name: "Sold", price_money: { amount: 5000, currency: "USD" } },
            },
          ],
        },
      },
      {
        id: "sale",
        type: "SALE_PRICE",
        present_at_all_locations: true,
        sale_price_data: {
          item_variation_id: "large",
          sale_price_type: "SALE_PRICE_TYPE_FIXED_AMOUNT",
          amount_money: { amount: 2000, currency: "USD" },
        },
      },
      {
        id: "sold-sale",
        type: "SALE_PRICE",
        sale_price_data: {
          item_variation_id: "sold",
          sale_price_type: "SALE_PRICE_TYPE_FIXED_AMOUNT",
          amount_money: { amount: 0, currency: "USD" },
        },
      },
    ],
    inventory: ["small", "large"].map((id) => ({
      catalog_object_id: id,
      state: "IN_STOCK",
      quantity: "1",
    })),
  };
}

test("sale prices belong to their variation and drive the in-stock starting price and archive range", () => {
  const [product] = normalizeProducts(saleSnapshot());
  assert.deepEqual(product.price, { amount: 2000, currency: "USD" });
  assert.deepEqual(product.regularPrice, { amount: 25000, currency: "USD" });
  assert.equal(product.variations[0].price.amount, 10000);
  assert.equal(product.variations[0].regularPrice.amount, 10000);
  assert.equal(product.variations[1].price.amount, 2000);
  assert.equal(product.variations[1].regularPrice.amount, 25000);
  assert.equal(product.variations[2].price.amount, 0);
  assert.equal(product.variations[2].quantity, 0);

  const fullPriceProduct = {
    ...product,
    id: "full-price",
    price: { amount: 10000, currency: "USD" },
    regularPrice: { amount: 10000, currency: "USD" },
  };
  const archive = getArchiveState(
    [product, fullPriceProduct],
    new URLSearchParams("maxPrice=2000"),
  );
  assert.equal(archive.minPrice, 2000);
  assert.equal(archive.maxPrice, 10000);
  assert.deepEqual(
    archive.products.map(({ id }) => id),
    ["art"],
  );
});

test("deleted sales restore regular pricing and zero-dollar sales remain valid", () => {
  const snapshot = saleSnapshot();
  snapshot.catalog[1].is_deleted = true;
  const [regular] = normalizeProducts(snapshot);
  assert.deepEqual(regular.price, { amount: 10000, currency: "USD" });
  assert.deepEqual(regular.regularPrice, regular.price);
  snapshot.catalog[1].is_deleted = false;
  snapshot.catalog[1].sale_price_data.amount_money.amount = 0;
  const [free] = normalizeProducts(snapshot);
  assert.deepEqual(free.price, { amount: 0, currency: "USD" });
  assert.equal(free.regularPrice.amount, 25000);
});

test("invalid, ambiguous, and unsupported sale prices fail explicitly", () => {
  const cases = [
    [
      "negative amount",
      (sale) => {
        sale.sale_price_data.amount_money.amount = -1;
      },
    ],
    [
      "fractional cents",
      (sale) => {
        sale.sale_price_data.amount_money.amount = 2000.5;
      },
    ],
    [
      "missing amount",
      (sale) => {
        delete sale.sale_price_data.amount_money;
      },
    ],
    [
      "unsupported type",
      (sale) => {
        sale.sale_price_data.sale_price_type = "PERCENTAGE";
      },
    ],
    [
      "currency mismatch",
      (sale) => {
        sale.sale_price_data.amount_money.currency = "CAD";
      },
    ],
    [
      "above regular price",
      (sale) => {
        sale.sale_price_data.amount_money.amount = 30000;
      },
    ],
    [
      "location-specific",
      (sale) => {
        sale.present_at_all_locations = false;
      },
    ],
    [
      "excluded location",
      (sale) => {
        sale.absent_at_location_ids = ["location"];
      },
    ],
  ];
  for (const [label, change] of cases) {
    const snapshot = saleSnapshot();
    change(snapshot.catalog[1]);
    assert.throws(() => normalizeProducts(snapshot), /Square sale price/i, label);
  }
  const snapshot = saleSnapshot();
  snapshot.catalog.push({ ...snapshot.catalog[1], id: "duplicate" });
  assert.throws(() => normalizeProducts(snapshot), /Multiple Square sale prices/);
});
