"""
SAM.gov drone RFP / procurement miner.

Target: https://api.sam.gov/opportunities/v2/search

Why it matters: SAM.gov is the federal contract opportunity firehose.
Mining current drone solicitations gives Forge real-time signal on:
  - Which agencies are actively buying drones
  - Which specific platforms get named in sole-source justifications
  - Which NDAA-compliant vendors are winning awards
  - Which program offices are the buyers (DIU, AFWERX, SOCOM, Army FoS)

US Government public domain data with a sanctioned public API.
Requires free SAM_GOV_API_KEY from api.sam.gov.

Status: PRODUCTION-READY. Awaiting SAM_GOV_API_KEY in Ai-Project secrets.
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
    SAM.gov Opportunities API.
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

    # Deduplicate across keyword queries within a single run
    _seen: set = set()

    # Search keywords — ordered roughly by signal quality
    UAS_KEYWORDS = [
        # High-signal defense programs
        "Blue UAS", "Drone Dominance Program", "DDP drone",
        "NDAA 848", "section 848 drone", "ASDA drone",
        # Platform types
        "unmanned aircraft system", "unmanned aerial system",
        "small UAS", "sUAS", "Group 1 UAS", "Group 2 UAS",
        "quadcopter", "FPV drone", "loitering munition",
        # DFR / public safety
        "drone as first responder", "BVLOS drone", "drone in a box",
        # General
        "drone", "UAV",
    ]

    def targets(self) -> Iterable[str]:
        key = os.environ.get("SAM_GOV_API_KEY", "")
        if not key:
            self.log.warning("SAM_GOV_API_KEY not set — skipping sam.gov miner")
            return

        from datetime import datetime, timedelta
        end   = datetime.utcnow().strftime("%m/%d/%Y")
        start = (datetime.utcnow() - timedelta(days=60)).strftime("%m/%d/%Y")

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

        total = j.get("totalRecords", 0)
        self.log.debug(f"SAM.gov: {total} total for {url.split('q=')[1].split('&')[0]}")

        for opp in j.get("opportunitiesData", []):
            notice_id = opp.get("noticeId") or opp.get("id", "")
            if not notice_id or notice_id in self._seen:
                continue
            self._seen.add(notice_id)

            award = opp.get("award") or {}
            yield Record(
                source="sam_gov",
                fetched_at="",
                url=opp.get("uiLink", f"https://sam.gov/opp/{notice_id}/view"),
                record_type="federal_opportunity",
                data={
                    "notice_id": notice_id,
                    "title": opp.get("title", ""),
                    "agency": opp.get("fullParentPathName", ""),
                    "sub_agency": opp.get("department", ""),
                    "office": opp.get("office", ""),
                    "posted": opp.get("postedDate", ""),
                    "response_deadline": opp.get("responseDeadLine", ""),
                    "naics": opp.get("naicsCode", ""),
                    "set_aside": opp.get("typeOfSetAside", ""),
                    "type": opp.get("type", ""),
                    "synopsis_len": len(opp.get("description") or ""),
                    "award_amount": award.get("amount"),
                    "awardee": (award.get("awardee") or {}).get("name"),
                    "award_date": award.get("date"),
                },
                meta={"matched_query": url.split("q=")[1].split("&")[0] if "q=" in url else url},
            )

    def is_relevant(self, record: Record) -> bool:
        """
        Title-level relevance filter — SAM.gov keyword search is broad
        and returns many false positives (e.g. 'drone' matches 'drone testing
        for unrelated equipment' in agency descriptions).
        """
        title = (record.data.get("title") or "").lower()
        if not title:
            return False
        signal_terms = {
            "drone", "uas", "unmanned", "aerial vehicle", "fpv",
            "bvlos", "loitering", "quadcopter", "uav", "suas",
            "blue uas", "ndaa 848", "first responder drone",
        }
        return any(t in title for t in signal_terms)


if __name__ == "__main__":
    import logging
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    SamGovMiner(SamGovMiner.default_config()).run(max_records=50)
