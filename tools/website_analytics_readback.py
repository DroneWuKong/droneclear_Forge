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
from concurrent.futures import ThreadPoolExecutor

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

def history_report():
    root = '{viewer{accounts(filter:{accountTag:"' + ACCOUNT + '"}){settings{__typename}}}}'
    metadata = gql(root)
    REPORT['history_metadata'] = metadata
    settings_type = metadata['data']['viewer']['accounts'][0]['settings']['__typename']
    fields = gql('{__type(name:' + json.dumps(settings_type) + '){fields{name}}}')
    names = [f['name'] for f in fields.get('data', {}).get('__type', {}).get('fields', [])
             if f['name'].startswith('httpRequests') or f['name'].startswith('rumPageload')]
    REPORT['history_nodes'] = names
    query = ('{viewer{accounts(filter:{accountTag:"' + ACCOUNT + '"}){settings{'
             + ' '.join(n + '{enabled notOlderThan maxDuration availableFields}' for n in names) + '}}}}')
    settings = gql(query)
    REPORT['history_settings'] = settings
    cfg = settings['data']['viewer']['accounts'][0]['settings']['httpRequestsAdaptiveGroups']
    # Include the partial oldest retained day and the current partial day.
    seconds = min(cfg['notOlderThan'], cfg['maxDuration']) - 600
    start = (NOW - dt.timedelta(seconds=seconds)).isoformat().replace('+00:00', 'Z')
    stop = NOW.isoformat().replace('+00:00', 'Z')
    hosts = [host for domain in DOMAINS for host in (domain, 'www.' + domain)]
    query = ('{viewer{accounts(filter:{accountTag:"' + ACCOUNT + '"}){'
        'httpRequestsAdaptiveGroups(limit:1000,filter:{datetime_geq:"' + start + '",'
        'datetime_lt:"' + stop + '",requestSource:"eyeball",clientRequestHTTPHost_in:' + json.dumps(hosts) + '},'
        'orderBy:[date_ASC]){count dimensions{date clientRequestHTTPHost}sum{visits}avg{sampleInterval}}}}}')
    REPORT['account_traffic'] = gql(query)
    REPORT['start_utc'] = start
    REPORT['end_exclusive_utc'] = stop
    namespace = '4a6f8fcda0e1405b9880e0f4e2886a3c'
    base = 'accounts/' + ACCOUNT + '/storage/kv/namespaces/' + namespace
    listing = cf(base + '/keys?prefix=analytics_daily_&limit=1000')
    REPORT['kv'] = {'key_listing': listing, 'days': []}
    keys = listing.get('result', [])
    def read_day(key):
        name = key.get('name', '')
        if not name.startswith('analytics_daily_'):
            return {}
        value = cf(base + '/values/' + urllib.parse.quote(name, safe=''))
        return {k: value[k] for k in ('date','events','pages') if k in value}
    if isinstance(keys, list):
        with ThreadPoolExecutor(max_workers=6) as pool:
            REPORT['kv']['days'] = list(pool.map(read_day, keys))

def rum_history_report():
    settings = gql('{viewer{accounts(filter:{accountTag:"' + ACCOUNT + '"}){settings{'
        'rumPageloadEventsAdaptiveGroups{enabled notOlderThan maxDuration maxPageSize availableFields}}}}}')
    REPORT['rum_settings'] = settings
    cfg = settings['data']['viewer']['accounts'][0]['settings']['rumPageloadEventsAdaptiveGroups']
    start = NOW - dt.timedelta(seconds=cfg['notOlderThan'] - 600)
    hosts = [host for domain in DOMAINS for host in (domain, 'www.' + domain)]
    REPORT['rum_history'] = {'start_utc':start.isoformat(),'end_utc':NOW.isoformat(),'windows':[]}
    cursor = start
    while cursor < NOW:
        stop = min(NOW, dt.datetime.combine(cursor.date() + dt.timedelta(days=90), dt.time(), dt.timezone.utc))
        query = ('{viewer{accounts(filter:{accountTag:"' + ACCOUNT + '"}){'
            'rumPageloadEventsAdaptiveGroups(limit:' + str(min(cfg['maxPageSize'],10000)) + ',filter:{datetime_geq:"'
            + cursor.isoformat().replace('+00:00','Z') + '",datetime_lt:"' + stop.isoformat().replace('+00:00','Z')
            + '",requestHost_in:' + json.dumps(hosts) + '},orderBy:[date_ASC])'
            '{count dimensions{date requestHost bot}sum{visits}avg{sampleInterval}}}}}')
        REPORT['rum_history']['windows'].append({'start':cursor.isoformat(),'end_exclusive':stop.isoformat(),'response':gql(query)})
        cursor = stop

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
        mode = os.environ.get('ANALYTICS_REPORT_MODE', 'traffic')
        if mode == 'traffic':
            for domain in DOMAINS:
                zone_report(domain)
        elif mode == 'account':
            hosts = [host for domain in DOMAINS for host in (domain, 'www.' + domain)]
            start = str(END - dt.timedelta(days=31)) + 'T00:00:00Z'
            stop = str(END) + 'T00:00:00Z'
            query = ('{viewer{accounts(filter:{accountTag:"' + ACCOUNT + '"}){'
                'httpRequestsAdaptiveGroups(limit:1000,filter:{datetime_geq:"' + start + '",'
                'datetime_lt:"' + stop + '",requestSource:"eyeball",clientRequestHTTPHost_in:' + json.dumps(hosts) + '},'
                'orderBy:[date_ASC]){count dimensions{date clientRequestHTTPHost}sum{visits}avg{sampleInterval}}}}}')
            REPORT['account_traffic'] = gql(query)
            REPORT['start_utc'] = start
        elif mode == 'diagnostic':
            verification = cf('accounts/' + ACCOUNT + '/tokens/verify')
            REPORT['token_verification'] = verification
            token_id = verification.get('result', {}).get('id')
            if token_id:
                REPORT['token_configuration'] = cf('accounts/' + ACCOUNT + '/tokens/' + token_id)
        elif mode == 'history':
            history_report()
        elif mode == 'rum-history':
            rum_history_report()
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
