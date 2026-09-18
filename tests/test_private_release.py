import importlib.util
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_ddg_template_resolves_published_state_and_roster_math():
    html = (ROOT / "forge-source" / "ddg.html").read_text(encoding="utf-8")
    assert "COMPLETE · RESULTS PUBLISHED" in html
    assert "Ten Top-5 placements" in html
    assert "rs.action_needed && rs.banner && !resultRows.length" in html

    marker = "Qualifier Only / Not Advanced · 30"
    section = html.split(marker, 1)[1].split("</ul>", 1)[0]
    assert section.count("<li>") == 30
    for advanced in ("Grim Tech", "Hyperscale", "ORQA US", "Perennial Autonomy", "Renegade UxS"):
        assert f"<li>{advanced}" not in section
    for not_advanced in ("Ewing Aerospace", "Farage Precision", "Halo Aeronautics", "Mithril Defense", "W.S. Darley"):
        assert f"<li>{not_advanced}" in section


def test_release_auditor_expected_results_are_ten_placements_nine_companies():
    spec = importlib.util.spec_from_file_location(
        "audit_private_release", ROOT / "tools" / "audit_private_release.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert len(module.EXPECTED) == 10
    assert len({company for company, _score in module.EXPECTED.values()}) == 9


def test_result_briefs_match_official_scores():
    briefs = ROOT / "forge-source" / "private" / "result-dossiers"
    assert "| Deep Strike | 1 | 80.1 |" in (briefs / "perennial-autonomy.md").read_text()
    assert "| Deep Strike | 2 | 70.9 |" in (briefs / "hyperscale.md").read_text()
