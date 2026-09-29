import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('private_evidence', ROOT / 'tools/private_evidence.py')
evidence = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evidence)
REF = 'a' * 40


def put(root, path, value):
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(value), encoding='utf-8')


@pytest.fixture
def corpus(tmp_path):
    source = tmp_path / 'research/profiles/example.md'
    source.parent.mkdir(parents=True)
    source.write_text('# Example\nExample Radio integration in Example Aircraft is unverified.\n', encoding='utf-8')
    graph = {'nodes': [
        {'id': 'a', 'label': 'Example Radio', 'kind': 'company'},
        {'id': 'b', 'label': 'Example Aircraft', 'kind': 'platform'},
    ], 'links': [{
        'source': 'a', 'target': 'b', 'relation': 'unverified_supply_claim',
        'confidence': 'EXTRACTED', 'assertion': 'disputed',
        'source_file': 'research/profiles/example.md', 'source_location': 'L2',
        'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'excerpt': source.read_text().splitlines()[1],
        'source_urls': ['https://example.com/statement'],
    }]}
    put(tmp_path, evidence.GRAPH_PATH, graph)
    put(tmp_path, 'data/ddg_supply_links.json', {'meta': {'generated': '2026-01-01'}, 'suppliers': [{
        'supplier': 'Example Radio', 'component': 'Radio model A', 'subsystem': 'rf_datalink',
        'sources': ['https://example.com/catalog'],
        'feeds': [{'platform': 'Example Aircraft', 'confidence': 'C'}],
    }]})
    return tmp_path, graph


def candidate(payload):
    return next(r for r in payload['relationships'] if r['origin'] == 'graphify_candidate')


def test_extraction_never_becomes_confirmation_and_conflict_preserves_both(corpus):
    root, _ = corpus
    original = (root / 'data/ddg_supply_links.json').read_bytes()
    result = evidence.build_evidence(root, REF)
    assert {k: result['summary'][k] for k in ['supply_links', 'candidates', 'conflicted_records', 'rejected_candidates']} == {'supply_links': 1, 'candidates': 1, 'conflicted_records': 2, 'rejected_candidates': 0}
    assert all(r['review_status'] == 'needs_review' and r['verified_on'] is None for r in result['relationships'])
    legacy = next(r for r in result['relationships'] if r['origin'] == 'legacy_supply')
    assert legacy['legacy_confidence'] == 'C'
    assert legacy['evidence_scope'] == 'supplier'
    assert (root / 'data/ddg_supply_links.json').read_bytes() == original
    assert evidence.build_evidence(root, REF) == result


def test_review_expires_on_changed_document_and_publication_never_refreshes_date(corpus):
    root, _ = corpus
    row = candidate(evidence.build_evidence(root, REF))
    put(root, evidence.REVIEWS_PATH, {'reviews': [{'record_id': row['id'], 'fingerprint': row['fingerprint'],
        'status': 'disputed', 'reviewed_on': '2026-02-03', 'reviewer': 'Analyst', 'rationale': 'Compared both sources.'}]})
    reviewed = candidate(evidence.build_evidence(root, 'b' * 40))
    assert reviewed['review_status'] == 'disputed'
    assert reviewed['verified_on'] == '2026-02-03'
    path = root / 'research/profiles/example.md'
    path.write_text(path.read_text() + 'Later correction.\n')
    stale = candidate(evidence.build_evidence(root, 'c' * 40))
    assert stale['review_status'] == 'stale_review'
    assert stale['verified_on'] is None
    assert len(stale['review_history']) == 1
    assert any('fingerprint' in g for g in stale['review_gaps'])


@pytest.mark.parametrize('source', ['../outside.md', '/etc/passwd', 'data/private.md'])
def test_source_traversal_is_rejected(corpus, source):
    root, graph = corpus
    graph['links'][0]['source_file'] = source
    put(root, evidence.GRAPH_PATH, graph)
    result = evidence.build_evidence(root, REF)
    assert result['summary']['candidates'] == 0
    assert len(result['rejected_candidates']) == 1


