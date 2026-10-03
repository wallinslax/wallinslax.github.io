<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" encoding="UTF-8" indent="yes" />
  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title><xsl:value-of select="/rss/channel/title" /> · RSS feed</title>
        <style>
          :root { --bg: #fff; --text: #1c1f24; --muted: #5b6370; --border: #e3e6ea; --accent: #2563eb; --soft: #e8efff; }
          @media (prefers-color-scheme: dark) {
            :root { --bg: #0f1115; --text: #e6e8eb; --muted: #9aa3b0; --border: #262b34; --accent: #6ea0ff; --soft: #1b2540; }
          }
          body { margin: 0; background: var(--bg); color: var(--text); font: 17px/1.7 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
          main { max-width: 760px; margin: 0 auto; padding: 2.5rem 16px 4rem; }
          a { color: var(--accent); text-decoration: none; }
          a:hover { text-decoration: underline; }
          .note { background: var(--soft); border-radius: 10px; padding: 0.9rem 1rem; font-size: 0.95rem; }
          code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.9em; word-break: break-all; }
          article { padding: 1.1rem 0; border-bottom: 1px solid var(--border); }
          h3 { margin: 0 0 0.3rem; }
          p { margin: 0.3rem 0; }
          .muted { color: var(--muted); font-size: 0.9rem; }
        </style>
      </head>
      <body>
        <main>
          <p class="note">
            This is an RSS feed. Copy this page's URL into a feed reader to follow new articles:
            <br /><code>https://wallinslax.github.io/rss.xml</code>
          </p>
          <h1><xsl:value-of select="/rss/channel/title" /></h1>
          <p class="muted"><xsl:value-of select="/rss/channel/description" /></p>
          <p><a href="/">← Back to the site</a></p>
          <xsl:for-each select="/rss/channel/item">
            <article>
              <h3><a href="{link}"><xsl:value-of select="title" /></a></h3>
              <p><xsl:value-of select="description" /></p>
              <p class="muted"><xsl:value-of select="substring(pubDate, 1, 16)" /></p>
            </article>
          </xsl:for-each>
        </main>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
