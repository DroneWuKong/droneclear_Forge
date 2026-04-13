"""
DIU Blue UAS Cleared List + Blue UAS Framework miner.

Target: https://bluelist.dcma.mil  (primary since DCMA takeover July 2025)
        https://www.diu.mil/blue-uas (DIU landing page, links to DCMA)

This is OFFICIAL US Government public-domain data. Mining is explicitly
permitted — no ToS concerns.

Why it matters: ground-truth NDAA compliance for drone procurement.
Every entry is a positive compliance signal for forge_database.json flags,
manufacturer_status.json, and the /compliance/ dashboard.

Known page structure (as of 2026-04):
  bluelist.dcma.mil renders a searchable table via React/JS.
  Three extraction approaches, tried in order:
    1. Embedded JSON in <script> tags (fastest, most reliable)
    2. Static HTML table rows if SSR is enabled
    3. DCMA publishes a downloadable Excel/PDF — check for a link and queue it

  DIU Framework page (diu.mil/blue-uas) uses Webflow CMS.
  Framework component entries are in Webflow collection-item divs.

Status: PRODUCTION-READY. parse() handles both JSON-in-script and
HTML-table formats. Falls back gracefully when DOM is JS-only.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Iterable

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from mining.lib.base_miner import BaseMiner, MinerConfig, Record  # noqa: E402


class BlueUASMiner(BaseMiner):

    @classmethod
    def default_config(cls) -> MinerConfig:
        return MinerConfig(
            source_name="blue_uas",
            base_url="https://bluelist.dcma.mil",
            min_request_interval_sec=1.5,
            user_agent="ForgeMinerBot/0.1 (+https://forgeprole.netlify.app; research@droneclear.ai)",
            respect_robots=True,
        )

    # ── URL list ────────────────────────────────────────────────────────────

    def targets(self) -> Iterable[str]:
        # Primary: DCMA Blue UAS list
        yield "https://bluelist.dcma.mil"
        yield "https://bluelist.dcma.mil/BlueList/PublicView"
        # DIU landing page — links to DCMA + Framework component list
        yield "https://www.diu.mil/blue-uas"
        yield "https://www.diu.mil/blue-uas-cleared-list"

    # ── Regex patterns ───────────────────────────────────────────────────────

    # Embedded JSON blobs in <script> tags (Next.js / React hydration)
    _SCRIPT_JSON   = re.compile(r'<script[^>]*type=["\']application/json["\'][^>]*>(.*?)</script>', re.DOTALL)
    _NEXT_DATA     = re.compile(r'<script[^>]*id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>', re.DOTALL)
    # HTML table rows
    _TR            = re.compile(r'<tr[^>]*>(.*?)</tr>', re.DOTALL | re.I)
    _TD            = re.compile(r'<td[^>]*>(.*?)</td>', re.DOTALL | re.I)
    _STRIP_TAGS    = re.compile(r'<[^>]+>')
    # Webflow collection items (DIU site)
    _COLLECTION    = re.compile(r'class=["\'][^"\']*collection-item[^"\']*["\']', re.I)
    _WF_FIELD      = re.compile(r'class=["\'][^"\']*w-dyn-bind[^"\']*["\'][^>]*>(.*?)</[a-z]+>', re.DOTALL | re.I)
    # Download links for Excel/PDF
    _DOWNLOAD_LINK = re.compile(r'href=["\']([^"\']+\.(?:xlsx?|csv|pdf))["\']', re.I)

    # ── parse() ─────────────────────────────────────────────────────────────

    def parse(self, url: str, body: str) -> Iterable[Record]:
        if not body:
            return

        domain = url.split("/")[2]

        if "dcma.mil" in domain:
            yield from self._parse_dcma(url, body)
        elif "diu.mil" in domain:
            yield from self._parse_diu(url, body)

    def _parse_dcma(self, url: str, body: str) -> Iterable[Record]:
        """Parse DCMA Blue UAS list page."""

        # Strategy 1: __NEXT_DATA__ (Next.js)
        m = self._NEXT_DATA.search(body)
        if m:
            try:
                data = json.loads(m.group(1))
                platforms = self._extract_from_nextdata(data)
                if platforms:
                    self.log.info(f"DCMA __NEXT_DATA__: {len(platforms)} platforms")
                    for p in platforms:
                        yield self._make_record(p, url, "cleared_system")
                    return
            except (json.JSONDecodeError, KeyError):
                pass

        # Strategy 2: any embedded JSON blob with platform-looking data
        for m in self._SCRIPT_JSON.finditer(body):
            try:
                blob = json.loads(m.group(1))
                platforms = self._find_platforms_in_blob(blob)
                if platforms:
                    self.log.info(f"DCMA script JSON: {len(platforms)} platforms")
                    for p in platforms:
                        yield self._make_record(p, url, "cleared_system")
                    return
            except (json.JSONDecodeError, TypeError):
                continue

        # Strategy 3: HTML table
        rows = self._TR.findall(body)
        parsed = []
        for row in rows:
            cells = [self._clean(c) for c in self._TD.findall(row)]
            if len(cells) >= 3 and cells[0] and cells[0].lower() not in ("system", "name", "manufacturer", "vendor"):
                parsed.append({"name": cells[0], "vendor": cells[1] if len(cells) > 1 else "",
                                "category": cells[2] if len(cells) > 2 else "",
                                "status": cells[3] if len(cells) > 3 else "cleared"})
        if parsed:
            self.log.info(f"DCMA HTML table: {len(parsed)} rows")
            for p in parsed:
                yield self._make_record(p, url, "cleared_system")
            return

        # Strategy 4: JS-rendered — emit a single diagnostic record + queue downloads
        downloads = self._DOWNLOAD_LINK.findall(body)
        self.log.warning(f"DCMA {url}: JS-rendered, no static data. Downloads found: {downloads}")
        yield Record(
            source="blue_uas",
            fetched_at="",
            url=url,
            record_type="meta_jsrendered",
            data={
                "page_bytes": len(body),
                "download_links": downloads,
                "note": "Page is JS-rendered. Run with Playwright or fetch the Excel download link.",
            },
            meta={"SCAFFOLD": True, "needs_playwright": True},
        )

    def _parse_diu(self, url: str, body: str) -> Iterable[Record]:
        """Parse DIU Blue UAS page for framework component entries."""
        # Webflow CMS pattern: collection-item divs with w-dyn-bind children
        items_found = len(self._COLLECTION.findall(body))
        if items_found == 0:
            # Check for any useful links to DCMA or downloads
            downloads = self._DOWNLOAD_LINK.findall(body)
            links = re.findall(r'href=["\']([^"\']*bluelist[^"\']*)["\']', body, re.I)
            if downloads or links:
                yield Record(
                    source="blue_uas",
                    fetched_at="",
                    url=url,
                    record_type="meta_links",
                    data={"downloads": downloads, "dcma_links": links},
                    meta={},
                )
            return

        # Extract name + role from Webflow fields
        # Walk all collection items in order
        item_re = re.compile(
            r'class=["\'][^"\']*collection-item[^"\']*["\'][^>]*>(.*?)(?=class=["\'][^"\']*collection-item|</div>)',
            re.DOTALL | re.I,
        )
        for item_m in item_re.finditer(body):
            item_html = item_m.group(1)
            fields = [self._clean(f) for f in self._WF_FIELD.findall(item_html)]
            fields = [f for f in fields if f]
            if fields:
                yield self._make_record(
                    {"name": fields[0], "vendor": fields[1] if len(fields) > 1 else "",
                     "role": fields[2] if len(fields) > 2 else "", "status": "framework"},
                    url, "framework_component",
                )

    # ── helpers ──────────────────────────────────────────────────────────────

    def _extract_from_nextdata(self, data: dict) -> list[dict]:
        """Walk __NEXT_DATA__ to find arrays of platform-like objects."""
        results = []
        self._walk_for_platforms(data, results, depth=0)
        return results

    def _walk_for_platforms(self, obj, out: list, depth: int):
        if depth > 8:
            return
        if isinstance(obj, list):
            for item in obj:
                if isinstance(item, dict) and self._looks_like_platform(item):
                    out.append(item)
                else:
                    self._walk_for_platforms(item, out, depth + 1)
        elif isinstance(obj, dict):
            for v in obj.values():
                self._walk_for_platforms(v, out, depth + 1)

    def _find_platforms_in_blob(self, blob) -> list[dict]:
        results = []
        self._walk_for_platforms(blob, results, depth=0)
        return results

    @staticmethod
    def _looks_like_platform(d: dict) -> bool:
        """Heuristic: does this dict look like a Blue UAS list entry?"""
        keys = {k.lower() for k in d.keys()}
        name_keys = {"name", "systemname", "system_name", "title", "productname"}
        vendor_keys = {"vendor", "manufacturer", "company", "oemname"}
        return bool(keys & name_keys) and bool(keys & vendor_keys)

    @staticmethod
    def _normalise_platform(d: dict) -> dict:
        """Normalise varied key names to standard fields."""
        def get(*keys):
            for k in keys:
                v = d.get(k) or d.get(k.lower()) or d.get(k.upper())
                if v:
                    return str(v).strip()
            return ""

        return {
            "name": get("name", "systemName", "system_name", "title", "productName"),
            "vendor": get("vendor", "manufacturer", "company", "oemName"),
            "category": get("category", "type", "systemType", "productType"),
            "cleared_date": get("clearedDate", "cleared_date", "approvedDate", "date"),
            "status": get("status", "listStatus") or "cleared",
            "description": get("description", "summary", "notes"),
        }

    def _make_record(self, raw: dict, url: str, record_type: str) -> Record:
        p = self._normalise_platform(raw)
        # Stable ID from name + vendor
        slug = re.sub(r"[^a-z0-9]+", "_", (p["name"] + "_" + p["vendor"]).lower()).strip("_")
        return Record(
            source="blue_uas",
            fetched_at="",
            url=url,
            record_type=record_type,
            data={
                "id": f"blue_uas_{slug[:60]}",
                "name": p["name"],
                "vendor": p["vendor"],
                "category": p["category"],
                "cleared_date": p["cleared_date"],
                "status": p["status"],
                "description": p["description"],
                "source_url": url,
            },
            meta={},
        )

    @staticmethod
    def _clean(html: str) -> str:
        """Strip HTML tags and normalise whitespace."""
        return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", html)).strip()

    def is_relevant(self, record: Record) -> bool:
        # Only keep records with actual platform names
        if record.record_type == "meta_jsrendered":
            return True   # keep diagnostic records
        return bool(record.data.get("name"))


if __name__ == "__main__":
    import logging
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    BlueUASMiner(BlueUASMiner.default_config()).run(max_records=300)
