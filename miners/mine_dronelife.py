#!/usr/bin/env python3
"""
mine_dronelife.py — Scrape dronelife.com AND thedefensepost.com for drone industry
funding, contracts, and regulatory news.
Outputs structured data for forge_intel.json.

Sources:
  - dronelife.com       → Funding, contracts, regulatory news
  - thedefensepost.com  → Defense contracts, military UAS procurement, DoD programs
"""

import json
import re
import sys
import os
from urllib.request import urlopen, Request
from html.parser import HTMLParser

# ---------------------------------------------------------------------------
# SOURCE CONFIGURATION
# ---------------------------------------------------------------------------

DRONELIFE_URLS = [
    "https://dronelife.com/category/drone-business/",
    "https://dronelife.com/category/drone-regulation/",
    "https://dronelife.com/news/",
]

DEFENSEPOST_URLS = [
    "https://thedefensepost.com/tag/drones/",
    "https://thedefensepost.com/tag/government-contracts/",
    "https://thedefensepost.com/tag/us-army/",
]

# Paginate DefensePost — append /page/N/ for deeper scrapes
DEFENSEPOST_MAX_PAGES = 3  # pages 1-3 per tag

# ---------------------------------------------------------------------------
# KEYWORD CLASSIFIERS
# ---------------------------------------------------------------------------

FUNDING_KEYWORDS = [
    'raises', 'raised', 'funding', 'series a', 'series b', 'series c',
    'series d', 'series e', 'series f', 'seed round', 'ipo', 'valuation',
    'investment', 'million', 'billion', 'venture', 'capital',
    'funding round', 'financing', 'investors', 'backed',
]

CONTRACT_KEYWORDS = [
    'contract', 'awarded', 'award', 'procurement', 'dod', 'army', 'navy',
    'air force', 'defense', 'defence', 'military', 'replicator', 'blue uas',
    'ndaa', 'sbir', 'pentagon', 'jiatf', 'socom', 'diu', 'darpa',
    'marketplace', 'acquisition', 'usaf', 'marines', 'nato',
]

REGULATORY_KEYWORDS = [
    'faa', 'fcc', 'bvlos', 'remote id', 'regulation', 'legislation', 'act',
    'mandate', 'ruling', 'authorization', 'waiver', 'safer skies',
    'covered list',
]

# DefensePost articles often match CONTRACT_KEYWORDS by default —
# boost classification confidence with these secondary signals
DEFENSEPOST_DEFENSE_KEYWORDS = [
    'drone', 'uas', 'uav', 'unmanned', 'counter-drone', 'c-uas', 'loitering',
    'munition', 'fpv', 'quadcopter', 'small uas', 'suas', 'Group 1', 'Group 2',
    'Group 3', 'reconnaissance', 'isr',
]

# ---------------------------------------------------------------------------
# HTML PARSERS
# ---------------------------------------------------------------------------

class DroneLifeParser(HTMLParser):
    """Extract article links and titles from DRONELIFE listing pages.
    Structure: <h2 class="entry-title"><a href="...">Title</a></h2>
    """
    def __init__(self):
        super().__init__()
        self.articles = []
        self._in_title = False
        self._current = None

    def handle_starttag(self, tag, attrs):
        attrs_d = dict(attrs)
        if tag in ('h2', 'h3') and any(c in attrs_d.get('class', '') for c in ('entry-title', 'gb-block-post-grid-title')):
            self._in_title = True
        if self._in_title and tag == 'a' and attrs_d.get('href'):
            self._current = {'url': attrs_d['href'], 'title': ''}

    def handle_data(self, data):
        if self._in_title and self._current is not None:
            self._current['title'] += data.strip()

    def handle_endtag(self, tag):
        if tag in ('h2', 'h3') and self._in_title:
            self._in_title = False
            if self._current and self._current['title']:
                self.articles.append(self._current)
            self._current = None


class DefensePostParser(HTMLParser):
    """Extract article links and titles from TheDefensePost listing pages.
    Structure: <h2 class="post-title"><a href="...">Title</a></h2>
    Also catches: <h3> inside article-card divs, and standard WP entry-title.
    """
    def __init__(self):
        super().__init__()
        self.articles = []
        self._in_heading = False
        self._in_link = False
        self._current = None
        self._seen_urls = set()

    def handle_starttag(self, tag, attrs):
        attrs_d = dict(attrs)
        cls = attrs_d.get('class', '')

        # Match h2/h3 with common WP title classes
        if tag in ('h2', 'h3') and any(k in cls for k in ('post-title', 'entry-title', 'post-box-title')):
            self._in_heading = True

        # Also match any <a> inside an <article> tag that looks like a post link
        if self._in_heading and tag == 'a' and attrs_d.get('href', '').startswith('https://thedefensepost.com/'):
            url = attrs_d['href']
            if url not in self._seen_urls:
                self._current = {'url': url, 'title': ''}
                self._in_link = True

    def handle_data(self, data):
        if self._in_link and self._current is not None:
            self._current['title'] += data.strip()

    def handle_endtag(self, tag):
        if tag == 'a' and self._in_link:
            self._in_link = False
        if tag in ('h2', 'h3') and self._in_heading:
            self._in_heading = False
            if self._current and self._current['title']:
                self._seen_urls.add(self._current['url'])
                self.articles.append(self._current)
            self._current = None


