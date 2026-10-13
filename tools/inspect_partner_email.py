"""Inspect email readiness using production metadata without exposing credentials."""
import json
import os
import subprocess
import urllib.error
import urllib.request

account = os.environ['CLOUDFLARE_ACCOUNT_ID']
token = os.environ['CLOUDFLARE_API_TOKEN']
request = urllib.request.Request(
    f'https://api.cloudflare.com/client/v4/accounts/{account}/pages/projects/droneclear-forge',
    headers={'Authorization': 'Bearer ' + token, 'User-Agent': 'ForgePartnerReadiness/1.0'},
)
try:
    with urllib.request.urlopen(request, timeout=30) as response:
        value = json.load(response)
    if value.get('success') is not True:
        raise ValueError
    config = value['result']['deployment_configs']['production']
    variables = config.get('env_vars', {})
    print(json.dumps({
        'resend_configured': variables.get('RESEND_API_KEY', {}).get('type') == 'secret_text',
        'sender_configured': bool(variables.get('PARTNER_EMAIL_FROM', {}).get('value') or variables.get('DIGEST_FROM', {}).get('value')),
        'email_service_binding_configured': 'PARTNER_EMAIL' in config.get('services', {}),
        'relevant_binding_names': sorted(name for name in variables if any(term in name for term in ('EMAIL', 'SMTP', 'RESEND', 'DIGEST_FROM'))),
    }))
    domains = subprocess.run(['npx', '--yes', 'wrangler@4.147.0', 'email', 'sending', 'list'],
        capture_output=True, text=True, timeout=180, env={**os.environ, 'CI': 'true', 'WRANGLER_SEND_METRICS': 'false'})
    print(json.dumps({'cloudflare_email_domain_inspection_succeeded': domains.returncode == 0}))
    if domains.returncode == 0:
        for line in domains.stdout.splitlines():
            if any(domain in line for domain in ('uas-forge.com', 'uas-patterns.com', 'midwestniceuas.com')):
                print(line)
except (urllib.error.URLError, ValueError, KeyError):
    raise SystemExit('Production email metadata inspection failed; no credentials were printed.') from None
