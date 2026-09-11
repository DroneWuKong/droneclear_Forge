"""Copy only declared public artifacts from one pinned data tree."""
import hashlib
import json
import re
from pathlib import Path

PUBLIC_INPUTS = {
    'flags.json': ('flags.json', 'pie_flags.json'),
    'predictions.json': ('predictions.json', 'pie_predictions.json'),
    'intel-db/articles.json': ('intel_articles.json',),
    'intel-db/companies.json': ('intel_companies.json',),
    'intel-db/platforms.json': ('intel_platforms.json',),
    'intel-db/programs.json': ('intel_programs.json',),
    'intel-db/miner_health.json': ('miner_health.json',),
    'intel-db/miner_registry.json': ('miner_registry.json',),
    'procurement/solicitations.json': ('solicitations.json',),
    **{name + '.json': (name + '.json',) for name in (
        'dataset_catalog', 'data_quality_score', 'source_coverage_matrix',
        'calibration_scores', 'prediction_outcomes', 'predictions.metadata',
        'prediction_outcomes.metadata', 'forecast_review_queue', 'analytic_judgments',
        'pie_delta', 'pie_brief', 'pie_brief_history', 'pie_trends', 'entity_graph',
        'forge_intel', 'actor_fingerprints', 'ttp_counter_gap', 'article_event_clusters',
        'adversary_bom', 'component_mirroring_index', 'sanctions_evasion_graph',
        'threat_scores', 'market_lens')},
}


def public_artifact_hashes(directory):
    """Inventory public files without disclosing gated artifact names or hashes."""
    root = Path(directory).resolve()
    hashes = {}
    for path in sorted(root.rglob('*')):
        relative = path.relative_to(root)
        if not path.is_file() or path.is_symlink():
            continue
        if any(part.lower() == 'private' or part.startswith('.') for part in relative.parts):
            continue
        if path.name == 'forge_orqa_configs.json':
            continue
        hashes[relative.as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    return hashes


def selected_public_hashes(manifest):
    """Only files actually selected through the public allowlist enter the public inventory."""
    return {row['source_path']: row['sha256'] for row in manifest.get('inputs', {}).values()
            if row.get('status') == 'selected_input' and row.get('source_path') and row.get('sha256')}


def sync_public_inputs(data_dir, destination, revision=None, *, verified_revision=False):
    root, target = Path(data_dir).resolve() if data_dir is not None else None, Path(destination)
    if root is None and (revision is not None or verified_revision):
        raise ValueError('Local snapshots cannot claim a selected upstream revision')
    if verified_revision and not re.fullmatch(r'[a-fA-F0-9]{40}', revision or ''):
        raise ValueError('Verified public inputs require an immutable revision')
    target.mkdir(parents=True, exist_ok=True)
    manifest = {'schema_version': 1, 'upstream_ref': revision,
                'upstream_ref_scope': 'selected_input_rows_only',
                'revision_verified': verified_revision,
                'inputs': {}}
    for relative, names in PUBLIC_INPUTS.items():
        source = root / relative if root is not None else None
        if source is not None and not source.is_file():
            # Explicit flat public-artifact folders are also supported.
            source = next((root / name for name in names if (root / name).is_file()), source)
        if source is None or not source.is_file():
            fallbacks = {}
            for name in names:
                path = target / name
                if path.is_file():
                    raw = path.read_bytes()
                    fallbacks[name] = {'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)}
            manifest['inputs'][relative] = {'status': 'local_snapshot' if root is None else 'missing_in_selected_input',
                'fallback_present': bool(fallbacks), 'destinations': names,
                'origin': ('untracked_local_input' if root is None else 'retained_local_fallback') if fallbacks else 'unavailable',
                'revision_verified': False, 'upstream_ref': None, 'fallback_artifacts': fallbacks}
            continue
        if source.is_symlink() or not source.resolve().is_relative_to(root):
            raise ValueError('Public inputs must be ordinary files inside the selected directory')
        raw = source.read_bytes()
        json.loads(raw.decode('utf-8'))  # Invalid selected inputs cannot silently use an old fallback.
        for name in names:
            (target / name).write_bytes(raw)
        manifest['inputs'][relative] = {'status': 'selected_input',
            'origin': 'pinned_selected_input' if verified_revision else 'explicit_directory',
            'source_path': source.relative_to(root).as_posix(),
            'upstream_ref': revision if verified_revision else None,
            'revision_verified': verified_revision,
            'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw), 'destinations': names}
    mixed = any(row.get('fallback_present') for row in manifest['inputs'].values())
    manifest['publication_consistency'] = 'local_snapshot' if root is None else 'mixed_sources' if mixed else 'pinned_selected_input' if verified_revision else 'explicit_directory'
    (target / 'publication_inputs.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
    return manifest
