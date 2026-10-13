"""Assign publication review to one explicitly selected, verified account ID."""
import json
import os
import re
import time
from provision_forge_policy import ProvisioningError, run_wrangler

email = os.environ.get('REVIEWER_EMAIL', '').strip().lower()
if len(email) > 254 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
    raise SystemExit('Provide the publication reviewer email selected by the site owner.')
literal = "'" + email.replace("'", "''") + "'"
arguments = ['d1','execute','ECOSYSTEM_DB','--remote','--yes','--json','--config','wrangler.jsonc','--command']
try:
    lookup = json.loads(run_wrangler([*arguments,
        f"SELECT account_id FROM ecosystem_partner_accounts WHERE email = {literal} AND status = 'ACTIVE' AND email_verified_at_ms IS NOT NULL"]))
    accounts = [row for result in lookup if result.get('success') is True for row in result.get('results', [])]
    if len(accounts) != 1 or not re.fullmatch(r'[0-9a-f-]{36}', accounts[0]['account_id']):
        raise SystemExit('The selected reviewer must create a partner account and verify their email first. No review authority was changed.')
    account = accounts[0]['account_id']
    run_wrangler([*arguments, f"INSERT INTO ecosystem_partner_reviewers (account_id,status,assigned_by,assigned_at_ms) VALUES ('{account}','ACTIVE','operator-setup',{int(time.time()*1000)}) ON CONFLICT(account_id) DO UPDATE SET status='ACTIVE',assigned_by='operator-setup',assigned_at_ms=excluded.assigned_at_ms"])
    verified = json.loads(run_wrangler([*arguments, f"SELECT account_id FROM ecosystem_partner_reviewers WHERE account_id = '{account}' AND status = 'ACTIVE'"]))
    if not any(item.get('success') is True and item.get('results') for item in verified):
        raise SystemExit('Reviewer assignment could not be verified.')
    print(json.dumps({'reviewer_assigned':True,'account_id':account,'platform_administration_granted':False}))
except (ProvisioningError, ValueError, KeyError):
    raise SystemExit('Reviewer setup failed; no credentials were printed.') from None
