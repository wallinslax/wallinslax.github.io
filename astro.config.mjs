// @ts-check
import { defineConfig } from 'astro/config';
import { writeFile } from 'node:fs/promises';

const site = 'https://wallinslax.github.io';

/**
 * Writes one plain /sitemap.xml with every built page (all languages),
 * so Search Console and robots.txt point at a single, stable URL.
 * @returns {import('astro').AstroIntegration}
 */
function sitemapXml() {
  return {
    name: 'sitemap-xml',
    hooks: {
      'astro:build:done': async ({ dir, pages, logger }) => {
        const urls = pages
          .map(({ pathname }) => pathname)
          .filter((p) => !/^404\/?$/.test(p))
          .map((p) => new URL(p, `${site}/`).href)
          .sort();
        const body = urls.map((u) => `  <url><loc>${u.replace(/&/g, '&amp;')}</loc></url>`).join('\n');
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
        await writeFile(new URL('sitemap.xml', dir), xml);
        logger.info(`sitemap.xml created with ${urls.length} URLs`);
      },
    },
  };
}

export default defineConfig({
  site,
  integrations: [sitemapXml()],
  markdown: {
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
    },
  },
});
