#!/usr/bin/env python3
"""
mine_dronelife.py — Scrape dronelife.com for drone industry funding, contracts, and regulatory news.
Outputs structured data for forge_intel.json.
"""

import json
import re
import sys
import os
from urllib.request import urlopen, Request
from html.parser import HTMLParser

DRONELIFE_URLS = [
    "https://dronelife.com/category/drone-business/",
    "https://dronelife.com/category/drone-regulation/",
    "https://dronelife.com/news/",
]

FUNDING_KEYWORDS = [
    'raises', 'raised', 'funding', 'series a', 'series b', 'series c', 'series d', 'series e', 'series f',
    'seed round', 'ipo', 'valuation', 'investment', 'million', 'billion', 'venture', 'capital',
    'funding round', 'financing', 'investors', 'backed',
]

CONTRACT_KEYWORDS = [
    'contract', 'awarded', 'award', 'procurement', 'dod', 'army', 'navy', 'air force',
    'defense', 'defence', 'military', 'replicator', 'blue uas', 'ndaa', 'sbir',
    'pentagon', 'jiatf', 'socom', 'diu', 'darpa',
]

REGULATORY_KEYWORDS = [
    'faa', 'fcc', 'bvlos', 'remote id', 'regulation', 'legislation', 'act', 'mandate',
    'ruling', 'authorization', 'waiver', 'safer skies', 'covered list',
]


class ArticleLinkParser(HTMLParser):
    """Extract article links and titles from DRONELIFE listing pages."""
    def __init__(self):
        super().__init__()
        self.articles = []
        self._in_title = False
        self._current = None

    def handle_starttag(self, tag, attrs):
        attrs_d = dict(attrs)
        if tag == 'h2' and 'entry-title' in attrs_d.get('class', ''):
            self._in_title = True
        if self._in_title and tag == 'a' and attrs_d.get('href'):
            self._current = {'url': attrs_d['href'], 'title': ''}

    def handle_data(self, data):
        if self._in_title and self._current is not None:
            self._current['title'] += data.strip()

    def handle_endtag(self, tag):
        if tag == 'h2' and self._in_title:
            self._in_title = False
            if self._current and self._current['title']:
                self.articles.append(self._current)
            self._current = None


def fetch_page(url, timeout=15):
    """Fetch a URL and return the HTML as string."""
    req = Request(url, headers={'User-Agent': 'Forge-Intel-Miner/1.0'})
    try:
        with urlopen(req, timeout=timeout) as resp:
            return resp.read().decode('utf-8', errors='replace')
    except Exception as e:
        print(f"  WARN: Failed to fetch {url}: {e}", file=sys.stderr)
        return ''


def classify_article(title):
    """Classify an article title into funding, contract, regulatory, or skip."""
    title_lower = title.lower()
    
    if any(kw in title_lower for kw in FUNDING_KEYWORDS):
        return 'funding'
    if any(kw in title_lower for kw in CONTRACT_KEYWORDS):
        return 'contract'
    if any(kw in title_lower for kw in REGULATORY_KEYWORDS):
        return 'regulatory'
    return None


def extract_amount(title):
    """Try to extract a dollar/euro amount from a title."""
    patterns = [
        r'\$(\d+(?:\.\d+)?)\s*(billion|million|B|M)',
        r'(\d+(?:\.\d+)?)\s*(billion|million|B|M)\s*(?:dollar|usd)',
        r'€(\d+(?:\.\d+)?)\s*(billion|million|B|M)',
        r'EUR\s*(\d+(?:\.\d+)?)\s*(billion|million|B|M)',
        r'SEK\s*(\d+(?:\.\d+)?)\s*(billion|million|B|M)',
        r'CAD\s*(\d+(?:\.\d+)?)\s*(billion|million|B|M)',
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


def mine_dronelife():
    """Scrape DRONELIFE listing pages for article links, classify them."""
    all_articles = []
    
    for url in DRONELIFE_URLS:
        print(f"  Fetching {url}")
        html = fetch_page(url)
        if not html:
            continue
        
        parser = ArticleLinkParser()
        parser.feed(html)
        
        for article in parser.articles:
            category = classify_article(article['title'])
            if category:
                article['category'] = category
                article['amount'] = extract_amount(article['title'])
                article['source'] = 'dronelife.com'
                all_articles.append(article)
    
    print(f"  Found {len(all_articles)} classified articles")
    return all_articles


def articles_to_intel(articles):
    """Convert classified articles into forge_intel.json format entries."""
    funding = []
    contracts = []
    regulatory = []
    
    for a in articles:
        entry = {
            'title': a['title'],
            'url': a['url'],
            'source': a['source'],
            'amount': a.get('amount'),
        }
        
        if a['category'] == 'funding':
            funding.append({
                'company': _extract_company(a['title']),
                'amount': a.get('amount', 'Undisclosed'),
                'date': '2026',
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
                'date': '2026',
                'type': _guess_contract_type(a['title']),
                'source': a['source'],
                'note': a['title'],
                'url': a['url'],
            })
        elif a['category'] == 'regulatory':
            regulatory.append({
                'program': a['title'][:80],
                'date': '2026',
                'type': 'Regulatory',
                'note': a['title'],
                'url': a['url'],
            })
    
    return funding, contracts, regulatory


def _extract_company(title):
    """Best-effort company name extraction from article title."""
    # Common patterns: "Company raises $XM", "Company awarded contract"
    # Just take the first capitalized word sequence before a verb
    words = title.split()
    company_words = []
    for w in words:
        if w[0:1].isupper() and w.lower() not in ('the', 'a', 'an', 'new', 'first', 'latest', 'recent', 'why', 'how'):
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
    return 'Defense'


if __name__ == '__main__':
    print("Mining DRONELIFE...")
    articles = mine_dronelife()
    funding, contracts, regulatory = articles_to_intel(articles)
    
    print(f"\nResults:")
    print(f"  Funding: {len(funding)}")
    print(f"  Contracts: {len(contracts)}")
    print(f"  Regulatory: {len(regulatory)}")
    
    # Output as JSON to stdout for piping
    result = {'funding': funding, 'contracts': contracts, 'regulatory': regulatory}
    print(json.dumps(result, indent=2))
