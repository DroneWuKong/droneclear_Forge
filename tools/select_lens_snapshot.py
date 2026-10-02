"""Select a fresh, internally consistent immutable lens snapshot from Git.

Article writers can advance the generated branch before all derived lenses
have been regenerated. Never combine files from different commits or relax
the upstream validator. A retained earlier snapshot is disclosed explicitly.
"""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import tempfile

NAMES = ('sanctions_evasion_graph', 'adversary_bom', 'component_mirroring_index',
         'actor_fingerprints', 'article_event_clusters', 'ttp_counter_gap', 'threat_scores')
INPUTS = tuple('data/' + name + '.json' for name in NAMES) + ('data/intel-db/articles.json',)


def select_snapshot(repo, validator, output, receipt, *, ref='HEAD', history=30):
    repo, output, receipt = Path(repo), Path(output), Path(receipt)
    def git(*args):
        return subprocess.run(['git', '-C', str(repo), *args], check=True, capture_output=True).stdout
    head = git('rev-parse', '--verify', ref + '^{commit}').decode().strip()
    commits = git('log', head, '--format=%H', '--max-count=' + str(history)).decode().splitlines()
    rejected = []
    for sha in commits:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            try:
                for path in INPUTS:
                    target = root / path
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(git('show', sha + ':' + path))
                result = subprocess.run([sys.executable, str(validator), '--data-dir', str(root / 'data'),
                    '--max-age-hours', '36', '--max-source-age-days', '14', '--sentinel', '-'],
                    capture_output=True, text=True, timeout=90)
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
                rejected.append({'revision': sha, 'reason': type(exc).__name__})
                continue
            if result.returncode:
                rejected.append({'revision': sha, 'reason': (result.stdout + result.stderr)[-1600:]})
                continue
            output.mkdir(parents=True, exist_ok=True)
            for name in NAMES:
                (output / (name + '.json')).write_bytes((root / 'data' / (name + '.json')).read_bytes())
            payload = {'schema_version': 1, 'head_revision': head, 'selected_revision': sha,
                'applies_to': 'repository_static_lens_fallbacks',
                'selection': 'head' if sha == head else 'retained_validated_snapshot',
                'max_artifact_age_hours': 36, 'max_source_age_days': 14, 'rejected_snapshots': rejected}
            receipt.parent.mkdir(parents=True, exist_ok=True)
            receipt.write_text(json.dumps(payload, indent=2) + '\n')
            return payload
    raise RuntimeError('No fresh, consistent lens snapshot passed validation; existing fallbacks were retained')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--validator', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--receipt', type=Path, required=True)
    parser.add_argument('--history', type=int, default=30)
    args = parser.parse_args()
    if not 1 <= args.history <= 100:
        parser.error('history must be between 1 and 100')
    payload = select_snapshot(args.repo, args.validator, args.output, args.receipt, history=args.history)
    print(json.dumps(payload))
    if payload['selection'] != 'head':
        print('::warning::Generated branch head was inconsistent; retained a fresh validated immutable snapshot')


if __name__ == '__main__':
    main()
