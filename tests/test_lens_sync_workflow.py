"""Exercise the workflow's actual validator command against split checkouts."""
import json
from pathlib import Path
import re
import shutil
import shlex
import subprocess
import sys
import tempfile
import textwrap
import unittest

WORKFLOW = Path(__file__).resolve().parents[1]/'.github/workflows/sync-lens-fallbacks.yml'


def step(name):
    text = WORKFLOW.read_text(encoding='utf-8')
    match = re.search(r'^      - name: '+re.escape(name)+r'\n(.*?)(?=^      - |\Z)', text, flags=re.MULTILINE|re.DOTALL)
    if not match:
        raise AssertionError(f'Missing workflow step: {name}')
    return match.group(1)


class LensSyncWorkflowTests(unittest.TestCase):
    def test_artifact_and_validator_checkouts_have_separate_explicit_authorities(self):
        data = step('Check out generated lens data')
        source = step('Check out source validator')
        self.assertRegex(data, r'(?m)^          ref: automation/patterns-data$')
        self.assertRegex(data, r'(?m)^          path: _aiproj$')
        self.assertNotIn('scripts/validate_intel_lens_outputs.py', data)
        self.assertRegex(source, r'(?m)^          ref: main$')
        self.assertRegex(source, r'(?m)^          path: _aiproj_validator$')
        self.assertIn('scripts/validate_intel_lens_outputs.py', source)
        self.assertNotIn('data/', source)
        revisions = step('Record immutable input revisions')
        self.assertIn('git -C _aiproj rev-parse HEAD', revisions)
        self.assertIn('git -C _aiproj_validator rev-parse HEAD', revisions)

    def run_validation(self, valid):
        command = textwrap.dedent(step('Validate source artifacts').split('run: |\n', 1)[1]).replace('\\\n', '')
        argv = shlex.split(command)
        self.assertEqual(argv[0], 'python')
        argv[0] = sys.executable
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for folder in ('_aiproj/data', '_aiproj/scripts', '_aiproj_validator/scripts', '_aiproj_validator/data'):
                (root/folder).mkdir(parents=True, exist_ok=True)
            (root/'tools').mkdir()
            shutil.copy2(WORKFLOW.parents[2]/'tools/select_lens_snapshot.py', root/'tools/select_lens_snapshot.py')
            names = ('sanctions_evasion_graph', 'adversary_bom', 'component_mirroring_index', 'actor_fingerprints', 'article_event_clusters', 'ttp_counter_gap', 'threat_scores')
            for name in names:
                (root/'_aiproj/data'/f'{name}.json').write_text(json.dumps({'valid':valid,'revision':'generated-data'}))
            (root/'_aiproj/data/intel-db').mkdir()
            (root/'_aiproj/data/intel-db/articles.json').write_text('[]')
            subprocess.run(['git','init','-q',str(root/'_aiproj')], check=True)
            subprocess.run(['git','-C',str(root/'_aiproj'),'add','.'], check=True)
            subprocess.run(['git','-C',str(root/'_aiproj'),'-c','user.name=Fixture','-c','user.email=fixture@local','commit','-qm','fixture'], check=True)
            (root/'_aiproj_validator/data/fixture.json').write_text('{"valid":false,"revision":"stale-source-data"}', encoding='utf-8')
            (root/'_aiproj/scripts/validate_intel_lens_outputs.py').write_text('raise RuntimeError("obsolete data-branch validator executed")', encoding='utf-8')
            (root/'_aiproj_validator/scripts/validate_intel_lens_outputs.py').write_text(textwrap.dedent('''
                import argparse,json
                from pathlib import Path
                parser=argparse.ArgumentParser()
                parser.add_argument('--data-dir',type=Path,required=True)
                parser.add_argument('--max-age-hours',type=int,required=True)
                parser.add_argument('--max-source-age-days',type=int,required=True)
                parser.add_argument('--sentinel',required=True)
                args=parser.parse_args()
                assert args.max_age_hours==36 and args.max_source_age_days==14
                assert args.sentinel=='-'
                data=json.loads((args.data_dir/'actor_fingerprints.json').read_text())
                print(json.dumps({'validator':'source-main','data':data}))
                raise SystemExit(0 if data['valid'] else 1)
            '''), encoding='utf-8')
            argv = [arg.replace('$RUNNER_TEMP', str(root)) for arg in argv]
            result = subprocess.run(argv, cwd=root, capture_output=True, text=True)
            if valid:
                self.assertEqual(json.loads((root/'validated-lens/actor_fingerprints.json').read_text())['revision'], 'generated-data')
            else:
                self.assertFalse((root/'validated-lens').exists())
            return result

    def test_real_workflow_command_uses_current_validator_and_generated_data(self):
        result = self.run_validation(True)
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload['selection'], 'head')

    def test_invalid_generated_data_still_stops_publication(self):
        result = self.run_validation(False)
        self.assertEqual(result.returncode, 1)
        self.assertIn('No fresh, consistent lens snapshot', result.stderr)
        text = WORKFLOW.read_text(encoding='utf-8')
        self.assertLess(text.index('- name: Validate source artifacts'), text.index('- name: Copy validated static fallbacks'))
        self.assertNotIn('continue-on-error', step('Validate source artifacts'))
        self.assertNotIn('if: always()', step('Copy validated static fallbacks'))
        self.assertIn('cp "$RUNNER_TEMP/validated-lens/${name}.json" "forge-source/${name}.json"', step('Copy validated static fallbacks'))


if __name__ == '__main__':
    unittest.main()
