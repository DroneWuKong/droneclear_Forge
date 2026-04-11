"""
DIU Blue UAS Cleared List + Blue UAS Framework miner.

Target: https://www.diu.mil/blue-uas
        https://bluelist.dcma.mil  (DCMA transitioned from DIU 2025-07-10)

This is an OFFICIAL, FREE, GOVERNMENT-PUBLISHED registry of NDAA-compliant
drone platforms and components. Highest-authority source we have.

Why it matters: every entry on these lists is a positive compliance
observation — "this airframe / this FC / this radio is cleared for federal
procurement". Critical for:
  - Auto-flagging parts in forge_database.json as Blue UAS eligible
  - Cross-checking manufacturer_status.json entries
  - Feeding the /compliance/ dashboard with ground truth

Legal stance: this is US Government work product in the public domain —
mining it is explicitly permitted. No ToS concerns.

Status: SCAFFOLD. The DIU/DCMA pages render via JS in places, so may need
Playwright instead of plain requests. Start with the static HTML and fall
back if needed.
"""

from __future__ import annotations

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
            base_url="https://www.diu.mil",
            min_request_interval_sec=1.0,  # gov site — polite but not excessive
            user_agent="ForgeMinerBot/0.1 (+https://forgeprole.netlify.app; research@droneclear.ai)",
            respect_robots=True,
        )

    def targets(self) -> Iterable[str]:
        yield "https://www.diu.mil/blue-uas"
        yield "https://www.diu.mil/blue-uas-cleared-list"
        yield "https://bluelist.dcma.mil"
        # Framework components have their own pages — TBD from live DOM

    def parse(self, url: str, body: str) -> Iterable[Record]:
        """
        Extract:
          - cleared platforms (name, vendor, cleared date, category)
          - framework components (name, vendor, role, status)

        TODO: inspect DOM. DIU historically uses a Webflow site — content is
        in <div class="collection-item"> blocks or similar. DCMA's new site
        may be different. Save a cache of the page first, then build selectors.
        """
        yield Record(
            source="blue_uas",
            fetched_at="",
            url=url,
            record_type="blue_uas_page",
            data={
                "page_bytes": len(body),
                "platforms": [],  # TODO
                "framework_components": [],  # TODO
            },
            meta={"SCAFFOLD": True},
        )


if __name__ == "__main__":
    import logging
    logging.basicConfig(level=logging.INFO)
    BlueUASMiner(BlueUASMiner.default_config()).run(max_records=10)
