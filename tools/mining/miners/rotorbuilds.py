"""
RotorBuilds miner.

Target: https://rotorbuilds.com/

FRAMING (important — read before editing the filter):

"Professional" in Forge means the END USER is a professional (integrator,
procurement officer, tier-1 operator, commercial pilot). It does NOT mean the
DATA SOURCE has to be professional. A Foxeer camera on a 5" freestyle build is
the same camera as on a defense ISR quad — the hardware doesn't care which
community bought it.

The hobby FPV community has:
  - Orders of magnitude more builds than the defense community
  - Vastly more flight hours per hardware combo
  - Faster feedback loops on what actually works together
  - Zero institutional gatekeeping on part-pairing knowledge

A tier-1 soldier in the field can't match the pilot intuition of a 17-year-old
hobby kid with 2,000 hours on a 5" quad. Forge's job is to harvest that
hobby-community ground truth and pipe it into Wingman so the soldier can
benefit from it via "brother hobby + brain fpv is a bad idea" answers.

So: the filter in this miner is a QUALITY gate, not a category gate.
  - Accept: all sizes (whoops, 5", 7", cinelifters, heavy lift)
  - Accept: all firmwares (Betaflight, INAV, ArduPilot, PX4)
  - Accept: all communities (freestyle, race, long-range, commercial)
  - Reject: builds with zero parts, blank titles, spam-looking descriptions

What we take:
  - Aggregate part co-occurrence stats (which FC ships with which ESC)
  - Part alias normalization (how users type part names vs. canonical DB)
  - Price observation points across retailers
  - Build archetype clusters (by frame size + purpose) for Wingman templates

Legal stance: derived/aggregate extraction only, transform-not-mirror. No
verbatim photos, no verbatim user writeups, no comments. The output is a
statistical graph over parts + a normalization table. See tools/mining/README.md
for the full policy.

RotorBuilds robots.txt (verified 2026-04): User-agent: * / Allow: / with
ai-train=no signal. Scraping for aggregate stats is permitted; training AI
on verbatim content is not. This miner emits only derived data, not verbatim.

DOM structure (verified from live page 2026-04-16):
  Index pages (/builds, /explore): single-quoted hrefs like href='/build/36877'
  Build pages (/build/N):
    <tr>
      <td class='tag' data-tag='fc'><h4>Flight Controller</h4></td>
      <td class='name'>
        <a href='...'>Part Name</a>
        <div class='vendor'>VendorName</div>
      </td>
      <td class='price'><span>$115.99</span></td>
    </tr>
  data-tag values: fc, motor, frame, prop, fpvcamera, tx, antenna, rx, battery,
                   esc, pdb, 3d, hardware (may extend)
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Iterable

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from mining.lib.base_miner import BaseMiner, MinerConfig, Record  # noqa: E402


# ── Category slug → canonical Forge category name ──────────────────────────

TAG_TO_CATEGORY = {
    "fc":        "flight_controller",
    "esc":       "esc",
    "motor":     "motor",
    "frame":     "frame",
    "prop":      "propeller",
    "fpvcamera": "camera",
    "tx":        "vtx",
    "antenna":   "antenna",
    "rx":        "receiver",
    "battery":   "battery",
    "pdb":       "power_distribution",
    "gps":       "gps",
    "stack":     "stack",
    "3d":        "3d_print",
    "hardware":  "hardware",
}

SPAM_MARKERS = {
    "test build", "asdf", "untitled", "new build",
    "please delete", "deleted", "removed by",
}

# Part names that indicate a shopping cart, rate-limit page, or toy drone
# rather than a real FPV build.
SPAM_PART_NAMES = {
    "whoa there",   # RotorBuilds rate-limit / error page
    "my cart",      # shopping cart UI parsed as a part
}

# If this fraction of parts have toy-drone vendor signals, reject the build.
_TOY_DRONE_SIGNALS = {"onderdelen", "afstandsbediening"}  # Dutch toy drone listings


class RotorBuildsMiner(BaseMiner):
    """
    Yields build URLs from /builds and /explore, then parses each build page
    into a Record with a real parts list extracted from the DOM.
    Filter (is_relevant) is a quality gate only — no category exclusion.
    """

    @classmethod
    def default_config(cls) -> MinerConfig:
        return MinerConfig(
            source_name="rotorbuilds",
            base_url="https://rotorbuilds.com",
            # Be polite — 3s between requests.
            min_request_interval_sec=3.0,
            user_agent="ForgeMinerBot/0.1 (+https://forgeprole.netlify.app; research@droneclear.ai)",
            respect_robots=True,
            robots_block_behavior="skip",
        )

    def targets(self) -> Iterable[str]:
        """
        Pass 1: /builds page (latest builds, high volume).
        Pass 2: /explore (featured/curated builds, higher signal).
        Pass 3: build pages discovered during index parse this run.
        """
        for page in range(1, 11):
            yield f"{self.config.base_url}/builds?page={page}"
        for page in range(1, 11):
            yield f"{self.config.base_url}/explore?page={page}"
        for url in getattr(self, "_discovered_build_urls", []):
            yield url

    # ── Regex patterns ───────────────────────────────────────────────────────

    # Index page: single-quoted OR double-quoted hrefs to /build/N
    _BUILD_URL_RE = re.compile(r"""href=['"](/build/\d+[^'"#?]*)['"]""")

    # Build page: each parts row
    # Matches: <td class='tag' data-tag='fc'>...  <td class='name'><a ...>Name</a> <div class='vendor'>V</div>  <td class='price'><span>$X</span>
    _PARTS_ROW = re.compile(
        r"<td[^>]*class=['\"]tag['\"][^>]*data-tag=['\"]([^'\"]+)['\"].*?"   # group 1: data-tag
        r"<td[^>]*class=['\"]name['\"]>(.*?)</td>",                           # group 2: name cell HTML
        re.DOTALL | re.I,
    )
    _PART_NAME_ANCHOR = re.compile(r"<a[^>]*>([^<]+)</a>", re.I)
    _VENDOR_DIV       = re.compile(r"<div[^>]*class=['\"]vendor['\"][^>]*>([^<]+)", re.I)
    _PRICE_SPAN       = re.compile(r"<td[^>]*class=['\"]price['\"][^>]*>\s*<span>([^<]+)</span>", re.I)
    _TITLE_TAG        = re.compile(r"<title>([^<]+)</title>", re.I)
    _PROP_SIZE_RE     = re.compile(r"(\d{1,2})\s*(?:inch|in|\")", re.I)
    _STRIP_TAGS       = re.compile(r"<[^>]+>")

    def parse(self, url: str, body: str) -> Iterable[Record]:
        if "/builds" in url or "/explore" in url:
            yield from self._parse_index(url, body)
        elif "/build/" in url:
            yield from self._parse_build(url, body)

    def _parse_index(self, url: str, body: str) -> Iterable[Record]:
        """Emit build_index records for each build URL discovered."""
        discovered: set[str] = set()
        for m in self._BUILD_URL_RE.finditer(body):
            full = self.config.base_url + m.group(1)
            if full not in discovered:
                discovered.add(full)
                yield Record(
                    source="rotorbuilds",
                    fetched_at="",
                    url=full,
                    record_type="build_index",
                    data={"build_url": full},
                    meta={"discovered_from": url},
                )
        if not hasattr(self, "_discovered_build_urls"):
            self._discovered_build_urls = []
        self._discovered_build_urls.extend(discovered)

    def _parse_build(self, url: str, body: str) -> Iterable[Record]:
        """
        Extract parts from the real RotorBuilds DOM:
          <td class='tag' data-tag='fc'> → category
          <td class='name'><a>Name</a><div class='vendor'>V</div>  → part name + vendor
        """
        title_m = self._TITLE_TAG.search(body)
        title = self._decode_html(title_m.group(1).strip()) if title_m else ""

        # Prop-size hint from title + first 2000 chars of body
        size_hint = None
        for m in self._PROP_SIZE_RE.finditer(title + " " + body[:2000]):
            try:
                size_hint = int(m.group(1))
                break
            except ValueError:
                continue

        parts = self._extract_parts(body)

        yield Record(
            source="rotorbuilds",
            fetched_at="",
            url=url,
            record_type="build",
            data={
                "title": title,
                "prop_size_inch_hint": size_hint,
                "parts": parts,
                "part_count": len(parts),
                "tags": [],
                "description_len": 0,  # never store verbatim text
            },
            meta={},
        )

    def _extract_parts(self, body: str) -> list[dict]:
        """
        Walk <tr> rows whose first <td> has class='tag' and data-tag=.
        Extracts: category (mapped to Forge slug), name, vendor.
        """
        parts = []
        # We need to pair each <td class='tag'> with its following <td class='name'>
        # and optionally the <td class='price'>. The compiled _PARTS_ROW does this.
        for m in self._PARTS_ROW.finditer(body):
            raw_tag = m.group(1).strip().lower()
            category = TAG_TO_CATEGORY.get(raw_tag, raw_tag)
            name_html = m.group(2)

            # Part name: first anchor text in the name cell
            name_m = self._PART_NAME_ANCHOR.search(name_html)
            if not name_m:
                continue
            name = self._decode_html(name_m.group(1).strip())
            if not name:
                continue

            # Vendor: <div class='vendor'>
            vendor_m = self._VENDOR_DIV.search(name_html)
            vendor = vendor_m.group(1).strip() if vendor_m else ""

            parts.append({
                "category": category,
                "name": name,
                "vendor": vendor,
            })

        return parts

    @staticmethod
    def _decode_html(s: str) -> str:
        """Unescape basic HTML entities."""
        return (s
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", '"')
                .replace("&#39;", "'"))

    def is_relevant(self, record: Record) -> bool:
        """Quality gate only. No category exclusion."""
        if record.record_type == "build_index":
            return True
        if record.record_type != "build":
            return True

        title = (record.data.get("title") or "").lower().strip()
        if not title:
            self.log.debug(f"blank title: {record.url}")
            return False

        if any(spam in title for spam in SPAM_MARKERS):
            self.log.debug(f"spam marker: {record.url}")
            return False

        if record.data.get("part_count", 0) < 3:
            self.log.debug(f"too few parts ({record.data.get('part_count')}): {record.url}")
            return False

        parts = record.data.get("parts") or []
        part_names = [p.get("name", "").lower() for p in parts]

        # Reject if any part name matches a known spam/error-page token
        if any(spam in name for name in part_names for spam in SPAM_PART_NAMES):
            self.log.debug(f"spam part name: {record.url}")
            return False

        # Reject toy-drone wishlists (e.g. Dutch parts listings for toy quads)
        if any(sig in name for name in part_names for sig in _TOY_DRONE_SIGNALS):
            self.log.debug(f"toy-drone signal in parts: {record.url}")
            return False

        return True


if __name__ == "__main__":
    import argparse
    import logging
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    ap = argparse.ArgumentParser(description="RotorBuilds miner")
    ap.add_argument("--fixture", metavar="FILE",
                    help="Parse a local HTML file instead of fetching from the web")
    ap.add_argument("--url", default="https://rotorbuilds.com/build/0",
                    help="Fake URL to use when parsing a fixture file")
    ap.add_argument("--max", type=int, default=25)
    args = ap.parse_args()

    miner = RotorBuildsMiner(RotorBuildsMiner.default_config())

    if args.fixture:
        body = Path(args.fixture).read_text(encoding="utf-8", errors="replace")
        records = list(miner.parse(args.url, body))
        print(f"Emitted {len(records)} record(s) from fixture:")
        for r in records:
            print(f"  {r.record_type}: {r.data}")
    else:
        records = miner.run(max_records=args.max)
        print(f"Emitted {len(records)} records")
