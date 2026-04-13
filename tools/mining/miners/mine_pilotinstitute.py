"""
Pilot Institute DFR article miner.

Target: https://pilotinstitute.com

Why it matters: Pilot Institute is the highest-traffic FAA/drone regulation
educational site in the US. Their articles on DFR, BVLOS, COW applications,
Part 108, and public safety UAS are:
  - Written by working CFIs and regulatory practitioners
  - SEO-dominant — what agency pilots and procurement staff actually read
  - Kept current with FAA rulemaking (they update articles, not just publish-and-forget)
  - Free of industry marketing bias (they sell training, not hardware)

What we mine:
  - Article titles, URLs, pub/updated dates, summaries
  - Tag/category signal (which articles are DFR vs recreational vs commercial)
  - No verbatim content reproduction — transform-only, aggregate/derived

Legal stance:
  - Public articles, no login wall, no paywall
  - robots.txt respected
  - Standard web scraping of public editorial content — fair use for
    non-commercial research and aggregation (hiQ v. LinkedIn, Google Books)
  - We store metadata + derived summaries only, not article text

Output: data/dfr/raw/pilotinstitute_<date>.json
         → normalizer merges into data/dfr/dfr_master.json

Status: PRODUCTION. Run daily or on-demand via GitHub Actions.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Iterable

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from mining.lib.base_miner import BaseMiner, MinerConfig, Record  # noqa: E402


# ---------------------------------------------------------------------------
# Keywords that indicate DFR / public safety / regulatory relevance
# ---------------------------------------------------------------------------
DFR_KEYWORDS = {
    # Operations
    "drone as first responder", "dfr", "bvlos", "beyond visual line of sight",
    "drone in a box", "drone-in-a-box", "autonomous drone", "remote id",
    # Regulatory
    "part 108", "part 107", "cow", "certificate of waiver", "coa",
    "beyond visual", "waiver", "faa waiver", "laanc", "operation over people",
    "subpart d", "remote pilot", "part 91",
    # Public safety
    "public safety", "law enforcement", "police drone", "fire department drone",
    "search and rescue", "sar drone", "911", "first responder",
    # Compliance
    "ndaa", "blue uas", "asda", "fcc covered list", "section 848",
    "itar", "export control",
}

# Tags / categories Pilot Institute uses on their site
DFR_CATEGORIES = {
    "regulations", "bvlos", "commercial drone", "public safety",
    "faa news", "drone laws", "waiver",
}


class PilotInstituteMiner(BaseMiner):
    """
    Mines Pilot Institute's public blog/guides for DFR-relevant articles.

    Strategy:
      1. Fetch sitemap XML to discover all article URLs (avoids paginating JS)
      2. For each URL matching our category/keyword filter, fetch the page
      3. Extract: title, pub date, updated date, meta description, tags
      4. Score relevance; emit Record for anything above threshold
      5. Do NOT store article body — only metadata + derived fields

    Pilot Institute uses WordPress, so:
      - Sitemap at /sitemap_index.xml → /post-sitemap.xml
      - Articles use standard OG meta tags (og:title, og:description, etc.)
      - Categories exposed in <meta name="category"> or body class
    """

    @classmethod
    def default_config(cls) -> MinerConfig:
        return MinerConfig(
            source_name="pilotinstitute",
            base_url="https://pilotinstitute.com",
            min_request_interval_sec=3.0,   # polite; their server is not huge
            user_agent="ForgeMinerBot/0.1 (+https://forgeprole.netlify.app; research@droneclear.ai)",
            respect_robots=True,
            robots_block_behavior="skip",
            max_retries=2,
        )

    # Sitemap locations (WordPress standard)
    SITEMAPS = [
        "https://pilotinstitute.com/post-sitemap.xml",
        "https://pilotinstitute.com/post-sitemap2.xml",   # exists if >1000 posts
        "https://pilotinstitute.com/page-sitemap.xml",
    ]

    # URL path segments that strongly indicate DFR/regulatory content
    URL_SIGNALS = {
        "bvlos", "waiver", "part-108", "part-107", "dfr", "first-responder",
        "public-safety", "ndaa", "remote-id", "beyond-visual", "cow",
        "drone-laws", "faa-regulations", "commercial-drone",
    }

    # Regex patterns for meta extraction
    _OG_TITLE    = re.compile(r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\'](.*?)["\']', re.I)
    _OG_DESC     = re.compile(r'<meta[^>]+property=["\']og:description["\'][^>]+content=["\'](.*?)["\']', re.I | re.DOTALL)
    _META_DESC   = re.compile(r'<meta[^>]+name=["\']description["\'][^>]+content=["\'](.*?)["\']', re.I | re.DOTALL)
    _TITLE_TAG   = re.compile(r'<title>(.*?)</title>', re.I | re.DOTALL)
    _PUB_DATE    = re.compile(r'<meta[^>]+property=["\']article:published_time["\'][^>]+content=["\']([\d\-T:+Z]+)["\']', re.I)
    _MOD_DATE    = re.compile(r'<meta[^>]+property=["\']article:modified_time["\'][^>]+content=["\']([\d\-T:+Z]+)["\']', re.I)
    _SITEMAP_URL = re.compile(r'<loc>(https://pilotinstitute\.com[^<]*)</loc>')
    _BODY_CLASS  = re.compile(r'<body[^>]+class=["\'](.*?)["\']', re.I)

    def targets(self) -> Iterable[str]:
        """
        Two-pass strategy:
          Pass 1: fetch sitemaps → extract article URLs
          Pass 2: yield individual article URLs for parsing

        We filter at the URL level first (cheap) before fetching full pages.
        """
        # Emit sitemap URLs first; parse() will discover article URLs
        for sm in self.SITEMAPS:
            yield sm

        # Pass 2 URLs are stashed by parse() as it processes sitemaps
        for url in getattr(self, "_article_urls", []):
            yield url

    def parse(self, url: str, body: str) -> Iterable[Record]:
        if not body:
            return

        # --- Sitemap pass ---
        if "sitemap" in url and body.strip().startswith("<?xml"):
            urls = self._SITEMAP_URL.findall(body)
            self.log.info(f"Sitemap {url}: {len(urls)} URLs found")

            filtered = [u for u in urls if self._url_is_relevant(u)]
            self.log.info(f"  → {len(filtered)} pass URL filter")

            if not hasattr(self, "_article_urls"):
                self._article_urls = []
            self._article_urls.extend(filtered)
            return   # no records from sitemap itself

        # --- Article pass ---
        yield from self._parse_article(url, body)

    def _url_is_relevant(self, url: str) -> bool:
        """Fast URL-level relevance check before fetching the full page."""
        lower = url.lower()
        return any(sig in lower for sig in self.URL_SIGNALS)

    def _parse_article(self, url: str, body: str) -> Iterable[Record]:
        """Extract metadata from a Pilot Institute article page."""

        # Title
        title = ""
        m = self._OG_TITLE.search(body)
        if m:
            title = self._unescape(m.group(1)).strip()
        if not title:
            m = self._TITLE_TAG.search(body)
            if m:
                title = self._unescape(m.group(1)).split("|")[0].split("–")[0].strip()
        if not title:
            return  # can't do anything useful without a title

        # Description / summary
        summary = ""
        m = self._OG_DESC.search(body)
        if m:
            summary = self._unescape(m.group(1)).strip()
        if not summary:
            m = self._META_DESC.search(body)
            if m:
                summary = self._unescape(m.group(1)).strip()

        # Dates
        pub_date = ""
        m = self._PUB_DATE.search(body)
        if m:
            pub_date = m.group(1)[:10]   # YYYY-MM-DD
        mod_date = ""
        m = self._MOD_DATE.search(body)
        if m:
            mod_date = m.group(1)[:10]

        # Categories from body class (WordPress pattern: "category-bvlos category-regulations")
        categories = []
        m = self._BODY_CLASS.search(body)
        if m:
            classes = m.group(1).split()
            categories = [
                c.replace("category-", "").replace("-", " ")
                for c in classes if c.startswith("category-")
            ]

        # Relevance score: title + summary keyword density
        combined = (title + " " + summary + " " + " ".join(categories)).lower()
        matched = [kw for kw in DFR_KEYWORDS if kw in combined]
        if not matched:
            return  # not DFR-relevant even after URL filter

        score = min(99, 60 + len(matched) * 8)   # base 60, +8 per keyword hit

        # Stable ID from URL slug
        slug = url.rstrip("/").split("/")[-1] or url.rstrip("/").split("/")[-2]
        record_id = f"pilotinstitute_{slug}_{(pub_date or mod_date or 'undated').replace('-', '')}"

        yield Record(
            source="pilotinstitute",
            fetched_at="",
            url=url,
            record_type="article",
            data={
                "id": record_id,
                "title": title,
                "summary": summary[:600],     # cap — no verbatim reproduction
                "pub_date": pub_date,
                "mod_date": mod_date,
                "categories": categories,
                "matched_keywords": matched,
                "relevance_score": score,
                "source": "pilotinstitute",
                "source_url": url,
                "vertical_tag": "dfr",
                "paywall": False,
            },
            meta={"keyword_hits": matched, "score": score},
        )

    @staticmethod
    def _unescape(s: str) -> str:
        """Basic HTML entity decode."""
        return (s
                .replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
                .replace("&quot;", '"').replace("&#39;", "'").replace("&nbsp;", " ")
                .replace("&#8211;", "–").replace("&#8212;", "—").replace("&#8217;", "'"))

    def is_relevant(self, record: Record) -> bool:
        if record.record_type != "article":
            return True
        # Require at least 2 keyword hits or score ≥ 70
        return (
            len(record.data.get("matched_keywords", [])) >= 2
            or record.data.get("relevance_score", 0) >= 70
        )


# ---------------------------------------------------------------------------
# Normalizer: raw pilotinstitute records → dfr_master.json entries
# ---------------------------------------------------------------------------

def normalize_to_dfr_master(raw_records: list[dict], snapshot_date: str) -> list[dict]:
    """
    Convert raw pilotinstitute records into dfr_master.json schema.

    dfr_master schema fields (from existing records):
      id, title, url, source, source_file, pub_date, summary,
      vertical_tag, data_category, paywall, confidence,
      mined_at, normalized_at, snapshot_date
    """
    out = []
    for r in raw_records:
        d = r.get("data", r)   # handle both Record.data dict and raw dict
        if not d.get("title") or not d.get("url"):
            continue

        out.append({
            "id": d.get("id", f"pilotinstitute_{hashlib.sha1(d['url'].encode()).hexdigest()[:10]}"),
            "title": d["title"],
            "url": d["url"],
            "source": "pilotinstitute",
            "source_file": f"pilotinstitute_{snapshot_date}.json",
            "pub_date": d.get("pub_date") or d.get("mod_date") or snapshot_date,
            "summary": d.get("summary", ""),
            "vertical_tag": "dfr",
            "data_category": _categorize(d),
            "paywall": False,
            "confidence": d.get("relevance_score", 70),
            "matched_keywords": d.get("matched_keywords", []),
            "mined_at": datetime.utcnow().isoformat() + "Z",
            "normalized_at": datetime.utcnow().isoformat() + "Z",
            "snapshot_date": snapshot_date,
        })
    return out


def _categorize(d: dict) -> str:
    """Assign a data_category based on content signals."""
    kws = " ".join(d.get("matched_keywords", [])).lower()
    title = d.get("title", "").lower()
    combined = kws + " " + title
    if any(w in combined for w in ["waiver", "cow", "coa", "part 108", "bvlos authorization"]):
        return "regulatory_pathway"
    if any(w in combined for w in ["ndaa", "blue uas", "asda", "fcc covered", "section 848"]):
        return "compliance"
    if any(w in combined for w in ["grant", "funding", "ael", "hsgp", "cops"]):
        return "funding"
    if any(w in combined for w in ["law enforcement", "police", "fire", "sar", "911", "first responder"]):
        return "public_safety"
    if any(w in combined for w in ["part 107", "remote pilot", "certification"]):
        return "certification"
    return "general_dfr"


def merge_into_dfr_master(
    new_records: list[dict],
    master_path: str = "data/dfr/dfr_master.json",
) -> tuple[int, int]:
    """
    Merge normalized records into dfr_master.json.
    Deduplicates by URL. Returns (added, skipped) counts.
    """
    master_path = Path(master_path)
    master = json.loads(master_path.read_text(encoding="utf-8")) if master_path.exists() else {"records": [], "meta": {}}
    existing_urls = {r.get("url") for r in master.get("records", [])}

    added = skipped = 0
    for rec in new_records:
        if rec["url"] in existing_urls:
            skipped += 1
        else:
            master["records"].append(rec)
            existing_urls.add(rec["url"])
            added += 1

    if added:
        master_path.write_text(json.dumps(master, indent=2, ensure_ascii=False), encoding="utf-8")

    return added, skipped


# ---------------------------------------------------------------------------
# CLI entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import logging
    import argparse

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    log = logging.getLogger("mine_pilotinstitute")

    parser = argparse.ArgumentParser(description="Mine Pilot Institute for DFR articles")
    parser.add_argument("--max", type=int, default=100, help="Max article records to emit")
    parser.add_argument("--dry", action="store_true", help="Print records, don't write files")
    parser.add_argument("--no-merge", action="store_true", help="Write raw file but skip dfr_master merge")
    args = parser.parse_args()

    today = datetime.utcnow().strftime("%Y-%m-%d")

    miner = PilotInstituteMiner(PilotInstituteMiner.default_config())
    records = miner.run(max_records=args.max)
    log.info(f"Miner complete: {len(records)} records emitted")

    if args.dry:
        for r in records:
            print(json.dumps(r.data if hasattr(r, 'data') else r, indent=2, ensure_ascii=False)[:400])
            print()
        raise SystemExit(0)

    # Write raw output
    raw_path = Path(f"data/dfr/raw/pilotinstitute_{today}.json")
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    raw_data = [r.data if hasattr(r, 'data') else r for r in records]
    raw_path.write_text(json.dumps(raw_data, indent=2, ensure_ascii=False), encoding="utf-8")
    log.info(f"Raw output: {raw_path} ({len(raw_data)} records)")

    if args.no_merge:
        raise SystemExit(0)

    # Normalize and merge
    normalized = normalize_to_dfr_master(raw_data, today)
    added, skipped = merge_into_dfr_master(normalized)
    log.info(f"dfr_master.json: +{added} new, {skipped} skipped (already present)")
    print(f"\nDone. {len(records)} articles mined → {added} added to dfr_master.json")
