"""
Base miner class for Forge data-mining framework.

All miners inherit from BaseMiner. Responsibilities:
- Respect per-source rate limits
- Cache responses to disk (avoid re-fetching on dev iterations)
- Emit structured records to the output/ directory
- Surface their own robots.txt policy decisions
- Never write directly to forge_database.json or other Forge data files —
  that's the job of normalizers/ which consume raw/ output

Legal stance (see tools/mining/README.md for full text):
- Aggregate/derived signal extraction is fair use (hiQ v. LinkedIn).
- Mirror / verbatim republishing of user-generated content is NOT.
- robots.txt is respected as a liability shield, not a moral authority.
- Rate limits are set to stay below anti-bot triggers.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable, Optional
from urllib.parse import urlparse

try:
    import requests
except ImportError:
    raise RuntimeError("pip install -r tools/mining/requirements.txt")

try:
    from urllib import robotparser
except ImportError:
    robotparser = None


# -------------------- config dataclasses --------------------

@dataclass
class MinerConfig:
    """Per-miner runtime config. Override defaults in each miner subclass."""
    source_name: str
    base_url: str
    # Seconds between requests. Real-world bar for "polite" scraping.
    min_request_interval_sec: float = 2.5
    # Default user-agent. Honest — identifies us as a bot with a contact.
    user_agent: str = "ForgeMinerBot/0.1 (+https://forgeprole.netlify.app/about) research"
    # Cache raw responses to disk to avoid re-hitting remote on dev reruns.
    cache_dir: Path = field(default_factory=lambda: Path("tools/mining/output/.cache"))
    # Output raw records before normalization.
    raw_dir: Path = field(default_factory=lambda: Path("tools/mining/output/raw"))
    # HTTP timeout per request.
    timeout_sec: int = 20
    # Max retries on transient errors (5xx, connection reset). Never on 403/401.
    max_retries: int = 3
    # Respect robots.txt. Set False only with explicit operator override.
    respect_robots: bool = True
    # If robots blocks us, this is what we do: 'skip' (log + exit) or 'abort' (raise)
    robots_block_behavior: str = "skip"


@dataclass
class Record:
    """A single raw record emitted by a miner. Normalizers consume these."""
    source: str
    fetched_at: str  # ISO 8601
    url: str
    record_type: str  # e.g. 'build', 'part', 'rfp', 'thread'
    data: dict  # whatever the miner extracted, free-form
    meta: dict = field(default_factory=dict)  # dedup keys, confidence, notes


# -------------------- base class --------------------

class BaseMiner(ABC):
    def __init__(self, config: MinerConfig):
        self.config = config
        self.log = logging.getLogger(f"miner.{config.source_name}")
        self._last_request_time: float = 0.0
        self._robots: Optional[robotparser.RobotFileParser] = None
        self.config.cache_dir.mkdir(parents=True, exist_ok=True)
        self.config.raw_dir.mkdir(parents=True, exist_ok=True)

    # -------- subclasses implement these --------

    @abstractmethod
    def targets(self) -> Iterable[str]:
        """Yield URLs to fetch. May be finite or infinite."""
        raise NotImplementedError

    @abstractmethod
    def parse(self, url: str, body: str) -> Iterable[Record]:
        """Parse a fetched body into zero or more records."""
        raise NotImplementedError

    def is_relevant(self, record: Record) -> bool:
        """
        Filter hook — subclasses override to drop records that don't match
        the professional-audience scope. Default: keep all records.

        Forge-wide convention: this method is where the hobby/pro filter lives.
        A RotorBuilds miner should reject 5"/race/whoop/freestyle here.
        """
        return True

    # -------- framework plumbing --------

    def _check_robots(self, url: str) -> bool:
        if not self.config.respect_robots:
            return True
        if self._robots is None:
            self._robots = robotparser.RobotFileParser()
            parsed = urlparse(self.config.base_url)
            robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
            try:
                self._robots.set_url(robots_url)
                self._robots.read()
                self.log.info(f"robots.txt loaded from {robots_url}")
            except Exception as e:
                self.log.warning(f"robots.txt fetch failed ({e}); assuming allow")
                return True
        allowed = self._robots.can_fetch(self.config.user_agent, url)
        if not allowed:
            if self.config.robots_block_behavior == "abort":
                raise PermissionError(f"robots.txt disallows {url}")
            self.log.warning(f"robots.txt disallows {url} — skipping")
        return allowed

    def _rate_limit(self):
        now = time.monotonic()
        elapsed = now - self._last_request_time
        if elapsed < self.config.min_request_interval_sec:
            sleep_for = self.config.min_request_interval_sec - elapsed
            time.sleep(sleep_for)
        self._last_request_time = time.monotonic()

    def _cache_path(self, url: str) -> Path:
        h = hashlib.sha1(url.encode("utf-8")).hexdigest()
        return self.config.cache_dir / f"{self.config.source_name}-{h}.html"

    def fetch(self, url: str, force: bool = False) -> Optional[str]:
        """Fetch URL with cache + rate limit + robots check. Returns body or None."""
        if not self._check_robots(url):
            return None

        cache = self._cache_path(url)
        if cache.exists() and not force:
            return cache.read_text(encoding="utf-8", errors="replace")

        headers = {"User-Agent": self.config.user_agent, "Accept": "text/html,application/json,*/*"}
        for attempt in range(self.config.max_retries):
            try:
                self._rate_limit()
                r = requests.get(url, headers=headers, timeout=self.config.timeout_sec)
                if r.status_code == 200:
                    cache.write_text(r.text, encoding="utf-8")
                    return r.text
                if r.status_code in (401, 403, 404):
                    # Not transient — don't retry.
                    self.log.warning(f"HTTP {r.status_code} on {url}; skipping")
                    return None
                if r.status_code >= 500:
                    # Transient. Backoff.
                    wait = (attempt + 1) * 5
                    self.log.warning(f"HTTP {r.status_code} on {url}; retry in {wait}s")
                    time.sleep(wait)
                    continue
                return None
            except requests.RequestException as e:
                wait = (attempt + 1) * 5
                self.log.warning(f"{type(e).__name__} on {url}: {e}; retry in {wait}s")
                time.sleep(wait)
        return None

    def run(self, max_records: Optional[int] = None) -> list[Record]:
        """
        Main entrypoint. Walks targets(), fetches each, parses, filters, and
        writes raw records to raw_dir/<source>-<timestamp>.jsonl.
        """
        records: list[Record] = []
        out_path = self.config.raw_dir / f"{self.config.source_name}-{datetime.now():%Y%m%d-%H%M%S}.jsonl"
        self.log.info(f"run start → {out_path}")
        with out_path.open("w", encoding="utf-8") as f:
            for url in self.targets():
                if max_records is not None and len(records) >= max_records:
                    self.log.info(f"reached max_records={max_records}; stopping")
                    break
                body = self.fetch(url)
                if not body:
                    continue
                for rec in self.parse(url, body):
                    if not self.is_relevant(rec):
                        continue
                    rec.fetched_at = datetime.now().isoformat()
                    records.append(rec)
                    f.write(json.dumps(asdict(rec)) + "\n")
        self.log.info(f"run complete: {len(records)} records emitted")
        return records
