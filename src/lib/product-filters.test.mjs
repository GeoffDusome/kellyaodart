import assert from "node:assert/strict";
import test from "node:test";
import {
  filterArchiveProducts,
  getArchiveParams,
  getArchiveState,
  getPaginationPages,
} from "./product-filters.ts";

test("archive filters combine OR within groups, AND across groups, and inclusive cent prices", () => {
  const products = [
    { id: "a", subcategories: ["Animals"], orientation: "Portrait", price: { amount: 1099 } },
    { id: "b", subcategories: ["Landscapes"], orientation: "Landscape", price: { amount: 2050 } },
    { id: "c", subcategories: ["Animals"], orientation: "Square", price: { amount: 3000 } },
    { id: "d", subcategories: ["Other"], orientation: "Portrait", price: { amount: 1500 } },
    { id: "e", subcategories: [], orientation: null, price: null },
  ];
  const filters = {
    categories: ["Animals", "Landscapes"],
    orientations: ["Portrait", "Landscape"],
    minPrice: 1099,
    maxPrice: 2050,
  };
  const ids = (options) => filterArchiveProducts(products, options).products.map(({ id }) => id);
  assert.deepEqual(ids(filters), ["a", "b"]);
  assert.deepEqual(ids({ ...filters, minPrice: 1100 }), ["b"]);
  assert.deepEqual(ids({ ...filters, maxPrice: 2049 }), ["a"]);
  assert.deepEqual(ids({ ...filters, orientations: ["Square"] }), []);
  assert.deepEqual(ids({ categories: [], orientations: [] }), ["a", "b", "c", "d", "e"]);
});

test("pagination uses 20 matching items, clamps pages after filtering, and handles empty results", () => {
  const products = Array.from({ length: 41 }, (_, index) => ({
    id: `${index}`,
    subcategories: [index % 2 ? "Animals" : "Landscapes"],
    orientation: null,
    price: null,
  }));
  const filters = { categories: [], orientations: [] };
  const first = filterArchiveProducts(products, filters);
  assert.equal(first.products.length, 20);
  assert.equal(first.total, 41);
  assert.equal(first.pages, 3);
  assert.equal(first.products[0].id, "0");
  assert.equal(filterArchiveProducts(products, filters, 2).products[0].id, "20");
  const last = filterArchiveProducts(products, filters, 99);
  assert.equal(last.page, 3);
  assert.deepEqual(
    last.products.map(({ id }) => id),
    ["40"],
  );
  const filtered = filterArchiveProducts(products, { ...filters, categories: ["Animals"] }, 3);
  assert.equal(filtered.page, 1);
  assert.equal(filtered.total, 20);
  assert.equal(filtered.products.length, 20);
  const empty = filterArchiveProducts(products, { ...filters, categories: ["Missing"] }, 2);
  assert.equal(empty.total, 0);
  assert.equal(empty.pages, 0);
  assert.equal(empty.page, 1);
  assert.deepEqual(empty.products, []);
});

test("URL state filters before pagination and keeps facets and price bounds collection-wide", () => {
  const products = Array.from({ length: 100 }, (_, index) => ({
    id: `${index}`,
    subcategories: [index % 2 ? "Animals" : "Landscapes"],
    orientation: index % 2 ? "Portrait" : "Landscape",
    price: { amount: 1000 + index },
  }));
  const state = getArchiveState(
    products,
    new URLSearchParams("category=Animals&orientation=Portrait&minPrice=1010&page=2"),
  );
  assert.equal(state.total, 45);
  assert.equal(state.products.length, 20);
  assert.equal(state.products[0].id, "51");
  assert.equal(state.page, 2);
  assert.equal(state.pages, 3);
  assert.deepEqual(state.categories, ["Animals", "Landscapes"]);
  assert.deepEqual(state.orientations, ["Landscape", "Portrait"]);
  assert.equal(state.minPrice, 1000);
  assert.equal(state.maxPrice, 1099);
  assert.equal(state.filters.minPrice, 1010);
  assert.equal(state.filters.maxPrice, undefined);
  assert.equal(state.invalidParams, false);
  assert.equal(state.categoryCounts.get("Animals"), 45);
  assert.equal(state.orientationCounts.get("Portrait"), 45);
  assert.equal(
    getArchiveParams(state.filters, state.page).toString(),
    "category=Animals&orientation=Portrait&minPrice=1010&page=2",
  );

  const defaults = getArchiveState(products, new URLSearchParams("minPrice=1000&maxPrice=1099"));
  assert.equal(defaults.filters.minPrice, undefined);
  assert.equal(defaults.filters.maxPrice, undefined);
  assert.equal(getArchiveParams(defaults.filters).toString(), "");
});

