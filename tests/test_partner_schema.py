import importlib.util
from pathlib import Path
import sqlite3
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
spec = importlib.util.spec_from_file_location('partner_schema', ROOT / 'tools/provision_partner_accounts.py')
schema = importlib.util.module_from_spec(spec)
spec.loader.exec_module(schema)


class PartnerSchemaTests(unittest.TestCase):
    def test_migration_preserves_historical_actor_and_catalog_records(self):
        with sqlite3.connect(':memory:') as database:
            for file in ('0001_ecosystem.sql', '0002_partner_portal_v2.sql'):
                database.executescript((ROOT / 'ecosystem-migrations' / file).read_text())

            def rows():
                return [dict(zip(('type', 'name', 'sql'), row)) for row in database.execute(
                    "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL")]

            self.assertEqual(schema.schema_state(rows()), 'needs-migration')
            database.execute("INSERT INTO ecosystem_organizations VALUES ('historical-oem','Historical OEM','OEM',123)")
            event = ('old-event','historical-oem','original-access-subject','ACCESS','product.publish','product-revision','motor:r1','{}',123)
            database.execute('INSERT INTO ecosystem_audit_events VALUES (?,?,?,?,?,?,?,?,?)', event)
            database.executescript((ROOT / schema.MIGRATION).read_text())
            self.assertEqual(database.execute('SELECT * FROM ecosystem_audit_events').fetchone(), event)
            self.assertEqual(database.execute('SELECT name FROM ecosystem_organizations').fetchone()[0], 'Historical OEM')
            database.executescript((ROOT / 'ecosystem-migrations/0004_partner_completion_and_recovery.sql').read_text())
            self.assertEqual(schema.schema_state(rows()), 'ready')
            self.assertEqual(schema.schema_state(rows()), 'ready', 'Later deployments must skip the migration')
            database.execute('ALTER TABLE ecosystem_partner_accounts ADD COLUMN conflicting_column TEXT')
            with self.assertRaises(schema.ProvisioningError):
                schema.schema_state(rows())

    def test_incomplete_existing_schema_is_rejected(self):
        with self.assertRaises(schema.ProvisioningError):
            schema.schema_state([])


if __name__ == '__main__':
    unittest.main()
