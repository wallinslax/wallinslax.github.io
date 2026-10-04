import crypto from 'node:crypto';
import fs from 'node:fs';
import { getCollection, type CollectionEntry } from 'astro:content';
import { localizePath, type Lang } from './i18n';

// Drafts are visible only to the owner: in `npm run dev`, or in a preview build with SHOW_DRAFTS=1.
// The deployed site never sets either, so it shows public articles only.
const showDrafts = import.meta.env.DEV || process.env.SHOW_DRAFTS === '1';

export async function getArticles() {
  const articles = await getCollection('articles', ({ data }) => data.visibility === 'public' || (showDrafts && data.visibility === 'draft'));
  return articles.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

/** An article as shown in one language: the translation when it is current, else the English. */
export type LocalArticle = {
  id: string;
  en: CollectionEntry<'articles'>;
  translation?: CollectionEntry<'translations'>;
  title: string;
  description: string;
  body: string;
};

// Same fingerprint as scripts/i18n-status.mjs: first 16 hex chars of sha256 of the English file.
const sourceHash = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8')).digest('hex').slice(0, 16);

export async function getLocalArticles(lang: Lang): Promise<LocalArticle[]> {
  const articles = await getArticles();
  const translations = lang === 'en' ? [] : await getCollection('translations', ({ id }) => id.startsWith(`${lang}/`));
  return articles.map((en) => {
    const candidate = translations.find((t) => t.id === `${lang}/articles/${en.id}`);
    const current = candidate && en.filePath && candidate.data.sourceHash === sourceHash(en.filePath) ? candidate : undefined;
    return {
      id: en.id,
      en,
      translation: current,
      title: current?.data.title ?? en.data.title,
      description: current?.data.description ?? en.data.description,
      body: current?.body ?? en.body ?? '',
    };
  });
}

export function tagSlug(tag: string) {
  return tag.toLowerCase().trim().replace(/\s+/g, '-');
}

export function tagUrl(tag: string, lang: Lang = 'en') {
  return `${localizePath('/articles/', lang)}?tags=${encodeURIComponent(tagSlug(tag))}`;
}

// Rough reading time (references excluded): ~220 words per minute for English, ~400 characters per minute for CJK text.
export function readingTime(body = '') {
  const text = body
    .replace(/```[\s\S]*?```/g, (code) => code.split('\n').slice(0, 10).join(' '))
    .replace(/^- <span id="ref-.*$/gm, ''); // reference list entries aren't read
  const cjk = (text.match(/[㐀-鿿぀-ヿ가-힯]/g) ?? []).length;
  const words = text.replace(/[㐀-鿿぀-ヿ가-힯]/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220 + cjk / 400));
}
