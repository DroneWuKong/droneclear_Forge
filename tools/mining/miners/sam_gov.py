"""
SAM.gov drone RFP / procurement miner.

Target: https://sam.gov/search (and the public API at sam.gov/api/prod/sgs/v1/search)

Why it matters: SAM.gov is the federal contract opportunity firehose. Mining
current drone solicitations gives Forge a real-time signal on:
  - Which agencies are actively buying drones
  - Which specific platforms get named in sole-source justifications
  - Which NDAA-compliant vendors are winning awards
  - Which program offices are the buyers (DIU, AFWERX, SOCOM, Army FoS, etc.)

This is US Government public domain data with a sanctioned public API — no
legal or ToS concerns. The API requires a free registration key (SAM_GOV_API_KEY).

Status: SCAFFOLD. API shape is known and documented; just needs wiring.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Iterable

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from mining.lib.base_miner import BaseMiner, MinerConfig, Record  # noqa: E402


class SamGovMiner(BaseMiner):
    """
    SAM.gov Opportunities API. Requires SAM_GOV_API_KEY env var.
    Docs: https://open.gsa.gov/api/get-opportunities-public-api/
    """

    @classmethod
    def default_config(cls) -> MinerConfig:
        return MinerConfig(
            source_name="sam_gov",
            base_url="https://api.sam.gov",
            min_request_interval_sec=1.2,
            user_agent="ForgeMinerBot/0.1 (+https://forgeprole.netlify.app; research@droneclear.ai)",
            respect_robots=True,
        )

    # NAICS codes likely to hit drone / UAS procurement.
    # 336411 = aircraft mfg; 334220 = radio / comm equipment; 541715 = R&D
    UAS_NAICS = ["336411", "334220", "541715", "336419"]

    # Keyword hits for opportunity title/description
    UAS_KEYWORDS = [
        "unmanned aircraft", "unmanned aerial", "uas", "sUAS", "quadcopter",
        "drone", "Blue UAS", "small UAS", "group 1 UAS", "group 2 UAS",
        "FPV", "loitering munition", "one-way attack",
    ]

    def targets(self) -> Iterable[str]:
        key = os.environ.get("SAM_GOV_API_KEY", "")
        if not key:
            self.log.warning("SAM_GOV_API_KEY not set — skipping sam.gov miner")
            return
        # Date range — last 30 days of posted opportunities
        from datetime import datetime, timedelta
        end = datetime.utcnow().strftime("%m/%d/%Y")
        start = (datetime.utcnow() - timedelta(days=30)).strftime("%m/%d/%Y")
        for kw in self.UAS_KEYWORDS:
            yield (
                f"{self.config.base_url}/opportunities/v2/search"
                f"?limit=100&postedFrom={start}&postedTo={end}"
                f"&q={kw.replace(' ', '+')}"
                f"&api_key={key}"
            )

    def parse(self, url: str, body: str) -> Iterable[Record]:
        try:
            j = json.loads(body)
        except json.JSONDecodeError:
            self.log.warning(f"not JSON: {url}")
            return
        for opp in j.get("opportunitiesData", []):
            yield Record(
                source="sam_gov",
                fetched_at="",
                url=opp.get("uiLink", url),
                record_type="federal_opportunity",
                data={
                    "notice_id": opp.get("noticeId"),
                    "title": opp.get("title"),
                    "agency": opp.get("fullParentPathName"),
                    "sub_agency": opp.get("department"),
                    "office": opp.get("office"),
                    "posted": opp.get("postedDate"),
                    "response_deadline": opp.get("responseDeadLine"),
                    "naics": opp.get("naicsCode"),
                    "set_aside": opp.get("typeOfSetAside"),
                    "type": opp.get("type"),
                    "synopsis_len": len(opp.get("description") or ""),
                },
                meta={"matched_query": url},
            )


if __name__ == "__main__":
    import logging
    logging.basicConfig(level=logging.INFO)
    SamGovMiner(SamGovMiner.default_config()).run(max_records=20)
