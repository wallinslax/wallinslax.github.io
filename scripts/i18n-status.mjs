// Lists translations that are missing or out of date, with the source hash each one must record.
// No API calls; translations are written by Claude Code (see AGENTS.md).
//
//   node scripts/i18n-status.mjs          # human-readable report
//   node scripts/i18n-status.mjs --json   # machine-readable, for agents
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const LANGS = { ja: 'Japanese', 'zh-tw': 'Traditional Chinese (Taiwan)' };
const ARTICLES = 'src/content/articles';
const OUT = 'translations';

export const sourceHash = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

const en = JSON.parse(fs.readFileSync('src/i18n/en.json', 'utf8'));
const articles = fs.readdirSync(ARTICLES).filter((f) => f.endsWith('.md'));

const report = [];
for (const [lang, language] of Object.entries(LANGS)) {
  // UI strings: one entry per key, each remembering its English source.
  let ui = {};
  try {
    ui = JSON.parse(fs.readFileSync(`${OUT}/${lang}/ui.json`, 'utf8'));
  } catch {}
  const uiKeys = Object.keys(en).filter((key) => ui[key]?.source !== en[key]);
  if (uiKeys.length) report.push({ lang, language, kind: 'ui', file: `${OUT}/${lang}/ui.json`, keys: uiKeys });

  // Articles: one file per article, front matter records the hash of the English source file.
  for (const name of articles) {
    const source = fs.readFileSync(path.join(ARTICLES, name), 'utf8');
    const hash = sourceHash(source);
    const target = `${OUT}/${lang}/articles/${name}`;
    let current = null;
    try {
      current = fs.readFileSync(target, 'utf8').match(/^sourceHash:\s*['"]?([0-9a-f]+)/m)?.[1] ?? null;
    } catch {}
    if (current !== hash) report.push({ lang, language, kind: 'article', source: path.join(ARTICLES, name), file: target, sourceHash: hash, status: current ? 'stale' : 'missing' });
  }

  // Translations whose English article was deleted.
  try {
    for (const name of fs.readdirSync(`${OUT}/${lang}/articles`)) {
      if (!articles.includes(name)) report.push({ lang, language, kind: 'orphan', file: `${OUT}/${lang}/articles/${name}` });
    }
  } catch {}
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else if (!report.length) {
  console.log('Translations are up to date.');
} else {
  for (const item of report) {
    if (item.kind === 'ui') console.log(`${item.lang}  ui        ${item.file}  (${item.keys.length} strings to translate)`);
    else if (item.kind === 'article') console.log(`${item.lang}  ${item.status.padEnd(8)}  ${item.file}  sourceHash: ${item.sourceHash}`);
    else console.log(`${item.lang}  orphan    ${item.file}  (English article removed; delete this file)`);
  }
}
