import assert from "node:assert/strict";
import test from "node:test";
import { createProductLoader, fetchCatalog } from "./square.ts";

test("fetches paginated catalog and inventory from Square, batching variation IDs", async () => {
  const ids = Array.from({ length: 101 }, (_, i) => `variation-${i}`);
  const calls = [];
  const data = await fetchCatalog({ token: "test-token", environment: "sandbox" }, async (url, options) => {
    calls.push(url.pathname);
    assert.equal(url.hostname, "connect.squareupsandbox.com");
    assert.equal(options.headers.Authorization, "Bearer test-token");
    if (url.pathname.endsWith("catalog/list")) {
      return Response.json(url.searchParams.has("cursor")
        ? { objects: ids.map(id => ({ id, type: "ITEM_VARIATION" })) }
        : { objects: [{ id: "image", type: "IMAGE" }], cursor: "catalog-next" });
    }
    const body = JSON.parse(options.body);
    assert.ok(body.catalog_object_ids.length <= 100);
    if (body.catalog_object_ids.length === 100 && !body.cursor) {
      return Response.json({ counts: [], cursor: "inventory-next" });
    }
    return Response.json({ counts: [{ catalog_object_id: body.catalog_object_ids[0], state: "IN_STOCK", quantity: "1" }] });
  });
  assert.equal(data.catalog.length, 102);
  assert.equal(data.inventory.length, 2);
  assert.equal(calls.length, 5);
});

test("cache expires and discovers new items without rebuilding; failed fetches are retried", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1000 });
  let requests = 0;
  const load = createProductLoader(async () => {
    requests++;
    if (requests === 3) throw new Error("Square unavailable");
    return {
      catalog: Array.from({ length: requests }, (_, i) => ({
        id: `item-${i}`, type: "ITEM", item_data: { name: `Item ${i}` },
      })),
      inventory: [],
    };
  });
  const [first, concurrent] = await Promise.all([load(), load()]);
  assert.equal(first.length, 1);
  assert.deepEqual(concurrent, first);
  assert.equal((await load()).length, 1);
  assert.equal(requests, 1);
  t.mock.timers.tick(60_001);
  assert.equal((await load()).length, 2);
  t.mock.timers.tick(60_001);
  await assert.rejects(load(), /Square unavailable/);
  assert.equal((await load()).length, 4);
});

test("credentials, environment and Square failures are explicit errors", async () => {
  await assert.rejects(fetchCatalog({ token: "", environment: "sandbox" }), /SQUARE_ACCESS_TOKEN/);
  await assert.rejects(fetchCatalog({ token: "test-token", environment: "invalid" }), /SQUARE_ENVIRONMENT/);
  await assert.rejects(
    fetchCatalog({ token: "test-token", environment: "production" }, async () => new Response(null, { status: 401 })),
    /Square catalog\/list failed \(401\)/,
  );
});
