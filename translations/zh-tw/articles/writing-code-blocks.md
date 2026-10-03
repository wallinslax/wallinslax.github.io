---
title: "語法突顯測試"
description: "快速確認程式碼區塊在淺色與深色模式下都能正常顯示。"
sourceHash: "818c3fb4b013066d"
---

程式碼區塊在建置時就完成語法突顯，所以讀者端不需要額外載入任何 JavaScript。

```ts
type Article = {
  title: string;
  pubDate: Date;
  tags: string[];
};

export function latest(articles: Article[], n = 3) {
  return [...articles].sort((a, b) => b.pubDate.valueOf() - a.pubDate.valueOf()).slice(0, n);
}
```

像 `npm run dev` 這樣的行內程式碼也沒問題。
