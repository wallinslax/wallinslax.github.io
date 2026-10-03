---
title: "Hello, world：用 Astro 重建我的網站"
description: "為什麼我把這個網站從手寫 HTML 搬到 Astro，以及它如何部署到 GitHub Pages。"
sourceHash: "c9299e5166434612"
---

這個網站一開始只是一個放課堂作業的資料夾，裡面都是手寫的 HTML。現在它是一個 [Astro](https://astro.build) 網站：頁面在建置時就產生為純 HTML，文章則只是 Markdown 檔案。

## 發布流程

1. 在 `src/content/articles/` 新增一個 `.md` 檔案。
2. 推送到 `master`。
3. GitHub Actions 工作流程會建置網站，並部署到 GitHub Pages。

## Front matter

每篇文章開頭都有一小段中繼資料：

```yaml
---
title: 'My article'
description: 'One-line summary shown in lists.'
pubDate: 2026-10-03
tags: ['react']
---
```

設定 `draft: true`，就能在文章準備好之前，先不讓它進入建置結果。
