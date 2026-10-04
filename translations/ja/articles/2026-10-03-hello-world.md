---
title: "Hello, world: Astro でサイトを作り直しました"
description: "このサイトを手書きの HTML から Astro に移行した理由と、GitHub Pages へのデプロイの仕組みについて。"
sourceHash: "721975b8947c2b94"
---

このサイトは、授業の課題用に手書きした HTML ファイルの入ったフォルダから始まりました。今では [Astro](https://astro.build) のサイトになっています。ページはビルド時にプレーンな HTML として生成され、記事は単なる Markdown ファイルです。

## 公開の仕組み

1. `src/content/articles/` に新しい `.md` ファイルを書きます。
2. `master` にプッシュします。
3. GitHub Actions のワークフローがサイトをビルドし、GitHub Pages にデプロイします。

## フロントマター

各記事は、メタデータの小さなブロックから始まります。

```yaml
---
title: 'My article'
description: 'One-line summary shown in lists.'
pubDate: 2026-10-03
tags: ['react']
---
```

`draft: true` を設定すると、準備ができるまでその記事をビルドから除外できます。
