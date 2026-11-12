// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

import vercel from "@astrojs/vercel";

import icon from "astro-icon";

// https://astro.build/config
export default defineConfig({
  adapter: vercel(),
  integrations: [
    sitemap({
      customPages: [
        "https://kellyaodart.com/products/originals/",
        "https://kellyaodart.com/products/reproductions/",
      ],
      customSitemaps: ["https://kellyaodart.com/sitemap-products.xml"],
    }),
    icon(),
  ],
  image: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "placehold.co",
      },
    ],
  },
  site: "https://kellyaodart.com",
});
