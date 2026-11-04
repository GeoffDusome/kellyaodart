import { normalizeProducts, type Product, type SquareCatalog } from "./products.ts";

type SquareConfig = { token: string; environment: string };

export async function fetchCatalog(
  config: SquareConfig,
  request: typeof fetch = fetch,
): Promise<SquareCatalog> {
  if (!config.token) throw new Error("Set SQUARE_ACCESS_TOKEN to a read-only Square token.");
  if (!["sandbox", "production"].includes(config.environment)) {
    throw new Error("SQUARE_ENVIRONMENT must be sandbox or production.");
  }
  const host = config.environment === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";

  async function squareRequest(
    path: string,
    query?: Record<string, string>,
    body?: Record<string, unknown>,
  ) {
    const url = new URL(`/v2/${path}`, host);
    url.search = new URLSearchParams(query).toString();
    const response = await request(url, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Square-Version": "2025-08-20",
        "Content-Type": "application/json",
      },
      ...(body && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Square ${path} failed (${response.status}).`);
    return response.json();
  }

  const catalog: SquareCatalog["catalog"] = [];
  let cursor: string | undefined;
  do {
    const page = await squareRequest("catalog/list", {
      types: "ITEM,ITEM_VARIATION,CATEGORY,IMAGE,CUSTOM_ATTRIBUTE_DEFINITION",
      ...(cursor && { cursor }),
    });
    if (page.objects !== undefined && !Array.isArray(page.objects)) {
      throw new Error("Square returned invalid catalog objects.");
    }
    catalog.push(...(page.objects ?? []));
    cursor = page.cursor;
  } while (cursor);

  const ids = [...new Set(catalog.filter((item) => item.type === "ITEM_VARIATION").map((item) => item.id))];
  const inventory: SquareCatalog["inventory"] = [];
  for (let i = 0; i < ids.length; i += 100) {
    let inventoryCursor: string | undefined;
    do {
      const page = await squareRequest("inventory/batch-retrieve-counts", undefined, {
        catalog_object_ids: ids.slice(i, i + 100),
        ...(inventoryCursor && { cursor: inventoryCursor }),
      });
      if (page.counts !== undefined && !Array.isArray(page.counts)) {
        throw new Error("Square returned invalid inventory counts.");
      }
      inventory.push(...(page.counts ?? []));
      inventoryCursor = page.cursor;
    } while (inventoryCursor);
  }
  return { catalog, inventory };
}

export function createProductLoader(fetchData: () => Promise<SquareCatalog>) {
  let cached: { products: Product[]; expiresAt: number } | undefined;
  let pending: Promise<Product[]> | undefined;
  return async function loadProducts(): Promise<Product[]> {
    if (cached && Date.now() < cached.expiresAt) return cached.products;
    pending ??= fetchData()
      .then((data) => {
        const products = normalizeProducts(data);
        cached = { products, expiresAt: Date.now() + 60_000 };
        return products;
      })
      .finally(() => { pending = undefined; });
    return pending;
  };
}
