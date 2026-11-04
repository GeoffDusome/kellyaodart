import assert from "node:assert/strict";
import test from "node:test";
import { fetchSnapshot } from "./square-catalog-snapshot.mjs";

test("fetchSnapshot paginates catalog and inventory", async () => {
  const requests = [];
  const request = async (path, options) => {
    requests.push({ path, options });
    if (path === "catalog/list") {
      return options.query.cursor
        ? { objects: [{ type: "ITEM_VARIATION", id: "variation-2" }] }
        : {
            objects: [
              { type: "ITEM", id: "item-1" },
              { type: "ITEM_VARIATION", id: "variation-1" },
            ],
            cursor: "catalog-next",
          };
    }
    return options.body.cursor
      ? { counts: [{ catalog_object_id: "variation-1" }] }
      : { counts: [{ catalog_object_id: "variation-2" }], cursor: "inventory-next" };
  };

  const snapshot = await fetchSnapshot(request);
  assert.equal(snapshot.catalog.length, 3);
  assert.equal(snapshot.inventory.length, 2);
  assert.deepEqual(
    requests.map(({ path }) => path),
    ["catalog/list", "catalog/list", "inventory/batch-retrieve-counts", "inventory/batch-retrieve-counts"],
  );
});
