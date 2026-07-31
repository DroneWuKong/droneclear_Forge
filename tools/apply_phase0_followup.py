#!/usr/bin/env python3
"""Apply the Phase 0 follow-up fixes discovered by the built-site audit.

This is a deterministic repository migration: it patches only known source
snippets, runs without network or hardware, and removes itself after the
validated commit is created by CI.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if new in text:
        print(f"already patched: {path}")
        return
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one patch target in {path}; found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")
    print(f"patched: {path}")


def patch_audit() -> None:
    path = ROOT / "tools" / "audit_public_site.py"
    old = '''    path = parsed.path or "/"
    if path.startswith(IGNORED_PREFIXES):
'''
    new = '''    path = parsed.path or "/"
    # Built pages live at /<route>/index.html, so links rewritten by the static
    # builder as ../ correctly resolve to the site root. Normalize any local
    # relative route into the same leading-slash form as the PAGES route map.
    if not parsed.netloc and not path.startswith("/"):
        while path.startswith("../"):
            path = path[3:]
        path = path.lstrip("./")
        path = "/" + path if path else "/"
    if path.startswith(IGNORED_PREFIXES):
'''
    replace_once(path, old, new)


def patch_nav_injection() -> None:
    path = ROOT / "build_static.py"
    old = '''    html = re.sub(
        r'<!-- ── Unified[^\\n]*?Nav[^\\n]*?-->.*?<!-- ── /Unified[^\\n]*?-->',
        '',
        html,
        count=1,
        flags=re.DOTALL,
    )

    # Inject the fresh nav after <body>
'''
    new = '''    html = re.sub(
        r'<!-- ── Unified[^\\n]*?Nav[^\\n]*?-->.*?<!-- ── /Unified[^\\n]*?-->',
        '',
        html,
        count=1,
        flags=re.DOTALL,
    )

    # Some early lens pages embedded a nav without the marker comments above.
    # Remove that complete pre-main structural block before injecting the
    # canonical nav. This keeps the build idempotent and prevents duplicate
    # dc-nav/drawer IDs in generated HTML.
    if re.search(r'<nav\\s+id=["\\\']dc-nav["\\\']', html, flags=re.IGNORECASE):
        html = re.sub(
            r'\\s*<nav\\s+id=["\\\']dc-nav["\\\'].*?(?=<main\\b)',
            '\\n',
            html,
            count=1,
            flags=re.DOTALL | re.IGNORECASE,
        )

    # Fail safe: never inject a second nav if an unusual legacy structure did
    # not match the known pre-main layout.
    if re.search(r'id=["\\\']dc-nav["\\\']', html, flags=re.IGNORECASE):
        return html

    # Inject the fresh nav after <body>
'''
    replace_once(path, old, new)


def patch_evasion_button() -> None:
    path = ROOT / "forge-source" / "evasion.html"
    text = path.read_text(encoding="utf-8")
    changed = 0

    pattern = re.compile(r"<button(?P<attrs>[^>]*)>(?P<body>.*?)</button>", re.IGNORECASE | re.DOTALL)

    def repl(match: re.Match[str]) -> str:
        nonlocal changed
        attrs = match.group("attrs")
        body = match.group("body")
        if re.search(r"\\b(?:aria-label|title)\\s*=", attrs, flags=re.IGNORECASE):
            return match.group(0)
        visible = re.sub(r"<[^>]+>", "", body).strip()
        if visible:
            return match.group(0)
        changed += 1
        return f'<button{attrs} aria-label="Toggle graph control">{body}</button>'

    updated = pattern.sub(repl, text)
    if changed:
        path.write_text(updated, encoding="utf-8")
        print(f"patched: {path} ({changed} accessible name added)")
    elif 'aria-label="Toggle graph control"' in text:
        print(f"already patched: {path}")
    else:
        raise SystemExit(f"expected an unlabeled icon button in {path}")


def patch_tests() -> None:
    path = ROOT / "tests" / "test_public_site_audit.py"
    old = '''    def test_required_invalid_dataset_is_blocking(self):
'''
    new = '''    def test_relative_parent_link_resolves_to_root(self):
        self.assertEqual(site_audit.normalize_route("../"), "/")
        self.assertEqual(site_audit.normalize_route("../brief/"), "/brief/")

    def test_required_invalid_dataset_is_blocking(self):
'''
    replace_once(path, old, new)


if __name__ == "__main__":
    patch_audit()
    patch_nav_injection()
    patch_evasion_button()
    patch_tests()
