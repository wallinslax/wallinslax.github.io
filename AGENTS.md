# Agent guide

Personal site and tech blog for Sung-Fu Han, built with Astro and deployed to GitHub Pages
(`https://wallinslax.github.io`). Design principle: **less is more**. Articles are the main content.

## Project

- `src/components/pages/`: home, articles list (with tag filter), and article page, each taking a `lang`
- `src/pages/`: thin routes for English (`/`) and translations (`src/pages/[lang]/` → `/ja/`, `/zh-tw/`), plus RSS
- `src/content/articles/*.md`: articles (front matter: `title`, `description`, `pubDate`, `tags`, `draft`, `visibility`: `public` by default, or `offline` to take an article off the site without deleting it). Lists are sorted newest first in `getArticles()` (`src/utils.ts`)
- `src/consts.ts`: site title, links, giscus and Google Analytics config
- `src/components/Analytics.astro` + `ConsentBar.astro`: GA4 with Consent Mode; loads only on the live host, and only European-time-zone visitors see the consent bar
- `src/styles/global.css`: color tokens for light and dark themes
- Search: `@astrojs/sitemap` (in `astro.config.mjs`) generates `sitemap-index.xml` on every build, so
  never edit a sitemap by hand. `public/robots.txt` points to it, `BaseLayout.astro` adds schema.org
  `Person` data on the home page, and `public/google*.html` is the Search Console verification file
  (don't delete it). If the site URL ever changes, update `site` in `astro.config.mjs` and the
  `Sitemap:` line in `robots.txt`
- `src/i18n/en.json`: all English UI text (nav, buttons, home intro). `src/i18n/index.ts`: language helpers
- `translations/<lang>/`: committed machine translations (`ja`, `zh-tw`); see "Translations" below
- `src/voices.ts`: the one read-aloud voice per language (en, ja, zh-TW) for the Listen button; no voice picker by design
- Deploy: push to `mainline` runs `.github/workflows/deploy.yml`; PRs run the `build-check` and `commit-format` jobs in `ci.yml`

## Commands

```sh
npm ci
npm run build    # must pass before any PR
npm run dev      # http://localhost:4321
```

## Every article change ships with its translations

Whenever an English article is added or edited, or `src/i18n/en.json` changes, regenerate the
Japanese and Traditional Chinese translations in the same PR, before the preview step:
run `node scripts/i18n-status.mjs`, translate everything it lists (one subagent per language),
and re-run it until it reports "Translations are up to date". Details in "Translations" below.

## Always preview before opening a PR

The owner reviews changes visually before they go up. For every change that affects what the site
looks like or does:

1. **Build**: `npm run build` must succeed.
2. **Screenshot**: serve `dist/` (for example `python3 -m http.server 4322 -d dist`) and take
   Playwright screenshots of every changed page at desktop (about 1100px) and phone (390px)
   width, in light and dark mode. Check for horizontal overflow and broken layout. Share the
   screenshots with the user.
3. **Live preview**: when running in Claude Code with the Artifact tool, publish a clickable
   preview:
   - `python3 scripts/make-preview.py <scratch_dir>` copies `dist/` with relative links and writes
     `<scratch_dir>/site-preview.html`, printing the files to publish.
   - Publish `site-preview.html` with **every** file it prints as a private artifact, including
     `_astro/*.css` and images, not just the HTML pages; otherwise the preview renders unstyled. Reuse the same artifact
     URL for later previews in the session.
   - Known preview limits: giscus comments, RSS, and `?tags=` deep links don't work there; they
     work on the real site.
4. **Wait for approval**: send the preview link and screenshots, then wait for the user to approve
   before opening the PR. Don't open or merge a PR without that go-ahead.

Changes with no visible effect (CI config, docs) skip steps 2–3 but still need a passing build.

## Translations

English is the only source language. Japanese (`ja`) and Traditional Chinese for Taiwan (`zh-tw`)
are machine translations written by Claude Code (no API key, no translation step in CI) and
committed under `translations/`. English pages live at `/`, translations at `/ja/` and `/zh-tw/`.

- `node scripts/i18n-status.mjs` lists missing, stale, and orphaned translations with the
  `sourceHash` each article translation must record (`--json` for agents).
- Run it whenever an English article or `src/i18n/en.json` changes, and bring translations up to
  date in the same PR. Use one subagent per language when there is more than a little to do.
- Stale or missing translations never break the site: an article whose `sourceHash` doesn't match
  its English source is shown in English, and a UI string whose `source` doesn't match is shown in
  English.

File formats:

- `translations/<lang>/ui.json`: one entry per key of `src/i18n/en.json`:
  `{ "<key>": { "source": "<the exact current English text>", "text": "<translation>" } }`.
- `translations/<lang>/articles/<same file name as English>.md`:

  ```md
  ---
  title: "<translated title>"
  description: "<translated description>"
  sourceHash: "<hash from i18n-status>"
  ---
  <translated body>
  ```

  Only `title`, `description`, and `sourceHash` go in front matter; dates and tags come from the
  English article.

Translation rules:

- Write natural prose a native engineer would publish, not a word-for-word rendering.
  `ja`: polite です/ます style typical of Japanese tech blogs. `zh-tw`: Traditional Chinese with
  Taiwan terminology (程式, 資料庫, 伺服器, 介面, 預設; never Mainland terms like 程序, 数据库, 默认).
- Keep Markdown structure, headings, lists, and links. Translate link text, keep URLs.
- Never change code blocks or inline code. Keep product names, API names, HTTP verbs, and field
  names (`queryId`, `retryOf`) as is.
- For key technical terms, use the established local term and add the English in parentheses on
  first use, e.g. 冪等性（idempotency）.
- Keep HTML tags and `{placeholders}` in UI strings exactly as in the English.
- Don't add, drop, or summarize content.

## Conventions

- Keep the home page minimal: avatar, one-line intro, icon links, short About, latest articles.
- Never put the owner's email, student ID, API keys, or other private data on the site.
- Use the color tokens in `global.css`; every color must work in both themes.
- Tags are lowercase with hyphens (e.g. `github-pages`).
- Commit messages and PR titles follow [Conventional Commits](https://www.conventionalcommits.org):
  `type(scope): summary`, lowercase type, imperative summary, no trailing period, e.g.
  `feat(article): add share button`, `fix(seo): add robots.txt`, `docs(agents): note sitemap`.
  Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
  The `commit-format` job in `ci.yml` rejects PRs that don't match.
