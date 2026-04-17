"""
DIYFPV.com catalog miner.

Target: https://www.diyfpv.com/catalog

Why it matters: DIYFPV is a price-comparison aggregator for FPV parts,
fed by verified retailers and manufacturers directly. Each product listing
carries:
  - Canonical product name (curated by the platform)
  - Per-store prices in USD (converted from local currency)
  - Stock availability per retailer
  - Manufacturer flag (isManufacturer = True → source-of-truth name)
  - Retailer region (US, EU, OCEANIA, etc.)

This is higher-quality name data than RotorBuilds (hobbyist-typed) because
retailer/manufacturer submissions go through DIYFPV's curation process.
Useful for:
  - Parts name normalization (canonical model names from manufacturers)
  - Price discovery (current USD market prices per SKU)
  - Availability signal (in-stock vs discontinued)
  - Retailer coverage map (which US stores carry which parts)

robots.txt (verified 2026-04):
  User-agent: * / Allow: /catalog  (no Disallow on catalog pages)
  Disallow: /api  — we do NOT call /api; only catalog HTML pages.

DOM / data structure:
  Site is Next.js App Router (RSC). Data is embedded as:
    self.__next_f.push([1,"...escaped JSON..."])
  Product pages include a "storeProducts" array inside the RSC payload:
    {
      "currency": "USD",
      "storeProducts": [
        {
          "id": "...",
          "name": "SpeedyBee F405AIO ...",
          "stock": 1,
          "price": 7087.289,       # USD cents
          "storePrice": 11990,     # local currency cents
          "url": "https://...",    # direct retailer URL
          "store": {
            "name": "Quad Junkie NZ",
            "slug": "quad-junkie",
            "baseCurrency": "NZD",
            "isManufacturer": false,
            "region": "OCEANIA"
          }
        }, ...
      ]
    }

Category pages expose ~21 product links per page (initial SSR payload).
Full catalog has 25,000+ products; we crawl the first page of each
category (~19 cats × ~21 products = ~400 high-quality SKUs per run).
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Iterable

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from mining.lib.base_miner import BaseMiner, MinerConfig, Record  # noqa: E402


CATEGORY_SLUGS = [
    "flight-controllers",
    "escs",
    "motors",
    "frames",
    "mini-frames",
    "propellers",
    "fpv-antennas",
    "fpv-equipment",
    "batteries",
    "batteries-and-chargers",
    "radios",
    "action-cameras",
    "electronics",
]

SLUG_TO_FORGE = {
    "flight-controllers":    "flight_controller",
    "escs":                  "esc",
    "motors":                "motor",
    "frames":                "frame",
    "mini-frames":           "frame",
    "propellers":            "propeller",
    "fpv-antennas":          "antenna",
    "fpv-equipment":         "fpv_equipment",
    "batteries":             "battery",
    "batteries-and-chargers": "battery",
    "radios":                "transmitter",
    "action-cameras":        "camera",
    "electronics":           "electronics",
}


class DiyfpvCatalogMiner(BaseMiner):
    """
    Mines DIYFPV catalog for canonical part names and per-store price/stock data.
    Two-pass: category pages → product URLs → product pages.
    """

    @classmethod
    def default_config(cls) -> MinerConfig:
        return MinerConfig(
            source_name="diyfpv_catalog",
            base_url="https://www.diyfpv.com",
            min_request_interval_sec=3.0,
            user_agent="ForgeMinerBot/0.1 (+https://forgeprole.netlify.app; research@droneclear.ai)",
            respect_robots=True,
            robots_block_behavior="skip",
        )

    def targets(self) -> Iterable[str]:
        base = self.config.base_url
        for slug in CATEGORY_SLUGS:
            yield f"{base}/catalog/category/{slug}"
        for url in getattr(self, "_discovered_product_urls", []):
            yield url

    # ── Regex patterns ──────────────────────────────────────────────────────

    _PRODUCT_HREF = re.compile(
        r'href=["\'](?P<path>/catalog/(?!category/)[^"\'?#\s]{5,})["\']'
    )
    _RSC_PUSH = re.compile(
        r'self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)'
    )
    _STORE_PRODUCTS_BLOCK = re.compile(
        r'"storeProducts"\s*:\s*(\[.*?\])\s*[,}]',
        re.DOTALL,
    )
    _TITLE_TAG = re.compile(r'<title>([^<|]+)', re.I)

    def parse(self, url: str, body: str) -> Iterable[Record]:
        if "/catalog/category/" in url:
            yield from self._parse_category(url, body)
        elif "/catalog/" in url:
            yield from self._parse_product(url, body)

    def _parse_category(self, url: str, body: str) -> Iterable[Record]:
        """Emit catalog_index records and queue individual product URLs, tracking category."""
        category_slug = url.rstrip("/").split("/")[-1]
        if not hasattr(self, "_url_category_map"):
            self._url_category_map = {}
        if not hasattr(self, "_discovered_product_urls"):
            self._discovered_product_urls = []

        count = 0
        for m in self._PRODUCT_HREF.finditer(body):
            full_url = self.config.base_url + m.group("path")
            if full_url not in self._url_category_map:
                self._url_category_map[full_url] = category_slug
                self._discovered_product_urls.append(full_url)
                count += 1

        yield Record(
            source="diyfpv_catalog",
            fetched_at="",
            url=url,
            record_type="catalog_index",
            data={"category_slug": category_slug, "discovered": count},
            meta={},
        )

    def _parse_product(self, url: str, body: str) -> Iterable[Record]:
        """Extract product name and per-store price/stock from RSC payload."""
        # Reconstruct RSC payload
        rsc = self._decode_rsc(body)

        # Extract title from <title> tag as fallback name
        title_m = self._TITLE_TAG.search(body)
        page_title = title_m.group(1).strip() if title_m else ""
        # Strip site suffix
        canonical_name = re.sub(r"\s*[|\-–—].*$", "", page_title).strip()

        # Infer category from URL
        category_slug = self._category_from_url(url)
        category = SLUG_TO_FORGE.get(category_slug, category_slug)

        # Parse storeProducts
        stores = self._extract_store_products(rsc)
        if not stores:
            return

        # Use manufacturer-sourced name if available
        for s in stores:
            if s.get("is_manufacturer") and s.get("name"):
                canonical_name = s["name"]
                break

        if not canonical_name:
            return

        prices = [s["price_usd"] for s in stores if s.get("price_usd")]
        min_price = min(prices) if prices else None
        in_stock_count = sum(1 for s in stores if s.get("in_stock"))

        yield Record(
            source="diyfpv_catalog",
            fetched_at="",
            url=url,
            record_type="part",
            data={
                "name": canonical_name,
                "category": category,
                "category_slug": category_slug,
                "min_price_usd": round(min_price / 100, 2) if min_price else None,
                "in_stock_store_count": in_stock_count,
                "total_store_count": len(stores),
                "stores": stores,
            },
            meta={},
        )

    def _decode_rsc(self, body: str) -> str:
        """Join and unescape all __next_f.push payloads."""
        parts = self._RSC_PUSH.findall(body)
        if not parts:
            return body
        joined = "\n".join(parts)
        return joined.replace('\\"', '"').replace("\\\\", "\\").replace("\\n", "\n")

    def _extract_store_products(self, rsc: str) -> list[dict]:
        """Parse the storeProducts JSON array from RSC text."""
        m = self._STORE_PRODUCTS_BLOCK.search(rsc)
        if not m:
            return []
        try:
            raw_list = json.loads(m.group(1))
        except json.JSONDecodeError:
            return []

        stores = []
        for item in raw_list:
            store_info = item.get("store") or {}
            stores.append({
                "name": self._decode_html(item.get("name", "")),
                "store_name": store_info.get("name", ""),
                "store_slug": store_info.get("slug", ""),
                "store_url": store_info.get("url", ""),
                "region": store_info.get("region", ""),
                "is_manufacturer": bool(store_info.get("isManufacturer")),
                "manufacturer_title": store_info.get("manufacturerTitle"),
                "price_usd": item.get("price"),        # cents
                "local_price": item.get("storePrice"),  # local currency cents
                "local_currency": store_info.get("baseCurrency", "USD"),
                "in_stock": bool(item.get("stock")),
                "buy_url": item.get("url", ""),
            })
        return stores

    def _category_from_url(self, url: str) -> str:
        """
        Infer category slug from product URL by checking which category page
        it was discovered from (stored in _url_to_category), or return empty.
        """
        return getattr(self, "_url_category_map", {}).get(url, "")

    @staticmethod
    def _decode_html(s: str) -> str:
        return (s
                .replace("&amp;", "&").replace("&lt;", "<")
                .replace("&gt;", ">").replace("&quot;", '"')
                .replace("&#39;", "'").replace("×", "x"))

    def is_relevant(self, record: Record) -> bool:
        if record.record_type == "catalog_index":
            return True
        if record.record_type != "part":
            return True
        name = (record.data.get("name") or "").strip()
        if len(name) < 4:
            return False
        if not record.data.get("stores"):
            return False
        return True


if __name__ == "__main__":
    import argparse, logging
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    ap = argparse.ArgumentParser(description="DIYFPV catalog miner")
    ap.add_argument("--max", type=int, default=30)
    ap.add_argument("--category", choices=CATEGORY_SLUGS,
                    help="Mine only this category")
    args = ap.parse_args()

    miner = DiyfpvCatalogMiner(DiyfpvCatalogMiner.default_config())
    if args.category:
        miner._discovered_product_urls = []
        miner._url_category_map = {}
        cfg = miner.config
        body = miner.fetch(f"{cfg.base_url}/catalog/category/{args.category}")
        if body:
            list(miner.parse(f"{cfg.base_url}/catalog/category/{args.category}", body))
        records = miner.run(max_records=args.max)
    else:
        records = miner.run(max_records=args.max)

    parts = [r for r in records if r.record_type == "part"]
    print(f"\n{len(parts)} part records:")
    for p in parts[:10]:
        d = p.data
        price = f"${d['min_price_usd']:.2f}" if d['min_price_usd'] else "N/A"
        print(f"  [{d['category']:<20}] {d['name'][:50]:<50} {price:>8}  "
              f"{d['in_stock_store_count']}/{d['total_store_count']} stores")
