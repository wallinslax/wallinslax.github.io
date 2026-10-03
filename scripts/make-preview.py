"""Copy the built site (dist/) into a folder with relative links so it can be
published as a multi-file Claude artifact preview.

Usage: python3 scripts/make-preview.py <out_dir>
Writes <out_dir>/site/... and prints the list of published paths.
"""
import json
import os
import re
import shutil
import sys

SKIP = ('legacy', 'sitemap', 'rss')  # not needed in a preview; RSS XML is rejected by the artifact host


def fix(match, prefix):
    attr, quote, path = match.group(1), match.group(2), match.group(3)
    tail = ''
    for sep in ('#', '?'):
        if sep in path:
            path, rest = path.split(sep, 1)
            tail = sep + rest + tail
    if path == '' or path.endswith('/'):
        path += 'index.html'
    return f'{attr}={quote}{prefix}{path}{tail}{quote}'


def main(out_dir):
    site = os.path.join(out_dir, 'site')
    shutil.rmtree(site, ignore_errors=True)
    shutil.copytree('dist', site, ignore=lambda d, names: [n for n in names if n.startswith(SKIP)])
    files = []
    for d, _, names in os.walk(site):
        rel = os.path.relpath(d, site)
        depth = 0 if rel == '.' else rel.count(os.sep) + 1
        for name in names:
            path = os.path.join(d, name)
            files.append(os.path.relpath(path, out_dir))
            if not name.endswith('.html'):
                continue
            with open(path) as f:
                html = f.read()
            html = re.sub(r'\b(href|src)=(["\'])/(?!/)([^"\']*)\2', lambda m: fix(m, '../' * depth or './'), html)
            with open(path, 'w') as f:
                f.write(html)
    with open(os.path.join(out_dir, 'site-preview.html'), 'w') as f:
        f.write(
            '<title>Sung-Fu Han Site Preview</title>\n'
            '<style>:root{--bg:#fff;--fg:#1c1f24;--accent:#2563eb}'
            '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0f1115;--fg:#e6e8eb;--accent:#6ea0ff;color-scheme:dark}}'
            ':root[data-theme="dark"]{--bg:#0f1115;--fg:#e6e8eb;--accent:#6ea0ff;color-scheme:dark}'
            'body{background:var(--bg);color:var(--fg);font:17px/1.6 system-ui,sans-serif;padding-inline:16px;padding-block:3rem}'
            'a{color:var(--accent)}</style>\n'
            '<p>Opening the site preview… <a href="site/index.html">Open the home page</a>.</p>\n'
            "<script>location.replace('site/index.html');</script>\n"
        )
    print(json.dumps({p: p for p in sorted(files)}, indent=2))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'preview')
