import { getSecret } from "astro:env/server";
import { createProductLoader, fetchCatalog } from "./square";

export const loadProducts = createProductLoader(() => fetchCatalog({
  token: getSecret("SQUARE_ACCESS_TOKEN") ?? "",
  environment: getSecret("SQUARE_ENVIRONMENT") ?? "sandbox",
}));
