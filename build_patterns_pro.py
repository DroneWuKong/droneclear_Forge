#!/usr/bin/env python3
"""
build_patterns_pro.py — Patterns Pro redirect stub

uas-patterns.pro has been merged into uas-patterns.com. This script now
generates a minimal build-patterns/ directory whose sole job is to redirect
all traffic from uas-patterns.pro → uas-patterns.com.

The uas-patterns-pro Netlify site still runs this build command; the
netlify.toml [[redirects]] rules handle the actual domain redirect, so the
published HTML is just a fallback that will rarely be served.
"""
import os

BUILD_DIR = 'build-patterns'

REDIRECT_HTML = '''\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="refresh" content="0; url=https://uas-patterns.com/">
<link rel="canonical" href="https://uas-patterns.com/">
<title>Redirecting — UAS- Patterns</title>
</head>
<body>
<p>Redirecting to <a href="https://uas-patterns.com/">uas-patterns.com</a>…</p>
<script>location.replace('https://uas-patterns.com' + location.pathname + location.search + location.hash);</script>
</body>
</html>
'''

def main():
    os.makedirs(BUILD_DIR, exist_ok=True)
    with open(os.path.join(BUILD_DIR, 'index.html'), 'w', encoding='utf-8') as f:
        f.write(REDIRECT_HTML)
    # Netlify _redirects file as belt-and-suspenders
    with open(os.path.join(BUILD_DIR, '_redirects'), 'w', encoding='utf-8') as f:
        f.write('/*  https://uas-patterns.com/:splat  301!\n')
    print(f'build_patterns_pro: redirect stub written to {BUILD_DIR}/')
    print('uas-patterns.pro → uas-patterns.com (merged)')

if __name__ == '__main__':
    main()
