import unittest
from unittest.mock import patch
from tools.repair_www_redirects import ACCOUNT, PHASE, REF, DOMAINS, rule_for, prepare, apply_plan, main


class Fixture:
    def __init__(self, *, rules=None, dns=None, wrong_account=False):
        self.rules, self.dns, self.wrong_account = rules, dns, wrong_account
        self.calls = []

    def request(self, method, path, payload=None, **kwargs):
        self.calls.append((method, path, payload))
        if method != 'GET':
            return {}
        domain = DOMAINS[0]
        if path.startswith('/zones?'):
            return [{'id': 'zone', 'name': domain, 'account': {'id': 'other' if self.wrong_account else ACCOUNT}}]
        if '/dns_records?' in path:
            return self.dns if self.dns is not None else [{'id': 'dns', 'type': 'CNAME', 'name': 'www.' + domain, 'proxied': True}]
        if '/entrypoint' in path:
            return None if self.rules is None else {'id': 'ruleset', 'rules': self.rules}
        raise AssertionError(path)


class WWWRedirectTests(unittest.TestCase):
    def test_exact_host_path_and_query_preservation(self):
        rule = rule_for(DOMAINS[0])
        self.assertEqual(rule['expression'], '(http.host eq "www.uas-forge.com")')
        self.assertTrue(rule['action_parameters']['from_value']['preserve_query_string'])
        self.assertIn('http.request.uri.path', rule['action_parameters']['from_value']['target_url']['expression'])
        with self.assertRaises(ValueError):
            rule_for('other.invalid')

    def test_existing_proxied_dns_and_other_rules_are_preserved(self):
        other = {'id': 'other', 'ref': 'unrelated', 'expression': 'false'}
        api = Fixture(rules=[other])
        plan = prepare(api, DOMAINS[0])
        self.assertTrue(all(call[0] == 'GET' for call in api.calls))
        self.assertEqual(len(plan['changes']), 1)
        apply_plan(api, plan)
        self.assertEqual(api.calls[-1][0], 'POST')
        self.assertEqual(api.calls[-1][1], '/zones/zone/rulesets/ruleset/rules')
        self.assertEqual(other, {'id': 'other', 'ref': 'unrelated', 'expression': 'false'})

    def test_equivalent_rule_is_idempotent_and_managed_update_is_specific(self):
        api = Fixture(rules=[rule_for(DOMAINS[0]) | {'id': 'managed'}])
        self.assertEqual(prepare(api, DOMAINS[0])['changes'], [])
        api.rules[0]['enabled'] = False
        changes = prepare(api, DOMAINS[0])['changes']
        self.assertEqual(changes[0][0:2], ('PATCH', '/zones/zone/rulesets/ruleset/rules/managed'))

    def test_missing_dns_can_only_create_fixed_www_cname_and_wrong_account_stops(self):
        plan = prepare(Fixture(dns=[]), DOMAINS[0])
        record = plan['changes'][-1][2]
        self.assertEqual(record['name'], 'www.uas-forge.com')
        self.assertEqual(record['content'], 'uas-forge.com')
        self.assertTrue(record['proxied'])
        api = Fixture(wrong_account=True)
        with self.assertRaises(RuntimeError):
            prepare(api, DOMAINS[0])
        self.assertEqual(len(api.calls), 1)

    def test_unsupported_dns_blocks_before_any_write(self):
        api = Fixture(dns=[{'name': 'www.uas-forge.com', 'type': 'MX'}])
        with self.assertRaises(RuntimeError):
            prepare(api, DOMAINS[0])
        self.assertTrue(all(call[0] == 'GET' for call in api.calls))

    def test_default_check_is_read_only_and_both_preflights_precede_apply(self):
        events = []
        with patch.dict('os.environ', {'CLOUDFLARE_API_TOKEN': 'fixture'}), \
             patch('tools.repair_www_redirects.Cloudflare'), \
             patch('tools.repair_www_redirects.prepare', side_effect=lambda api, domain: events.append(('read', domain)) or {'domain': domain, 'changes': []}), \
             patch('tools.repair_www_redirects.apply_plan', side_effect=lambda api, plan: events.append(('write', plan['domain']))):
            self.assertEqual(main([]), 0)
            self.assertEqual(events, [('read', domain) for domain in DOMAINS])
            events.clear()
            self.assertEqual(main(['--apply']), 0)
            self.assertEqual(events, [('read', domain) for domain in DOMAINS] + [('write', domain) for domain in DOMAINS])


if __name__ == '__main__':
    unittest.main()
