#!/usr/bin/env python3
"""Check or repair the fixed UAS public redirects using existing access."""
from __future__ import annotations

import argparse
import json
import os
import sys
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ACCOUNT = "173a0fd61e052799c3a6f2a63ebbb164"
DOMAINS = ("uas-forge.com", "uas-patterns.com")
INTEL_DOMAIN = "uas-intel.com"
PHASE = "http_request_dynamic_redirect"
REF = "uas_www_canonical_v1"


class Cloudflare:
    def __init__(self, token):
        self.token = token

    def request(self, method, path, payload=None, missing_ok=False):
        req = Request("https://api.cloudflare.com/client/v4" + path,
                      data=json.dumps(payload).encode() if payload is not None else None,
                      headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/json"},
                      method=method)
        try:
            with urlopen(req, timeout=25) as response:
                body = json.load(response)
        except HTTPError as exc:
            # Never print headers, token, or upstream response bodies.
            if missing_ok and exc.code == 404:
                return None
            raise RuntimeError(f"Cloudflare {method} {path.split('?')[0]} refused/unavailable (HTTP {exc.code})") from None
        if not body.get("success"):
            raise RuntimeError("Cloudflare operation did not report success")
        return body.get("result")


def rule_for(domain):
    if domain == INTEL_DOMAIN:
        destination = "uas-patterns.com"
        ref = "legacy_intel_to_patterns_v1"
        expression = '(http.host in {"uas-intel.com" "www.uas-intel.com"})'
    elif domain in DOMAINS:
        destination = domain
        ref = REF
        expression = f'(http.host eq "www.{domain}")'
    else:
        raise ValueError("Unsupported redirect domain")
    return {"ref": ref, "description": "Canonical UAS hostname; preserve path and query",
            "expression": expression, "action": "redirect", "enabled": True,
            "action_parameters": {"from_value": {"status_code": 301, "preserve_query_string": True,
                "target_url": {"expression": f'concat("https://{destination}", http.request.uri.path)'}}}}


def prepare(api, domain):
    desired = rule_for(domain)
    zones = api.request("GET", "/zones?" + urlencode({"name": domain, "account.id": ACCOUNT}))
    if len(zones) != 1 or zones[0].get("name") != domain or zones[0].get("account", {}).get("id") != ACCOUNT:
        raise RuntimeError("Exact zone in the expected account was not found: " + domain)
    zone_id = zones[0]["id"]
    root = "/zones/" + zone_id
    if domain == INTEL_DOMAIN:
        # Both legacy names already reach the Cloudflare edge. Only change a redirect.
        for host in (domain, "www." + domain):
            answers = api.request("GET", root + "/dns_records?" + urlencode({"name": host, "per_page": 100}))
            routes = [r for r in answers if r.get("name") == host and r.get("type") in {"A", "AAAA", "CNAME"}]
            if not routes or not all(r.get("proxied") for r in routes):
                raise RuntimeError("Expected proxied legacy hostname was not found: " + host)
        dns_changes = []
    else:
        dns_changes = prepare_www_dns(api, root, domain)
    ruleset = api.request("GET", root + "/rulesets/phases/" + PHASE + "/entrypoint", missing_ok=True)
    rules = (ruleset or {}).get("rules", [])
    matches = [rule for rule in rules if rule.get("ref") == desired["ref"]]
    if len(matches) > 1:
        raise RuntimeError("Duplicate managed redirect references: " + domain)
    # Intel currently has a competing redirect. Only these two exact hosts
    # should match our rule before that redirect, preserving unrelated rules.
    candidates = rules[:1] if domain == INTEL_DOMAIN else rules
    equivalent = any(rule.get("enabled", True) and rule.get("expression") == desired["expression"]
                     and rule.get("action") == "redirect" and rule.get("action_parameters") == desired["action_parameters"]
                     for rule in candidates)
    changes = []
    if not equivalent:
        if ruleset:
            path = root + "/rulesets/" + ruleset["id"] + "/rules"
            if domain == INTEL_DOMAIN:
                desired = {**desired, "position": {"before": ""}}
            if matches:
                changes.append(("PATCH", path + "/" + matches[0]["id"], desired))
            else:
                changes.append(("POST", path, desired))
        else:
            changes.append(("POST", root + "/rulesets", {"name": "UAS canonical redirects", "kind": "zone",
                            "phase": PHASE, "rules": [desired]}))
    return {"domain": domain, "changes": changes + dns_changes,
            "dns": "preserve existing DNS" if not dns_changes else "proxy only www",
            "rule": "already configured" if equivalent else "add/update canonical redirect"}


def prepare_www_dns(api, root, domain):
    records = api.request("GET", root + "/dns_records?" + urlencode({"name": "www." + domain, "per_page": 100}))
    if any(record.get("name") != "www." + domain or record.get("type") not in {"A", "AAAA", "CNAME"} for record in records):
        raise RuntimeError("Unexpected www DNS record; inspect it before changing routing: " + domain)
    # A proxied record can redirect at the edge without contacting its origin.
    # Preserve those records, even when their origin currently produces 522.
    if records and all(record.get("proxied") for record in records):
        dns_changes = []
    elif not records:
        dns_changes = [("POST", root + "/dns_records", {"type": "CNAME", "name": "www." + domain,
                        "content": domain, "proxied": True, "ttl": 1})]
    else:
        dns_changes = [("PATCH", root + "/dns_records/" + record["id"], {"proxied": True})
                       for record in records if not record.get("proxied")]
    return dns_changes


def apply_plan(api, plan):
    for method, path, payload in plan["changes"]:
        api.request(method, path, payload)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--legacy-intel", action="store_true", help="target only uas-intel.com and its www alias")
    parser.add_argument("--apply", action="store_true", help="apply the fixed, scoped plan; default is read-only")
    args = parser.parse_args(argv)
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
    if not token:
        print("Existing CLOUDFLARE_API_TOKEN is unavailable; no changes made.", file=sys.stderr)
        return 1
    api = Cloudflare(token)
    try:
        domains = (INTEL_DOMAIN,) if args.legacy_intel else DOMAINS
        plans = [prepare(api, domain) for domain in domains]
        for plan in plans:
            print(json.dumps({key: value for key, value in plan.items() if key != "changes"}
                             | {"operations": len(plan["changes"]), "mode": "apply" if args.apply else "check"}))
        if args.apply:
            for plan in plans:
                apply_plan(api, plan)
                print("Applied scoped configuration for " + plan["domain"] + "; verify live redirects before calling it repaired.")
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