test("facet counts ignore their own OR group but respect other groups and inclusive price limits", () => {
  const products = [
    { id: "a", subcategories: ["Animals"], orientation: "Portrait", price: { amount: 100 } },
    { id: "b", subcategories: ["Animals"], orientation: "Landscape", price: { amount: 200 } },
    { id: "c", subcategories: ["Landscapes"], orientation: "Portrait", price: { amount: 300 } },
    { id: "d", subcategories: ["Landscapes"], orientation: "Landscape", price: { amount: 400 } },
    { id: "e", subcategories: ["Animals"], orientation: "Square", price: null },
    {
      id: "f",
      subcategories: ["Animals", "Animals"],
      orientation: "Portrait",
      price: { amount: 200 },
    },
  ];
  const state = getArchiveState(
    products,
    new URLSearchParams("category=Animals&orientation=Portrait&minPrice=200&maxPrice=300"),
  );
  assert.equal(state.total, 1);
  assert.deepEqual(
    [...state.categoryCounts],
    [
      ["Animals", 1],
      ["Landscapes", 1],
    ],
  );
  assert.deepEqual(
    [...state.orientationCounts],
    [
      ["Landscape", 1],
      ["Portrait", 1],
      ["Square", 0],
    ],
  );
  const expanded = getArchiveState(
    products,
    new URLSearchParams(
      "category=Animals&category=Landscapes&orientation=Portrait&minPrice=200&maxPrice=300",
    ),
  );
  assert.equal(expanded.total, 2);
  assert.deepEqual(expanded.categoryCounts, state.categoryCounts);
  assert.equal(expanded.orientationCounts.get("Portrait"), 2);
  const unpriced = getArchiveState(products, new URLSearchParams("category=Animals"));
  assert.equal(unpriced.orientationCounts.get("Square"), 1);
});

test("invalid query values are reported and cannot produce invalid slider or page state", () => {
  const products = [
    { id: "a", subcategories: ["Animals"], orientation: "Portrait", price: { amount: 1000 } },
    { id: "b", subcategories: [], orientation: null, price: { amount: 2000 } },
  ];
  for (const query of [
    "page=0",
    "page=-1",
    "page=1.5",
    "page=Infinity",
    "page=9007199254740992",
    "minPrice=hello",
    "maxPrice=1000.5",
    "minPrice=1000&minPrice=2000",
    "category=Unknown",
    "orientation=Unknown",
  ]) {
    const state = getArchiveState(products, new URLSearchParams(query));
    assert.equal(state.invalidParams, true, query);
    assert.equal(state.page, 1, query);
    assert.equal(state.products.length, 2, query);
  }
  const bounded = getArchiveState(products, new URLSearchParams("minPrice=9999&maxPrice=1"));
  assert.equal(bounded.invalidParams, true);
  assert.equal(bounded.filters.minPrice, undefined);
  assert.equal(bounded.filters.maxPrice, undefined);
  assert.equal(getArchiveState([], new URLSearchParams()).total, 0);
});

test("numbered pagination shows first, last, neighbors, and gaps without duplicates", () => {
  assert.deepEqual(getPaginationPages(1, 0), []);
  assert.deepEqual(getPaginationPages(1, 1), [1]);
  assert.deepEqual(getPaginationPages(1, 2), [1, 2]);
  assert.deepEqual(getPaginationPages(1, 10), [1, 2, null, 10]);
  assert.deepEqual(getPaginationPages(3, 10), [1, 2, 3, 4, null, 10]);
  assert.deepEqual(getPaginationPages(5, 10), [1, null, 4, 5, 6, null, 10]);
  assert.deepEqual(getPaginationPages(10, 10), [1, null, 9, 10]);
});
