import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import build_static as builder


class PrivateModelExportTests(unittest.TestCase):
    def fixture_bundle(self, content=b"model-bytes"):
        return ({
            "id": "fixture",
            "name": "Fixture model",
            "status": "TEST",
            "status_tone": "ready",
            "summary": "fixture",
            "use_with": "test runtime",
            "install": "test directory",
            "portability": "test only",
            "share_note": "test only",
            "package": "fixture.zip",
            "files": ({
                "path": "models/fixture.tflite",
                "bytes": len(content),
                "sha256": hashlib.sha256(content).hexdigest(),
                "role": "test graph",
            },),
        },)

    def test_export_copies_only_allowlisted_bytes_and_builds_package(self):
        content = b"model-bytes"
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "models").mkdir()
            (root / "models/fixture.tflite").write_bytes(content)
            (root / "models/retired-fp32.tflite").write_bytes(b"do-not-copy")
            output = root / "private"
            with patch.object(builder, "PRIVATE_MODEL_BUNDLES", self.fixture_bundle(content)):
                catalog = builder.export_private_model_library(root, "a" * 40, output)

            exported = output / "models/files/fixture.tflite"
            self.assertEqual(exported.read_bytes(), content)
            self.assertTrue((output / "models/files/fixture.zip").is_file())
            self.assertFalse((output / "models/files/retired-fp32.tflite").exists())
            persisted = json.loads((output / "models/catalog.json").read_text(encoding="utf-8"))
            self.assertEqual(persisted["upstream_ref"], "a" * 40)
            self.assertEqual(catalog["bundles"][0]["files"][0]["sha256"], hashlib.sha256(content).hexdigest())

    def test_export_fails_closed_when_upstream_bytes_drift(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "models").mkdir()
            (root / "models/fixture.tflite").write_bytes(b"changed")
            with patch.object(builder, "PRIVATE_MODEL_BUNDLES", self.fixture_bundle()):
                with self.assertRaisesRegex(ValueError, "drifted"):
                    builder.export_private_model_library(root, "b" * 40, root / "private")

    def test_catalog_configuration_excludes_retired_fp32_exports(self):
        exported = {
            Path(row["path"]).name
            for bundle in builder.PRIVATE_MODEL_BUNDLES
            for row in bundle["files"]
        }
        retired = {row["name"] for row in builder.PRIVATE_RETIRED_MODEL_FILES}
        self.assertFalse(exported & retired)
        self.assertEqual(len(builder.PRIVATE_MODEL_BUNDLES), 3)

    def test_private_page_and_dashboard_links_are_registered(self):
        root = Path(__file__).resolve().parents[1]
        page = (root / "forge-source/private/models.html").read_text(encoding="utf-8")
        landing = (root / "forge-source/private/index.html").read_text(encoding="utf-8")
        library = (root / "forge-source/software-library.html").read_text(encoding="utf-8")
        self.assertEqual(builder.PAGES["private/models.html"], "private/models/index.html")
        for token in ("Use the right file", "How agnostic?", "Where it goes", "Copy package link"):
            self.assertIn(token, page)
        self.assertIn('/private/models/', landing)
        self.assertIn("Forge Developer Models", library)
        self.assertIn("/models/", library)


if __name__ == "__main__":
    unittest.main()