# ---------------------------------------------------------------------------
# NETWORK
# ---------------------------------------------------------------------------

def fetch_page(url, timeout=15):
    """Fetch a URL and return the HTML as string."""
    req = Request(url, headers={'User-Agent': 'Forge-Intel-Miner/1.0'})
    try:
        with urlopen(req, timeout=timeout) as resp:
            return resp.read().decode('utf-8', errors='replace')
    except Exception as e:
        print(f"  WARN: Failed to fetch {url}: {e}", file=sys.stderr)
        return ''


# ---------------------------------------------------------------------------
# CLASSIFICATION
# ---------------------------------------------------------------------------

def classify_article(title, source='dronelife.com'):
    """Classify an article title into funding, contract, regulatory, or skip."""
    title_lower = title.lower()

    if any(kw in title_lower for kw in FUNDING_KEYWORDS):
        return 'funding'
    if any(kw in title_lower for kw in CONTRACT_KEYWORDS):
        return 'contract'
    if any(kw in title_lower for kw in REGULATORY_KEYWORDS):
        return 'regulatory'

    # DefensePost bonus: if it's from their drones tag and mentions UAS terms,
    # classify as contract/defense even without explicit contract keywords
    if source == 'thedefensepost.com':
        if any(kw in title_lower for kw in DEFENSEPOST_DEFENSE_KEYWORDS):
            return 'contract'

    return None


def extract_amount(title):
    """Try to extract a dollar/euro amount from a title."""
    patterns = [
        r'\$(\d+(?:\.\d+)?)\s*[- ]?(billion|million|B|M)',
        r'(\d+(?:\.\d+)?)\s*[- ]?(billion|million|B|M)\s*(?:dollar|usd)',
        r'€(\d+(?:\.\d+)?)\s*[- ]?(billion|million|B|M)',
        r'EUR\s*(\d+(?:\.\d+)?)\s*[- ]?(billion|million|B|M)',
        r'SEK\s*(\d+(?:\.\d+)?)\s*[- ]?(billion|million|B|M)',
        r'CAD\s*(\d+(?:\.\d+)?)\s*[- ]?(billion|million|B|M)',
        r'£(\d+(?:\.\d+)?)\s*[- ]?(billion|million|B|M)',
    ]
    for pat in patterns:
        m = re.search(pat, title, re.IGNORECASE)
        if m:
            num = m.group(1)
            unit = m.group(2).upper()
            if unit in ('BILLION', 'B'):
                return f"${num}B"
            return f"${num}M"
    return None


def extract_date_from_url(url):
    """Try to pull YYYY-MM-DD or YYYY from a URL path like /2026/03/26/slug."""
    m = re.search(r'/(\d{4})/(\d{2})/(\d{2})/', url)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = re.search(r'/(\d{4})/', url)
    if m:
        return m.group(1)
    return '2026'


# ---------------------------------------------------------------------------
# MINERS
# ---------------------------------------------------------------------------

def mine_dronelife():
    """Scrape DRONELIFE listing pages for article links, classify them."""
    all_articles = []

    for url in DRONELIFE_URLS:
        print(f"  Fetching {url}")
        html = fetch_page(url)
        if not html:
            continue

        parser = DroneLifeParser()
        parser.feed(html)

        for article in parser.articles:
            category = classify_article(article['title'], source='dronelife.com')
            if category:
                article['category'] = category
                article['amount'] = extract_amount(article['title'])
                article['source'] = 'dronelife.com'
                article['date'] = extract_date_from_url(article['url'])
                all_articles.append(article)

    print(f"  DroneLife: {len(all_articles)} classified articles")
    return all_articles


def mine_defensepost():
    """Scrape TheDefensePost tag pages for article links, classify them."""
    all_articles = []
    seen_urls = set()

    for base_url in DEFENSEPOST_URLS:
        for page in range(1, DEFENSEPOST_MAX_PAGES + 1):
            url = base_url if page == 1 else f"{base_url}page/{page}/"
            print(f"  Fetching {url}")
            html = fetch_page(url)
            if not html:
                continue

            parser = DefensePostParser()
            parser.feed(html)

            for article in parser.articles:
                if article['url'] in seen_urls:
                    continue
                seen_urls.add(article['url'])

                category = classify_article(article['title'], source='thedefensepost.com')
                if category:
                    article['category'] = category
                    article['amount'] = extract_amount(article['title'])
                    article['source'] = 'thedefensepost.com'
                    article['date'] = extract_date_from_url(article['url'])
                    all_articles.append(article)

    print(f"  DefensePost: {len(all_articles)} classified articles")
    return all_articles


