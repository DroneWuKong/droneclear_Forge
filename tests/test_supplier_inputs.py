import hashlib
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from tools.supplier_inputs import PUBLIC_NAMES, validate_supplier_inputs
from tools.public_inputs import sync_public_inputs


class SupplierInputTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        for name in PUBLIC_NAMES.values():
            shutil.copyfile(Path('forge-source')/(name+'.json'), self.root/(name+'.json'))

    def tearDown(self): self.tmp.cleanup()

    def write_offer(self, row):
        file=self.root/'supplier_offers.json'
        value=json.loads(file.read_text());value['offers']=[row]
        file.write_text(json.dumps(value))
        manifest=self.root/'supplier_manifest.json'
        data=json.loads(manifest.read_text());data['files']['offers.v1.json']=hashlib.sha256(file.read_bytes()).hexdigest();manifest.write_text(json.dumps(data))

    def test_complete_seed_publication_is_valid(self):
        self.assertTrue(validate_supplier_inputs(self.root))

    def test_partial_bundle_fails_before_copy(self):
        (self.root/'supplier_fx.json').unlink()
        target = self.root/'target'
        with self.assertRaises(ValueError): sync_public_inputs(self.root,target)
        self.assertFalse((target/'supplier_profiles.json').exists())

    def test_hash_mismatch_fails(self):
        (self.root/'supplier_offers.json').write_text('{}')
        with self.assertRaises(ValueError): validate_supplier_inputs(self.root)

    def test_local_evidence_is_not_public(self):
        self.write_offer({'offer_id':'SO-1','supplier_id':'SUP-DE-FPV24','evidence_storage':'local_only'})
        with self.assertRaisesRegex(ValueError,'stored source evidence'): validate_supplier_inputs(self.root)

    def test_evidence_intervals_prices_and_urls_are_validated(self):
        row={'offer_id':'SO-1','supplier_id':'SUP-DE-FPV24','evidence_storage':'private_r2',
             'evidence_sha256':'a'*64,'observation_evidence_sha256':'b'*64,
             'observed_at':'2026-10-27T09:00:00Z','expires_at':'2026-10-30T09:00:00Z',
             'source_url':'https://shop.example/item','identity':{'name':'Item'},
             'price':{'amount':'24.90','currency':'EUR','tax':'unknown'},
             'ships_from':[],'shipping_destinations':[], 'provenance':'public_supplier_page'}
        self.write_offer(row)
        self.assertTrue(validate_supplier_inputs(self.root))
        for key, value in [('evidence_sha256','bad'),('expires_at','2026-10-26T09:00:00Z'),
                           ('source_url','javascript:alert(1)'),('ships_from','DE'),
                           ('price',{'amount':'NaN','currency':'EUR','tax':'unknown'})]:
            with self.subTest(key=key):
                self.write_offer(dict(row, **{key:value}))
                with self.assertRaises(ValueError): validate_supplier_inputs(self.root)


if __name__ == '__main__': unittest.main()
