import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('hubdns',Path(__file__).resolve().parents[1]/'tools/provision_developer_hub_domains.py')
dns=importlib.util.module_from_spec(spec);spec.loader.exec_module(dns)
class DomainTests(unittest.TestCase):
    def test_only_exact_provider_records_and_no_overwrite(self):
        rows=dns.desired_records();self.assertEqual(len(rows),6)
        for row in rows:
            self.assertTrue(dns.missing_record(row,[]))
            self.assertFalse(dns.missing_record(row,[row]))
            with self.assertRaises(ValueError):dns.missing_record(row,[{**row,'content':'unrelated-existing-record'}])
    def test_proxied_existing_hostname_requires_review(self):
        row=dns.desired_records()[0]
        with self.assertRaises(ValueError):dns.missing_record(row,[{**row,'proxied':True}])
if __name__=='__main__':unittest.main()