def test_quote_and_line_mismatch_cannot_be_reviewed(corpus):
    root, graph = corpus
    graph['links'][0]['excerpt'] = 'Fabricated source text'
    put(root, evidence.GRAPH_PATH, graph)
    row = candidate(evidence.build_evidence(root, REF))
    assert not row['evidence'][0]['passage_matches']
    put(root, evidence.REVIEWS_PATH, {'reviews': [{'record_id': row['id'], 'fingerprint': row['fingerprint'],
        'status': 'supported', 'reviewed_on': '2026-02-03', 'reviewer': 'Analyst', 'rationale': 'Attempted approval.'}]})
    assert candidate(evidence.build_evidence(root, REF))['review_status'] == 'stale_review'


def test_parallel_relations_alias_boundaries_and_safe_urls(corpus):
    root, graph = corpus
    graph['links'].append({**graph['links'][0], 'relation': 'partnered_with', 'assertion': 'affirmed'})
    graph['nodes'].append({'id': 'c', 'label': 'Example Radio Holdings', 'kind': 'company'})
    graph['links'].append({**graph['links'][0], 'source': 'c', 'relation': 'owns', 'assertion': 'affirmed'})
    graph['links'][0]['source_urls'] += ['javascript:alert(1)', 'file:///etc/passwd', 'https://user:pass@example.com/']
    put(root, evidence.GRAPH_PATH, graph)
    result = evidence.build_evidence(root, REF)
    assert result['summary']['candidates'] == 3
    assert len(result['nodes']) == 3
    assert result['summary']['conflicted_records'] == 2
    assert all(url.startswith('https://example.com/') for row in result['relationships'] for e in row['evidence'] for url in e['urls'])


def test_no_candidate_file_keeps_legacy_evidence_available(corpus):
    root, _ = corpus
    (root / evidence.GRAPH_PATH).unlink()
    output = root / 'build/private/relationships.json'
    result = evidence.write_evidence(root, REF, output)
    assert result['summary']['candidates'] == 0
    assert json.loads(output.read_text()) == result
    with pytest.raises(ValueError):
        evidence.build_evidence(root, 'main')


def test_node_link_edges_variant_and_forged_review_fields_are_ignored(corpus):
    root, graph = corpus
    graph['edges'] = graph.pop('links')
    graph['edges'][0].update(review_status='supported', verified_on='2026-09-29')
    put(root, evidence.GRAPH_PATH, graph)
    row = candidate(evidence.build_evidence(root, REF))
    assert row['review_status'] == 'needs_review'
    assert row['verified_on'] is None


def test_private_export_emits_hashed_index_and_auditor_detects_tampering(corpus, monkeypatch):
    import os
    import shutil
    import subprocess
    root, _ = corpus
    builder_spec = importlib.util.spec_from_file_location('private_test_builder', ROOT / 'build_static.py')
    builder = importlib.util.module_from_spec(builder_spec)
    builder_spec.loader.exec_module(builder)
    put(root, 'data/ddg2.json', {'official_results': {
        'deep_strike': [{'company': f'Company {i}', 'rank': i+1} for i in range(5)],
        'close_quarters_battle': [{'company': f'Company {i}', 'rank': i-3} for i in range(4,9)],
    }})
    out = root / 'output/private'
    monkeypatch.setattr(builder, 'BUILD_DIR', str(out.parent))
    monkeypatch.setattr(builder, 'SRC_DIR', str(ROOT / 'forge-source'))
    monkeypatch.setenv('GITHUB_PAT', 'test-only')
    monkeypatch.setenv('PATTERNS_PINNED_DATA_REF', REF)
    def fake_git(command, **kwargs):
        if command[1] == 'clone':
            for directory in ['research', 'data']:
                shutil.copytree(root / directory, Path(command[-1]) / directory)
        else:
            assert command[-3:] == ['checkout', '--detach', REF]
        return subprocess.CompletedProcess(command, 0)
    monkeypatch.setattr(builder.subprocess, 'run', fake_git)
    assert builder.sync_private_dossiers()
    release = json.loads((out / 'release.json').read_text())
    assert release['artifacts']['relationships']['records'] == 2
    assert (out / 'supply_links.json').read_bytes() == (root / 'data/ddg_supply_links.json').read_bytes()
    audit_spec = importlib.util.spec_from_file_location('private_test_audit', ROOT / 'tools/audit_private_release.py')
    audit = importlib.util.module_from_spec(audit_spec)
    audit_spec.loader.exec_module(audit)
    audit.audit_relationships(out, release)
    with (out / 'relationships.json').open('a') as handle:
        handle.write(' ')
    with pytest.raises(AssertionError, match='hash mismatch'):
        audit.audit_relationships(out, release)