def mine_all_sources():
    """Run all news/intel source miners and return combined article list."""
    articles = []
    articles.extend(mine_dronelife())
    articles.extend(mine_defensepost())
    print(f"\n  Total classified articles: {len(articles)}")
    return articles


# ---------------------------------------------------------------------------
# INTEL CONVERSION
# ---------------------------------------------------------------------------

def articles_to_intel(articles):
    """Convert classified articles into forge_intel.json format entries."""
    funding = []
    contracts = []
    regulatory = []

    for a in articles:
        if a['category'] == 'funding':
            funding.append({
                'company': _extract_company(a['title']),
                'amount': a.get('amount', 'Undisclosed'),
                'date': a.get('date', '2026'),
                'type': _guess_round_type(a['title']),
                'sector': 'UAS',
                'source': a['source'],
                'note': a['title'],
                'url': a['url'],
            })
        elif a['category'] == 'contract':
            contracts.append({
                'program': a['title'][:80],
                'awardee': _extract_company(a['title']),
                'value': a.get('amount', 'Undisclosed'),
                'date': a.get('date', '2026'),
                'type': _guess_contract_type(a['title']),
                'source': a['source'],
                'note': a['title'],
                'url': a['url'],
            })
        elif a['category'] == 'regulatory':
            regulatory.append({
                'program': a['title'][:80],
                'date': a.get('date', '2026'),
                'type': 'Regulatory',
                'source': a['source'],
                'note': a['title'],
                'url': a['url'],
            })

    return funding, contracts, regulatory


# ---------------------------------------------------------------------------
# HELPERS
# ---------------------------------------------------------------------------

def _extract_company(title):
    """Best-effort company name extraction from article title."""
    # Common patterns: "Company raises $XM", "Company awarded contract"
    words = title.split()
    company_words = []
    skip = {'the', 'a', 'an', 'new', 'first', 'latest', 'recent', 'why', 'how',
            'us', 'u.s.', 'army', 'navy', 'dod', 'pentagon'}
    for w in words:
        if w[0:1].isupper() and w.lower() not in skip:
            company_words.append(w)
        elif company_words:
            break
    return ' '.join(company_words) if company_words else title[:30]


def _guess_round_type(title):
    """Guess funding round type from title."""
    t = title.lower()
    for series in ['series f', 'series e', 'series d', 'series c', 'series b', 'series a']:
        if series in t:
            return series.title()
    if 'seed' in t: return 'Seed'
    if 'ipo' in t: return 'IPO'
    return 'Funding'


def _guess_contract_type(title):
    """Guess contract type from title."""
    t = title.lower()
    if 'counter' in t or 'c-uas' in t or 'cuas' in t: return 'C-UAS'
    if 'replicator' in t: return 'Replicator'
    if 'sbir' in t: return 'SBIR'
    if 'delivery' in t or 'logistics' in t: return 'Logistics'
    if 'mapping' in t or 'survey' in t: return 'Mapping'
    if 'marketplace' in t or 'acquisition' in t: return 'Acquisition'
    if 'reconnaissance' in t or 'isr' in t: return 'ISR'
    if 'interceptor' in t or 'counter' in t: return 'C-UAS'
    if 'training' in t: return 'Training'
    return 'Defense'


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Mine DroneLife + DefensePost for intel')
    parser.add_argument('--source', choices=['all', 'dronelife', 'defensepost'], default='all',
                        help='Which source(s) to mine')
    parser.add_argument('--pages', type=int, default=DEFENSEPOST_MAX_PAGES,
                        help='Max pages to scrape per DefensePost tag (default: 3)')
    parser.add_argument('--json', action='store_true',
                        help='Output raw JSON to stdout (for piping)')
    args = parser.parse_args()

    DEFENSEPOST_MAX_PAGES = args.pages

    print("=" * 50)
    print("INTEL MINER — DroneLife + TheDefensePost")
    print("=" * 50)

    if args.source == 'dronelife':
        articles = mine_dronelife()
    elif args.source == 'defensepost':
        articles = mine_defensepost()
    else:
        articles = mine_all_sources()

    funding, contracts, regulatory = articles_to_intel(articles)

    print(f"\nResults:")
    print(f"  Funding:    {len(funding)}")
    print(f"  Contracts:  {len(contracts)}")
    print(f"  Regulatory: {len(regulatory)}")
    print(f"  Total:      {len(funding) + len(contracts) + len(regulatory)}")

    if args.json:
        result = {'funding': funding, 'contracts': contracts, 'regulatory': regulatory}
        print(json.dumps(result, indent=2))
    else:
        # Print summary table
        print(f"\n{'='*70}")
        print(f"{'Type':<12} {'Source':<22} {'Title':<36}")
        print(f"{'-'*70}")
        for a in articles[:30]:
            print(f"{a['category']:<12} {a['source']:<22} {a['title'][:36]}")
        if len(articles) > 30:
            print(f"  ... and {len(articles) - 30} more")
