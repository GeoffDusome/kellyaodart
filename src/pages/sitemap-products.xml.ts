import type { APIRoute } from "astro";
import { loadProducts } from "../lib/load-products";

export const prerender = false;

export const GET: APIRoute = async ({ site }) => {
  if (!site) throw new Error("Configure site before generating the product sitemap.");
  const products = (await loadProducts()).filter((product) => product.collection);
  const urls = products.map(
    (product) =>
      `<url><loc>${new URL(`/products/${product.collection}/${product.slug}/`, site).href}</loc></url>`,
  );
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`,
    { headers: { "Content-Type": "application/xml", "Cache-Control": "no-store" } },
  );
};