def attach_primary(root, graph, supports='claim'):
    sources = {'sources': [{'id': 'source-1', 'title': 'Manufacturer statement', 'publisher': 'Example Manufacturer',
        'url': 'https://example.com/statement', 'kind': 'manufacturer', 'published_on': '2025-01-01',
        'retrieved_on': '2026-09-29', 'locator': 'Integration section', 'summary': 'A bounded manufacturer claim.'}]}
    put(root, evidence.SOURCES_PATH, sources)
    graph['links'][0]['evidence_refs'] = [{'source_id': 'source-1', 'supports': supports}]
    put(root, evidence.GRAPH_PATH, graph)
    return sources


def review(root, row, status='supported', **kwargs):
    put(root, evidence.REVIEWS_PATH, {'reviews': [{'record_id': row['id'], 'fingerprint': row['fingerprint'],
        'status': status, 'review_type': 'source_checked', 'reviewed_on': '2026-09-29',
        'reviewer': 'Test analyst', 'rationale': 'Checked the scoped primary-source claim.', **kwargs}]})


def test_primary_observation_change_expires_review_even_when_note_unchanged(corpus):
    root, graph = corpus
    sources = attach_primary(root, graph)
    row = candidate(evidence.build_evidence(root, REF))
    review(root, row)
    assert candidate(evidence.build_evidence(root, REF))['review_status'] == 'supported'
    sources['sources'][0]['summary'] = 'Corrected source interpretation.'
    put(root, evidence.SOURCES_PATH, sources)
    changed = candidate(evidence.build_evidence(root, REF))
    assert changed['id'] == row['id']
    assert changed['fingerprint'] != row['fingerprint']
    assert changed['review_status'] == 'stale_review'
    assert changed['verified_on'] is None


def test_context_source_cannot_promote_claim_and_missing_source_is_a_gap(corpus):
    root, graph = corpus
    attach_primary(root, graph, 'context')
    row = candidate(evidence.build_evidence(root, REF))
    review(root, row)
    assert candidate(evidence.build_evidence(root, REF))['review_status'] == 'stale_review'
    (root / evidence.SOURCES_PATH).unlink()
    assert 'missing' in ' '.join(candidate(evidence.build_evidence(root, REF))['review_gaps'])


def test_superseded_claim_stays_in_history_without_active_conflict(corpus):
    root, graph = corpus
    attach_primary(root, graph, 'correction')
    row = candidate(evidence.build_evidence(root, REF))
    review(root, row, 'superseded')
    result = evidence.build_evidence(root, REF)
    assert not candidate(result)['active']
    assert candidate(result)['related_record_ids']
    assert result['summary']['conflicted_records'] == 0
    assert result['summary']['resolved'] == 1


