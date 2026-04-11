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

Status: SCAFFOLD — targets() paginates /explore; parse() is stubbed pending
DOM inspection. Run with max_records=25 first; verify DOM selectors before
scaling up.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Iterable

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from mining.lib.base_miner import BaseMiner, MinerConfig, Record  # noqa: E402


# --- quality-gate keywords (NOT category filter) ---------------------

SPAM_MARKERS = {
    # things that suggest a placeholder / test / deleted build
    "test build", "asdf", "untitled", "new build",
    "please delete", "deleted", "removed by",
}


class RotorBuildsMiner(BaseMiner):
    """
    SCAFFOLD. Yields build URLs from /explore pagination, then parses each
    build page into a Record. Filter (is_relevant) is a quality gate only —
    no category exclusion, no size exclusion.
    """

    @classmethod
    def default_config(cls) -> MinerConfig:
        return MinerConfig(
            source_name="rotorbuilds",
            base_url="https://rotorbuilds.com",
            # RotorBuilds returned 403 on initial probe — they have anti-bot.
            # Start SLOW. 4 seconds between requests. Watch for blocks.
            min_request_interval_sec=4.0,
            # Identify ourselves honestly. If they want us to stop, they can ask.
            user_agent="ForgeMinerBot/0.1 (+https://forgeprole.netlify.app; research@droneclear.ai)",
            respect_robots=True,
            robots_block_behavior="skip",
        )

    def targets(self) -> Iterable[str]:
        """
        Yield URLs to fetch.

        Strategy:
          1. Start from /explore (featured builds — curated, higher signal).
          2. Paginate until exhausted or max_records reached.
          3. parse() of index pages emits build_index records that a follow-up
             run can re-enqueue (via _discovered_build_urls, captured in memory).

        Pagination: /explore?page=N. Exact param name and page size need
        verification against the live DOM.
        """
        # Pass 1: the featured-builds index pages. Start with 10 pages of /explore.
        for page in range(1, 11):
            yield f"{self.config.base_url}/explore?page={page}"
        # Pass 2: also pull from /builds (latest builds, higher volume).
        for page in range(1, 11):
            yield f"{self.config.base_url}/builds?page={page}"
        # Pass 3: build pages discovered from index parses this run.
        for url in getattr(self, "_discovered_build_urls", []):
            yield url

    # Regex patterns — placeholders. Actual selectors will need the real DOM.
    _BUILD_URL_RE = re.compile(r'href="(/build/\d+[^"#?]*)"')
    _BUILD_TITLE_RE = re.compile(r"<title>([^<]+)</title>", re.IGNORECASE)
    _PROP_SIZE_RE = re.compile(r"(\d{1,2})\s*(?:inch|in|\")", re.IGNORECASE)

    def parse(self, url: str, body: str) -> Iterable[Record]:
        """
        Parse a fetched body into Records.

        Two modes based on URL shape:
          - index pages (/explore, /builds)  → emit 'build_index' records
          - individual builds (/build/N)      → emit 'build' records with parts

        SCAFFOLD NOTE: the part-list extraction is the core value. It needs
        real DOM inspection to get selectors right. Workflow:
          1. Save one representative build page to output/.cache/
          2. Inspect it to find the part-list container
          3. Walk rows for: category, part name, vendor/retailer, price (if listed)
          4. Emit one sub-record per part plus one summary Record per build
        """
        if "/explore" in url or "/builds" in url:
            discovered = set()
            for build_path in self._BUILD_URL_RE.findall(body):
                full = self.config.base_url + build_path
                if full in discovered:
                    continue
                discovered.add(full)
                yield Record(
                    source="rotorbuilds",
                    fetched_at="",
                    url=full,
                    record_type="build_index",
                    data={"build_url": full},
                    meta={"discovered_from": url},
                )
            # Stash discovered URLs so targets() can re-emit them in pass 3
            if not hasattr(self, "_discovered_build_urls"):
                self._discovered_build_urls = []
            self._discovered_build_urls.extend(discovered)
            return

        if "/build/" in url:
            # TODO: implement real extraction. Placeholder returns a shell
            # with title + prop-size hint so the pipeline can be tested.
            title_m = self._BUILD_TITLE_RE.search(body)
            title = title_m.group(1).strip() if title_m else ""
            size_hint = None
            for m in self._PROP_SIZE_RE.finditer(title + " " + body[:2000]):
                try:
                    size_hint = int(m.group(1))
                    break
                except ValueError:
                    continue
            yield Record(
                source="rotorbuilds",
                fetched_at="",
                url=url,
                record_type="build",
                data={
                    "title": title,
                    "prop_size_inch_hint": size_hint,
                    # TODO — real fields after DOM inspection:
                    "parts": [],       # list of {category, name, vendor, price_usd}
                    "part_count": 0,
                    "tags": [],
                    "description_len": 0,  # length only — never store verbatim text
                },
                meta={"SCAFFOLD": True},
            )
            return

    def is_relevant(self, record: Record) -> bool:
        """
        QUALITY gate only. No category exclusion. See file header for rationale.

        Rules:
          - build_index records always pass (filter downstream on parsed build)
          - build records must have a non-blank title
          - build records must not match spam markers
          - build records must have at least 1 part (once parsed; SCAFFOLD
            currently emits empty lists, so this check is soft for now)
        """
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

        # Soft part-count gate. Once the scaffold is filled in and parts[] is
        # populated, uncomment to require >=3 parts (a real build, not a shell).
        # if record.data.get("part_count", 0) < 3:
        #     return False

        return True


if __name__ == "__main__":
    import logging
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    miner = RotorBuildsMiner(RotorBuildsMiner.default_config())
    # Dry run — cap records so nothing runs away.
    records = miner.run(max_records=25)
    print(f"emitted {len(records)} records")
