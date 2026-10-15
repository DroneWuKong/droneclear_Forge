"""Read aggregate traffic; export only an encrypted report, never credentials."""
import datetime as dt
import json
import os
from pathlib import Path
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request

DOMAINS = ['uasdash.com', 'uas-forge.com', 'uas-patterns.com', 'uas-handbook.com']
TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
ADMIN = os.environ.get('ANALYTICS_ADMIN_KEY', '')
ACCOUNT = os.environ.get('CLOUDFLARE_ACCOUNT_ID', '')
NOW = dt.datetime.now(dt.timezone.utc)
END = NOW.date()
REPORT = {'retrieved_at': NOW.isoformat(), 'end_exclusive_utc': str(END),
          'zones': {}, 'first_party': {}, 'rum': {}}

def request(url, headers=None, payload=None):
    req = urllib.request.Request(url, headers=headers or {},
        data=None if payload is None else json.dumps(payload).encode())
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read())
        except (ValueError, UnicodeDecodeError):
            body = {'error': 'Non-JSON error response'}
        return {'http_status': e.code, 'response': body}
    except Exception as e:
        return {'error_type': type(e).__name__}

def cf(path, payload=None):
    return request('https://api.cloudflare.com/client/v4/' + path,
        {'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json'}, payload)

def gql(query):
    return cf('graphql', {'query': query})

def zone_report(domain):
    listing = cf('zones?' + urllib.parse.urlencode({'name': domain, 'per_page': 50}))
    zones = listing.get('result')
    if not isinstance(zones, list) or not zones:
        REPORT['zones'][domain] = {'zone_lookup': listing}
        return
    zone = next((z for z in zones if z.get('name') == domain), None)
    if not zone:
        return
    zid = zone['id']
    result = {'zone_id': zid, 'plan': zone.get('plan', {}).get('name')}
    REPORT['zones'][domain] = result
    settings = gql('{viewer{zones(filter:{zoneTag:"' + zid + '"}){settings{'
        'httpRequests1dGroups{enabled notOlderThan maxDuration availableFields}'
        'httpRequestsAdaptiveGroups{enabled notOlderThan maxDuration availableFields}}}}}')
    result['settings_response'] = settings
    if settings.get('errors') or settings.get('http_status'):
        return
    try:
        cfg = settings['data']['viewer']['zones'][0]['settings']['httpRequests1dGroups']
    except (KeyError, TypeError, IndexError):
        cfg = {}
    if cfg.get('enabled') is False:
        return
    retention = int(cfg.get('notOlderThan') or 31 * 86400)
    earliest = (NOW - dt.timedelta(seconds=retention)).date() + dt.timedelta(days=1)
    start = max(END - dt.timedelta(days=90), earliest)
    chunk = max(1, min(30, int(cfg.get('maxDuration') or 31 * 86400) // 86400 - 1))
    result.update(start_utc=str(start), end_exclusive_utc=str(END), daily_responses=[])
    while start < END:
        stop = min(END, start + dt.timedelta(days=chunk))
        query = ('{viewer{zones(filter:{zoneTag:"' + zid + '"}){httpRequests1dGroups('
            'limit:100,filter:{date_geq:"' + str(start) + '",date_lt:"' + str(stop) + '"},'
            'orderBy:[date_ASC]){dimensions{date}sum{requests pageViews bytes threats cachedRequests}'
            'uniq{uniques}}}}}')
        result['daily_responses'].append({'start': str(start), 'end_exclusive': str(stop),
            'response': gql(query)})
        start = stop

def main():
    if TOKEN:
        verification = cf('accounts/' + ACCOUNT + '/tokens/verify')
        REPORT['token_verification'] = verification
        token_id = verification.get('result', {}).get('id')
        if token_id:
            REPORT['token_configuration'] = cf('accounts/' + ACCOUNT + '/tokens/' + token_id)
        REPORT['account_settings'] = gql('{viewer{accounts(filter:{accountTag:"' + ACCOUNT + '"}){settings{'
            'httpRequestsAdaptiveGroups{enabled notOlderThan maxDuration availableFields}}}}}')
    with tempfile.TemporaryDirectory() as temp:
        plaintext = Path(temp) / 'report.json'
        text = json.dumps(REPORT)
        for secret in (TOKEN, ADMIN, os.environ.get('GITHUB_TOKEN', '')):
            if secret:
                text = text.replace(secret, '[redacted]')
        plaintext.write_text(text)
        subprocess.run(['openssl','cms','-encrypt','-binary','-aes-256-cbc','-outform','DER',
            '-in',str(plaintext),'-out','analytics-report.enc',
            'tools/website_analytics_report_cert.pem'], check=True, capture_output=True)
    print('Encrypted aggregate report ready. No analytics values or credentials logged.')

if __name__ == '__main__':
    main()
