import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const apiVersion = "2025-08-20";
const pageSize = 100;
const catalogTypes =
  "ITEM,ITEM_VARIATION,CATEGORY,IMAGE,CUSTOM_ATTRIBUTE_DEFINITION";

async function squareRequest(path, token, environment, { query, body } = {}) {
  const host =
    environment === "production"
      ? "https://connect.squareup.com"
      : "https://connect.squareupsandbox.com";
  const url = new URL(`/v2/${path}`, host);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Square-Version": apiVersion,
      ...(body && { "Content-Type": "application/json" }),
    },
    ...(body && { body: JSON.stringify(body) }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `Square API ${path} failed (${response.status}): ${JSON.stringify(payload.errors ?? payload)}`,
    );
  }
  return payload;
}

export async function fetchSnapshot(request) {
  const catalog = [];
  let cursor;
  do {
    const page = await request("catalog/list", {
      query: { types: catalogTypes, limit: 1000, cursor },
    });
    catalog.push(...(page.objects ?? []));
    cursor = page.cursor;
  } while (cursor);

  const variationIds = [
    ...new Set(
      catalog
        .filter((object) => object.type === "ITEM_VARIATION")
        .map((object) => object.id),
    ),
  ];
  const inventory = [];
  for (let i = 0; i < variationIds.length; i += pageSize) {
    let inventoryCursor;
    do {
      const page = await request("inventory/batch-retrieve-counts", {
        body: {
          catalog_object_ids: variationIds.slice(i, i + pageSize),
          cursor: inventoryCursor,
        },
      });
      inventory.push(...(page.counts ?? []));
      inventoryCursor = page.cursor;
    } while (inventoryCursor);
  }

  return { catalog, inventory };
}

async function main() {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) throw new Error("Set SQUARE_ACCESS_TOKEN to a read-only Square token.");

  const environment = process.env.SQUARE_ENVIRONMENT ?? "sandbox";
  if (!["sandbox", "production"].includes(environment)) {
    throw new Error("SQUARE_ENVIRONMENT must be sandbox or production.");
  }

  const request = (path, options) =>
    squareRequest(path, token, environment, options);
  const snapshot = await fetchSnapshot(request);
  const output = resolve("data/square-catalog-snapshot.json");
  await mkdir("data", { recursive: true });
  await writeFile(
    output,
    `${JSON.stringify({ environment, fetchedAt: new Date().toISOString(), ...snapshot }, null, 2)}\n`,
  );
  console.log(`Saved ${snapshot.catalog.length} catalog objects and ${snapshot.inventory.length} inventory counts to ${output}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
