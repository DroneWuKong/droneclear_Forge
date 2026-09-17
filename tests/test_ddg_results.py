from pathlib import Path
import unittest


DDG = Path(__file__).resolve().parents[1] / "forge-source" / "ddg.html"


class DdgResultsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = DDG.read_text(encoding="utf-8")

    def test_official_gauntlet_two_results_are_baked_for_api_outages(self):
        required = {
            "Perennial Autonomy": "80.1",
            "Hyperscale": "70.9",
            "Neros": "88.1",
            "ORQA US LLC": "82.8",
            "XTEND Reality Inc.": "80.2",
            "Vector": "78.2",
            "ModalAI Inc.": "74.3",
        }
        for company, points in required.items():
            with self.subTest(company=company):
                self.assertIn(company, self.source)
                self.assertIn(f"points:{points}", self.source)
        self.assertIn("https://drone-dominance.io/leaderboard.html", self.source)
        self.assertIn("Official Gauntlet II Results", self.source)

    def test_live_data_failure_is_disclosed(self):
        self.assertIn("_ddg2Source='fallback'", self.source)
        self.assertIn("CACHED SNAPSHOT", self.source)
        self.assertIn("The live DDG feed is unavailable", self.source)
        self.assertIn("currentResults", self.source)
        self.assertIn("d.official_results.deep_strike.length === 5", self.source)

    def test_stale_pre_results_copy_is_removed(self):
        for stale in (
            ">JUL 02<",
            "Gauntlet II set for Fort Carson",
            "8 production awards, 5 long-range + 3 close-quarters",
        ):
            with self.subTest(stale=stale):
                self.assertNotIn(stale, self.source)


if __name__ == "__main__":
    unittest.main()
