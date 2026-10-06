import hashlib
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import build_static as builder


class PublicModelExportTests(unittest.TestCase):
    def fixture_release(self, content=b"model-bytes"):
        return ({
            "id": "fixture",
            "name": "Fixture model",
            "status": "BENCH ONLY",
            "status_tone": "caution",
            "summary": "one model",
            "task": "test task",
            "audiences": ("developers",),
            "use_with": "test runtime",
            "install": "test directory",
            "portability": "test only",
            "validation": "test evidence",
            "limitations": "not flight qualified",
            "license_status": "permission required",
            "provenance_status": "test only",
            "package": "fixture.zip",
            "files": ({
                "path": "models/fixture.onnx",
                "bytes": len(content),
                "sha256": hashlib.sha256(content).hexdigest(),
                "role": "test graph",
                "format": "ONNX",
                "normalize_lf": False,
            },),
        },)

    def test_export_copies_only_allowlisted_bytes_and_builds_shareable_package(self):
        content = b"model-bytes"
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "models").mkdir()
            (root / "models/fixture.onnx").write_bytes(content)
            (root / "models/private-model.tflite").write_bytes(b"do-not-copy")
            output = root / "public"
            with patch.object(builder, "PUBLIC_MODEL_RELEASES", self.fixture_release(content)):
                catalog = builder.export_public_model_library(root, "a" * 40, output)

            exported = output / "models/files/fixture.onnx"
            package = output / "models/files/fixture.zip"
            self.assertEqual(exported.read_bytes(), content)
            self.assertFalse((output / "models/files/private-model.tflite").exists())
            with zipfile.ZipFile(package) as archive:
                self.assertEqual(archive.namelist(), ["fixture.onnx"])
                self.assertEqual(archive.read("fixture.onnx"), content)
            persisted = json.loads((output / "models/catalog.json").read_text(encoding="utf-8"))
            self.assertEqual(persisted["access"], "Public developer preview; links may be shared")
            self.assertEqual(persisted["upstream_ref"], "a" * 40)
            self.assertEqual(catalog["releases"][0]["files"][0]["sha256"], hashlib.sha256(content).hexdigest())

    def test_export_normalizes_text_line_endings_before_hashing(self):
        canonical = b"drone\nbird\n"
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "models").mkdir()
            (root / "models/labels.txt").write_bytes(b"drone\r\nbird\r\n")
            release = list(self.fixture_release(canonical))
            release[0] = {**release[0], "files": ({
                "path": "models/labels.txt",
                "bytes": len(canonical),
                "sha256": hashlib.sha256(canonical).hexdigest(),
                "role": "labels",
                "format": "Labels",
                "normalize_lf": True,
            },)}
            with patch.object(builder, "PUBLIC_MODEL_RELEASES", tuple(release)):
                builder.export_public_model_library(root, "b" * 40, root / "public")
            self.assertEqual((root / "public/models/files/labels.txt").read_bytes(), canonical)

    def test_export_fails_closed_when_upstream_bytes_drift(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "models").mkdir()
            (root / "models/fixture.onnx").write_bytes(b"changed")
            with patch.object(builder, "PUBLIC_MODEL_RELEASES", self.fixture_release()):
                with self.assertRaisesRegex(ValueError, "drifted"):
                    builder.export_public_model_library(root, "c" * 40, root / "public")

    def test_public_release_excludes_third_party_missing_and_retired_artifacts(self):
        exported = {
            Path(row["path"]).name
            for release in builder.PUBLIC_MODEL_RELEASES
            for row in release["files"]
        }
        self.assertEqual(len(builder.PUBLIC_MODEL_RELEASES), 1)
        self.assertEqual(len(exported), 5)
        self.assertFalse(any("ssd_mobilenet" in name for name in exported))
        self.assertFalse(any("fp32" in name for name in exported))
        self.assertTrue(any(row["name"] == "NanoDet VisDrone run" for row in builder.PUBLIC_MODEL_WITHHELD))

    def test_page_library_navigation_and_redirect_are_public(self):
        root = Path(__file__).resolve().parents[1]
        page = (root / "forge-source/models.html").read_text(encoding="utf-8")
        library = (root / "forge-source/software-library.html").read_text(encoding="utf-8")
        redirects = (root / "_redirects").read_text(encoding="utf-8")
        self.assertEqual(builder.PAGES["models.html"], "models/index.html")
        for token in (
            "One trained detector", "Use the right file", "How agnostic?",
            "Where it goes", "Copy package link", "flight-qualified",
            "Public link ≠ open-source license",
        ):
            self.assertIn(token, page)
        self.assertIn("/models/", library)
        self.assertNotIn("url: '/private/models/'", library)
        self.assertIn("/models /models/ 301", redirects)


if __name__ == "__main__":
    unittest.main()
