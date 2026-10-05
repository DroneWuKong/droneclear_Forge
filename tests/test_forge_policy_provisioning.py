import json
import sqlite3
import unittest
from pathlib import Path
from unittest.mock import patch

from tools import provision_forge_policy as provision


class ForgeProvisioningTests(unittest.TestCase):
    def database(self):
        database = sqlite3.connect(":memory:")
        self.addCleanup(database.close)
        for path in sorted((provision.ROOT / "migrations").glob("000[1-7]_*.sql")):
            database.executescript(path.read_text())
        return database

    def rows(self, database):
        return [dict(zip(("type", "name", "sql"), row)) for row in database.execute(
            "SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger')")]

    def test_migration_readback_is_repeatable_without_changing_serving(self):
        database = self.database()
        self.assertTrue(provision.schema_needs_migration(self.rows(database)))
        migration = (provision.ROOT / provision.MIGRATION).read_text()
        database.executescript(migration)
        database.execute("INSERT INTO forge_matching_policy_state(policy_id,updated) VALUES('forge-product-matching','now')")
        database.executescript(migration)
        self.assertFalse(provision.schema_needs_migration(self.rows(database)))
        self.assertEqual(database.execute("SELECT active_version,generation,shadow_version FROM forge_matching_policy_state").fetchone(),
                         ("compatibility-weight-v1", 0, None))
        self.assertEqual(database.execute("SELECT COUNT(*) FROM forge_matching_transitions").fetchone()[0], 0)

    def test_missing_prior_schema_and_conflicting_schema_stop(self):
        with self.assertRaisesRegex(provision.ProvisioningError, "0001–0007"):
            provision.schema_needs_migration([])
        database = self.database()
        database.execute("CREATE TABLE forge_matching_receipts(id TEXT)")
        with self.assertRaisesRegex(provision.ProvisioningError, "conflicts"):
            provision.schema_needs_migration(self.rows(database))

    def test_signing_secret_is_preserved_and_plaintext_binding_rejected(self):
        project = {"name": provision.PROJECT, "production_branch": "master",
                   "deployment_configs": {"production": {"env_vars": {}}}}
        self.assertEqual(provision.project_secret_state(project), "absent")
        binding = project["deployment_configs"]["production"]["env_vars"]
        binding[provision.SECRET_NAME] = {"type": "secret_text"}
        self.assertEqual(provision.project_secret_state(project), "preserve")
        binding[provision.SECRET_NAME] = {"type": "plain_text", "value": "fictional"}
        with self.assertRaises(provision.ProvisioningError):
            provision.project_secret_state(project)

    def test_cli_failure_never_echoes_secret_or_diagnostic(self):
        failed = provision.subprocess.CompletedProcess([], 1, "fictional-secret", "fictional-token")
        with patch.object(provision.subprocess, "run", return_value=failed):
            with self.assertRaises(provision.ProvisioningError) as error:
                provision.run_wrangler(["pages", "secret", "put", provision.SECRET_NAME], input_text="fictional-secret")
        self.assertNotIn("fictional", str(error.exception))

    def test_live_readback_requires_signing_and_no_automatic_promotion(self):
        status = {"policy_id": "forge-product-matching", "signing_configured": True,
                  "automatic_promotion": False, "active_version": "compatibility-weight-v1", "generation": 0}
        self.assertEqual(provision.verify_status(status)["generation"], 0)
        for change in ({"signing_configured": False}, {"automatic_promotion": True}, {"generation": True}):
            with self.assertRaises(provision.ProvisioningError):
                provision.verify_status({**status, **change})

    def test_readback_is_locked_to_the_exact_project_deployment(self):
        with patch.dict(provision.os.environ, {"FORGE_POLICY_DEPLOYMENT_URL": ""}):
            self.assertEqual(provision.status_url(), "https://uas-patterns.com/api/autonomy/forge-policy/status")
        with patch.dict(provision.os.environ, {"FORGE_POLICY_DEPLOYMENT_URL": "https://254531cd.droneclear-forge.pages.dev/"}):
            self.assertEqual(provision.status_url(), "https://254531cd.droneclear-forge.pages.dev/api/autonomy/forge-policy/status")
        for url in ("https://example.com", "https://user@254531cd.droneclear-forge.pages.dev", "https://254531cd.droneclear-forge.pages.dev/other"):
            with patch.dict(provision.os.environ, {"FORGE_POLICY_DEPLOYMENT_URL": url}):
                with self.assertRaises(provision.ProvisioningError):
                    provision.status_url()


if __name__ == "__main__":
    unittest.main()
