import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProducts } from "./products.ts";

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
          categories: [{ id: "prints" }],
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
          categories: [{ id: "prints" }],
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
      { id: "prints", type: "CATEGORY", category_data: { name: "Prints" } },
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

  assert.equal(squareArtwork.collection, "prints");
  assert.equal(squareArtwork.orientation, "Square / Circle");
  assert.equal(squareArtwork.images[0].url, "https://example.test/art.jpg");
  assert.equal(squareArtwork.variations[0].size, null);
  assert.equal(squareArtwork.price.amount, 2500);
  assert.deepEqual(multiSize.variations.map(({ name, size, quantity }) => [name, size, quantity]), [
    ["12x12", "12x12", 0],
    ["24x24", "24x24", 2],
  ]);
  assert.equal(multiSize.price.amount, 5000);
  assert.equal(sold.inStock, false);
});
