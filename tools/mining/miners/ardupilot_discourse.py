"""
ArduPilot Discourse forum miner.

Target: https://discuss.ardupilot.org

Why it matters: the ArduPilot community is dominated by professional integrators
(survey, ag, industrial inspection, research, defense). Post volume on specific
hardware is a near-perfect proxy for "what serious PX4/ArduPilot integrators
actually use in the field". RotorBuilds covers Betaflight; this covers
ArduPilot/PX4 — the other half of the pro ecosystem.

Legal note: Discourse has a public JSON API with proper pagination. No
scraping required. Every board exposes /latest.json, /top.json, /tags.json
and threads expose /<slug>/<id>.json. This is a sanctioned data path — use it
instead of HTML scraping.

What we take:
  - Thread counts keyed by hardware tag (cube-orange, pixhawk, matek-h743, etc.)
  - Co-mention pairs (threads that mention FC X and GPS Y are a positive
    compatibility signal)
  - Solved-thread text for Wingman troubleshooting KB (transform-only)
  - Accepted-answer posts only, never user-posted photos

Status: SCAFFOLD. Fill in when you're ready to extend beyond RotorBuilds.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from mining.lib.base_miner import BaseMiner, MinerConfig, Record  # noqa: E402


class ArduPilotDiscourseMiner(BaseMiner):
    """
    Uses Discourse's public JSON endpoints. No HTML parsing needed.

    Rate: Discourse default is 60 req/min/IP. Stay at 1 req/sec to be polite.
    """

    @classmethod
    def default_config(cls) -> MinerConfig:
        return MinerConfig(
            source_name="ardupilot_discourse",
            base_url="https://discuss.ardupilot.org",
            min_request_interval_sec=1.5,
            user_agent="ForgeMinerBot/0.1 (+https://forgeprole.netlify.app; research@droneclear.ai)",
            respect_robots=True,
        )

    def targets(self) -> Iterable[str]:
        """
        Discourse JSON endpoints we care about:
          - /tags.json → the full tag registry (hardware model tags)
          - /tag/<slug>.json → threads per hardware tag
          - /latest.json → firehose of recent activity (useful for co-mention)

        Start with hardware tags. Each tag maps cleanly to a part in Forge's DB.
        """
        # Tag registry — tells us which hardware tags exist and their thread counts
        yield f"{self.config.base_url}/tags.json"

        # ── Flight Controllers ──────────────────────────────────────────────
        # CubePilot / ProfiCNC
        fc_tags = [
            "cube-orange", "cube-orange-plus", "cube-black", "cube-yellow",
            "cube-purple", "cubepilot", "here3", "here4",
            # Pixhawk ecosystem
            "pixhawk-6x", "pixhawk-6c", "pixhawk-6c-mini", "pixhawk-5x",
            "pixhawk-4", "pixhawk-4-mini", "pixhawk", "fmuv6x",
            # Holybro
            "holybro-durandal", "holybro-kakute-h7", "holybro-kakute-f7",
            "kakuteh7", "kakutef7",
            # Matek
            "matek-h743", "matek-h743-slim", "matek-f405", "matek-f765",
            "matek-h7", "matek",
            # mRo
            "mrobotics-mro", "mro-control-zero", "mro-x2-1",
            # ARK Electronics
            "arkv6x", "ark-fc", "ark-electronics",
            # Auterion / Skynode
            "auterion-skynode", "skynode",
            # Others
            "px4-vision", "px4-vision-v1-1", "nxp-hovergames",
            "omnibusf4", "speedybee-f405",
        ]

        # ── GPS / GNSS ──────────────────────────────────────────────────────
        gps_tags = [
            "here3", "here4", "ardupilot-herelink", "herelink",
            "matek-m9n", "matek-sam-m10q",
            "f9p", "zed-f9p", "ublox-f9p", "rtk",
            "ark-gps", "cuav-neo-3",
        ]

        # ── ESCs ────────────────────────────────────────────────────────────
        esc_tags = [
            "blheli32", "blheli-32", "am32", "kiss-esc",
            "zubax-myxa", "myxa", "kotleta20",
            "iflight-blitz", "flame-60a",
        ]

        # ── Companion Computers / SBCs ──────────────────────────────────────
        companion_tags = [
            "raspberry-pi", "rpi4", "rpi5", "jetson-nano", "jetson-orin",
            "nvidia-jetson", "modalai-voxl", "voxl2", "voxl-2",
            "orange-pi", "radxa-rock",
        ]

        # ── Cameras / Payloads ──────────────────────────────────────────────
        camera_tags = [
            "flir-boson", "boson", "lepton", "tau2",
            "sony-imx", "herelink-camera",
            "siyi", "siyi-a8", "siyi-zr10",
            "caddx", "runcam",
        ]

        # ── RC Links / Datalinks ────────────────────────────────────────────
        rc_tags = [
            "herelink", "ardupilot-herelink",
            "expresslrs", "elrs",
            "crossfire", "tbs-crossfire",
            "sik-radio", "rfdesign", "rfd900",
            "doodle-labs", "silvus",
        ]

        # ── Airframes ───────────────────────────────────────────────────────
        airframe_tags = [
            "hexsoon", "tarot", "x500", "s500",
            "vtol", "quadplane", "tiltrotor",
            "fixed-wing", "flying-wing",
            "traditional-helicopter", "heli",
            "boat", "rover", "ardurover", "arduboat",
            "sub", "blimp",
        ]

        # Yield all tags
        all_tags = (fc_tags + gps_tags + esc_tags + companion_tags +
                    camera_tags + rc_tags + airframe_tags)
        # Deduplicate preserving order
        seen = set()
        for slug in all_tags:
            if slug not in seen:
                seen.add(slug)
                yield f"{self.config.base_url}/tag/{slug}.json"

    def parse(self, url: str, body: str) -> Iterable[Record]:
        """
        Parse Discourse JSON. Emit one Record per thread with:
          - thread id, tags, category, posts_count
          - first-post excerpt (NOT full text — transform-only)
          - accepted-answer excerpt if present
        """
        try:
            j = json.loads(body)
        except json.JSONDecodeError:
            self.log.warning(f"not JSON: {url}")
            return

        # /tags.json  → list tag metadata, emit a single tag-registry record
        if url.endswith("/tags.json"):
            tags = j.get("tags", [])
            yield Record(
                source="ardupilot_discourse",
                fetched_at="",
                url=url,
                record_type="tag_registry",
                data={"tag_count": len(tags), "tags": [t.get("id") or t.get("name") for t in tags]},
                meta={},
            )
            return

        # /tag/<slug>.json  → topic_list.topics
        topics = j.get("topic_list", {}).get("topics", [])
        for t in topics:
            yield Record(
                source="ardupilot_discourse",
                fetched_at="",
                url=f"{self.config.base_url}/t/{t.get('slug')}/{t.get('id')}",
                record_type="thread",
                data={
                    "id": t.get("id"),
                    "slug": t.get("slug"),
                    "title": t.get("title"),
                    "tags": t.get("tags", []),
                    "posts_count": t.get("posts_count", 0),
                    "views": t.get("views", 0),
                    "accepted_answer": bool(t.get("has_accepted_answer")),
                    "last_posted_at": t.get("last_posted_at"),
                },
                meta={"source_tag_page": url},
            )

    def is_relevant(self, record: Record) -> bool:
        # ArduPilot forum is already professional-heavy. Keep everything with
        # at least 2 posts (signal that someone responded) OR accepted-answer.
        if record.record_type != "thread":
            return True
        return bool(record.data.get("posts_count", 0) >= 2 or record.data.get("accepted_answer"))


if __name__ == "__main__":
    import logging
    logging.basicConfig(level=logging.INFO)
    ArduPilotDiscourseMiner(ArduPilotDiscourseMiner.default_config()).run(max_records=50)
