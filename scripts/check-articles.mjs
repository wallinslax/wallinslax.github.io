// Checks that articles follow the "Article style" structure in AGENTS.md.
// Runs before `astro build`: problems in public articles fail the build; drafts only get warnings.
import { readFileSync, readdirSync } from 'node:fs';

const dir = 'src/content/articles';
// Written before the article style existed; AGENTS.md keeps it as it is.
const exempt = new Set(['2021-09-15-why-i-switched-from-sre-to-swe.md']);

let failed = false;

for (const file of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
  if (exempt.has(file)) continue;
  const text = readFileSync(`${dir}/${file}`, 'utf8');
  const [, frontMatter = '', body = text] = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? [];
  const visibility = frontMatter.match(/^visibility:\s*['"]?(\w+)/m)?.[1] ?? 'draft';
  if (visibility === 'offline') continue;

  const problems = [];
  const warnings = [];
  const prose = body.replace(/^```[\s\S]*?^```/gm, '');
  const sections = [...prose.matchAll(/^## (.+)$/gm)].map((m) => ({ title: m[1].trim(), start: m.index }));
  const sectionText = (i) => prose.slice(sections[i].start, sections[i + 1]?.start ?? prose.length);
  const titles = sections.map((s) => s.title);
  const last = titles.length - 1;

  if (!titles.slice(0, 2).some((t) => t.startsWith('Why'))) {
    problems.push('needs a "## Why…" section as the first or second section');
  }
  if (titles[last] !== 'References' || titles[last - 1] !== 'Question for you') {
    problems.push('must end with a takeaways section, then "## Question for you", then "## References"');
  } else if (!/^- /m.test(sectionText(last - 2))) {
    problems.push(`takeaways section "## ${titles[last - 2]}" needs a list`);
  }

  const refsStart = titles[last] === 'References' ? sections[last].start : prose.length;
  const main = prose.slice(0, refsStart);
  const refs = prose.slice(refsStart);
  if (!/https?:\/\//.test(refs)) problems.push('"## References" needs at least one source link');
  const cited = new Set([...main.matchAll(/\]\(#(ref-[\w-]+)\)/g)].map((m) => m[1]));
  const listed = new Set([...refs.matchAll(/id="(ref-[\w-]+)"/g)].map((m) => m[1]));
  if (cited.size === 0) problems.push('cite sources inline, e.g. [[1]](#ref-1)');
  for (const id of cited) if (!listed.has(id)) problems.push(`citation #${id} has no matching entry in References`);
  for (const id of listed) if (!cited.has(id)) warnings.push(`reference #${id} is never cited`);

  // Same count as readingTime() in src/utils.ts, so the warning matches the minutes the site shows.
  const read = body
    .replace(/```[\s\S]*?```/g, (code) => code.split('\n').slice(0, 10).join(' '))
    .replace(/^- <span id="ref-.*$/gm, '');
  const minutes = Math.round(read.split(/\s+/).filter(Boolean).length / 220);
  if (minutes < 5 || minutes > 6) warnings.push(`${minutes} min read; aim for 5–6`);

  if (visibility === 'public') failed ||= problems.length > 0;
  else warnings.unshift(...problems.splice(0));
  for (const p of problems) console.error(`✗ ${file}: ${p}`);
  for (const w of warnings) console.warn(`! ${file}: ${w}`);
}

if (failed) {
  console.error('\nArticle format check failed. See "Article style" in AGENTS.md.');
  process.exit(1);
}
console.log('Article format check passed.');
