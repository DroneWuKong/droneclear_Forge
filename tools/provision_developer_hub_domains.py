"""Add only the six provider-returned developer-hub DNS records. No overwrites."""
import json
import os
from pathlib import Path
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
ALLOWED = {
    'dev.prismoprime.com', 'labs.prismoprime.com',
    '_openai-site-verification.dev.prismoprime.com', '_cf-custom-hostname.dev.prismoprime.com',
    '_openai-site-verification.labs.prismoprime.com', '_cf-custom-hostname.labs.prismoprime.com',
}


def desired_records():
    config = json.loads((ROOT / 'data/developer-hub-domains.json').read_text())
    if config['zone'] != 'prismoprime.com' or {r['name'] for r in config['records']} != ALLOWED:
        raise ValueError('Developer DNS scope differs from the two authorized hostnames')
    for r in config['records']:
        if r['type'] not in {'CNAME', 'TXT'} or not r.get('content'):
            raise ValueError('Invalid developer DNS record')
        if r['type'] == 'CNAME' and (r['content'] != 'custom-domains.chatgpt.site' or r.get('proxied') is not False):
            raise ValueError('Developer CNAME must match the provider and remain DNS-only')
    return config['records']


def missing_record(desired, existing):
    relevant = [r for r in existing if r['name'] == desired['name']]
    same = [r for r in relevant if r['type'] == desired['type'] and r['content'].rstrip('.') == desired['content'].rstrip('.')]
    if same:
        if desired['type'] == 'CNAME' and same[0].get('proxied') is not False:
            raise ValueError('Existing developer CNAME is proxied; review it before changing')
        return False
    if relevant:
        raise ValueError('Existing DNS record conflicts; refusing to replace it')
    return True


def provision():
    token = os.environ.get('CLOUDFLARE_API_TOKEN', '')
    if not token:
        raise ValueError('Cloudflare token is unavailable')
    def api(path, data=None):
        request = urllib.request.Request('https://api.cloudflare.com/client/v4/' + path,
            data=json.dumps(data).encode() if data is not None else None,
            headers={'Authorization':'Bearer ' + token, 'Content-Type':'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                value = json.load(response)
            if not value.get('success'):
                raise ValueError()
            return value['result']
        except Exception:
            raise ValueError('Cloudflare DNS operation failed; verify Zone DNS Edit for prismoprime.com') from None
    zones = api('zones?name=prismoprime.com')
    if len(zones) != 1:
        raise ValueError('The token cannot identify the exact prismoprime.com zone')
    zone = zones[0]['id']
    count = 0
    for record in desired_records():
        path = 'zones/' + zone + '/dns_records'
        existing = api(path + '?' + urllib.parse.urlencode({'name':record['name']}))
        if missing_record(record, existing):
            api(path, {**record,'ttl':1,'comment':'Prismo developer hub provider validation'})
            count += 1
    print(json.dumps({'developer_hub_dns_verified':True,'created_records':count,'zone':'prismoprime.com'}))


if __name__ == '__main__':
    try:
        provision()
    except ValueError as error:
        raise SystemExit(str(error)) from None
