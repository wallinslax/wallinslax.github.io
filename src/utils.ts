import { getCollection } from 'astro:content';

export async function getArticles() {
  const articles = await getCollection('articles', ({ data }) => !data.draft);
  return articles.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

export function formatDate(date: Date) {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function tagSlug(tag: string) {
  return tag.toLowerCase().trim().replace(/\s+/g, '-');
}

export function tagUrl(tag: string) {
  return `/articles/?tags=${encodeURIComponent(tagSlug(tag))}`;
}

// Rough reading time: ~220 words per minute for English, ~400 characters per minute for CJK text.
export function readingTime(body = '') {
  const text = body.replace(/```[\s\S]*?```/g, (code) => code.split('\n').slice(0, 10).join(' '));
  const cjk = (text.match(/[㐀-鿿぀-ヿ가-힯]/g) ?? []).length;
  const words = text.replace(/[㐀-鿿぀-ヿ가-힯]/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220 + cjk / 400));
}
