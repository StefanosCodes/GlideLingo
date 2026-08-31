import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://glidelingo.com',
  output: 'static',
  integrations: [sitemap()],
  build: {
    inlineStylesheets: 'never',
  },
  vite: {
    resolve: {
      tsconfigPaths: false,
    },
  },
});
