// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
  site: 'https://kellyaodart.com',
  integrations: [sitemap({
    customPages: [
      'https://kellyaodart.com/products/originals/',
      'https://kellyaodart.com/products/prints/',
    ],
    customSitemaps: ['https://kellyaodart.com/sitemap-products.xml'],
  })],
  adapter: vercel(),
});