def test_different_component_roles_do_not_form_false_conflicts(corpus):
    root, graph = corpus
    graph['links'][0].update(role='optional_relay', component='Different radio')
    put(root, evidence.GRAPH_PATH, graph)
    supply = json.loads((root/'data/ddg_supply_links.json').read_text())
    supply['suppliers'][0]['feeds'][0]['role'] = 'base_datalink'
    put(root, 'data/ddg_supply_links.json', supply)
    result = evidence.build_evidence(root, REF)
    assert result['summary']['conflicted_records'] == 0
    assert candidate(result)['related_record_ids']


def test_legacy_relationship_can_be_reviewed_but_pooled_sources_cannot(corpus):
    root, graph = corpus
    attach_primary(root, graph)
    supply = json.loads((root/'data/ddg_supply_links.json').read_text())
    feed = supply['suppliers'][0]['feeds'][0]
    feed['evidence_refs'] = [{'source_id':'source-1','supports':'claim'}]
    feed.update(role='base_datalink', note='This individual link, not every supplier customer.')
    put(root, 'data/ddg_supply_links.json', supply)
    row = next(r for r in evidence.build_evidence(root, REF)['relationships'] if r['origin']=='legacy_supply')
    assert row['evidence_scope'] == 'relationship'
    assert not row['review_gaps']
    review(root, row)
    result = evidence.build_evidence(root, REF)
    assert result['summary']['supported'] == 1
    feed['role'] = 'optional_relay'
    put(root, 'data/ddg_supply_links.json', supply)
    result = evidence.build_evidence(root, REF)
    assert result['summary']['supported'] == 0


def test_duplicate_sources_fail_and_duplicate_edges_are_reported(corpus):
    root, graph = corpus
    sources = attach_primary(root, graph)
    graph['links'].append(dict(graph['links'][0]))
    put(root, evidence.GRAPH_PATH, graph)
    assert len(evidence.build_evidence(root, REF)['rejected_candidates']) == 1
    sources['sources'].append(dict(sources['sources'][0]))
    put(root, evidence.SOURCES_PATH, sources)
    with pytest.raises(ValueError, match='Duplicate source'):
        evidence.build_evidence(root, REF)


def test_graphify_query_export_excludes_unreviewed_negative_and_retired_claims(corpus):
    root, graph = corpus
    attach_primary(root, graph)
    graph['links'][0]['assertion'] = 'affirmed'
    graph['links'][0]['relation'] = 'supplies_component'
    put(root, evidence.GRAPH_PATH, graph)
    payload = evidence.build_evidence(root, REF)
    assert not evidence.reviewed_graph(payload)['links']
    row = candidate(payload)
    review(root, row)
    payload = evidence.build_evidence(root, REF)
    query = evidence.reviewed_graph(payload)
    assert [r['id'] for r in query['links']] == [row['id']]
    assert len(query['nodes']) == 2
    review(root, row, 'superseded')
    assert not evidence.reviewed_graph(evidence.build_evidence(root, REF))['links']


def test_review_cli_rejects_stale_fingerprint_and_records_explicit_actor(corpus):
    import subprocess
    import sys
    root, graph = corpus
    attach_primary(root, graph)
    row = candidate(evidence.build_evidence(root, REF))
    args = [sys.executable, str(ROOT/'tools/review_private_evidence.py'), '--upstream-dir', str(root),
            '--upstream-ref', REF, '--record-id', row['id'], '--status', 'not_supported',
            '--reviewer', 'Actual reviewer', '--reviewed-on', '2026-09-29', '--rationale', 'Source describes a different variant.',
            '--expected-fingerprint']
    assert subprocess.run(args + ['wrong'], capture_output=True).returncode != 0
    assert not (root/evidence.REVIEWS_PATH).exists()
    assert subprocess.run(args + [row['fingerprint']], capture_output=True).returncode == 0
    reviewed = candidate(evidence.build_evidence(root, REF))
    assert reviewed['review_status'] == 'not_supported'
    assert reviewed['review_history'][-1]['reviewer'] == 'Actual reviewer'
