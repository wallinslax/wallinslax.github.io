---
title: "シンタックスハイライトのテスト"
description: "コードブロックがライトモードとダークモードの両方できれいに表示されるかを手早く確認します。"
sourceHash: "1c0b7ccb2b6a3880"
---

コードブロックはビルド時にハイライトされるため、読者側で JavaScript のコストはかかりません。

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

`npm run dev` のようなインラインコードも問題なく表示されます。
