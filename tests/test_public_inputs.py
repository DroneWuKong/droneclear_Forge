import json
import subprocess
import sys
from pathlib import Path
import tempfile
import unittest
from tools.public_inputs import sync_public_inputs, selected_public_hashes, public_artifact_hashes


class PublicInputs(unittest.TestCase):
    def test_selected_public_inputs_replace_stale_mirrors_without_exporting_private_files(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)/'data'; dest=Path(temp)/'source'
            (root/'intel-db').mkdir(parents=True); dest.mkdir()
            (root/'intel-db/articles.json').write_text('[{"aid":"current"}]', encoding='utf-8')
            (root/'flags.json').write_text('[{"id":"flag"}]', encoding='utf-8')
            (root/'forecast_review_queue.json').write_text('{"records":[]}', encoding='utf-8')
            (root/'private.json').write_text('{"secret":"never copy"}', encoding='utf-8')
            (dest/'intel_articles.json').write_text('[{"aid":"old"}]', encoding='utf-8')
            result=sync_public_inputs(root,dest,'a'*40)
            self.assertEqual(json.loads((dest/'intel_articles.json').read_text(encoding='utf-8'))[0]['aid'],'current')
            self.assertEqual((dest/'flags.json').read_bytes(),(dest/'pie_flags.json').read_bytes())
            self.assertFalse((dest/'private.json').exists())
            self.assertEqual(result['upstream_ref'],'a'*40)
            self.assertEqual(result['inputs']['entity_graph.json']['status'],'missing_in_selected_input')

    def test_invalid_selected_input_fails_instead_of_reverting_to_old_data(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)/'data'; dest=Path(temp)/'source'; root.mkdir();dest.mkdir()
            (root/'flags.json').write_text('broken',encoding='utf-8')
            (dest/'flags.json').write_text('[]',encoding='utf-8')
            with self.assertRaises(json.JSONDecodeError): sync_public_inputs(root,dest)

    def test_missing_selected_inputs_preserve_explicit_fallback_hashes(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)/'data'; dest=Path(temp)/'source';root.mkdir();dest.mkdir()
            (root/'flags.json').write_text('[{"id":"selected"}]',encoding='utf-8')
            (dest/'entity_graph.json').write_text('{"entities":{"old":{}}}',encoding='utf-8')
            result=sync_public_inputs(root,dest,'a'*40,verified_revision=True)
            self.assertEqual(result['publication_consistency'],'mixed_sources')
            selected=result['inputs']['flags.json']; fallback=result['inputs']['entity_graph.json']
            self.assertEqual(selected['origin'],'pinned_selected_input')
            self.assertEqual(selected['upstream_ref'],'a'*40)
            self.assertEqual(fallback['origin'],'retained_local_fallback')
            self.assertIsNone(fallback['upstream_ref'])
            self.assertEqual(len(fallback['fallback_artifacts']['entity_graph.json']['sha256']),64)

    def test_directory_revision_argument_alone_is_not_verification(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)/'data';dest=Path(temp)/'source';root.mkdir()
            (root/'flags.json').write_text('[]',encoding='utf-8')
            result=sync_public_inputs(root,dest,'a'*40)
            self.assertFalse(result['revision_verified'])
            self.assertEqual(result['inputs']['flags.json']['origin'],'explicit_directory')
            self.assertIsNone(result['inputs']['flags.json']['upstream_ref'])

    def test_public_manifests_exclude_private_names_and_hashes(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)/'data';dest=Path(temp)/'source';root.mkdir()
            (root/'flags.json').write_text('[]',encoding='utf-8')
            (root/'private.json').write_text('{"secret":"not public"}',encoding='utf-8')
            result=sync_public_inputs(root,dest)
            self.assertEqual(set(selected_public_hashes(result)),{'flags.json'})
            (dest/'private'/'dossiers').mkdir(parents=True)
            (dest/'private'/'dossiers'/'private_company.md').write_text('private',encoding='utf-8')
            (dest/'forge_orqa_configs.json').write_text('{"private":true}',encoding='utf-8')
            (dest/'.env').write_text('hidden=true',encoding='utf-8')
            hashes=public_artifact_hashes(dest)
            self.assertNotIn('private/dossiers/private_company.md',hashes)
            self.assertNotIn('forge_orqa_configs.json',hashes)
            self.assertNotIn('.env',hashes)
            self.assertIn('flags.json',hashes)

    def test_online_build_rejects_a_second_unpinned_input_directory(self):
        repo=Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as temp:
            result=subprocess.run([sys.executable,str(repo/'build_static.py'),'--data-ref','a'*40,'--data-dir',temp],cwd=repo,capture_output=True,text=True)
            self.assertEqual(result.returncode,2)
            self.assertIn('--data-dir is an offline input',result.stderr)

    def test_default_offline_snapshot_has_explicit_untracked_input_manifest(self):
        with tempfile.TemporaryDirectory() as temp:
            dest=Path(temp)
            (dest/'pie_flags.json').write_text('[{"id":"local"}]',encoding='utf-8')
            (dest/'private.json').write_text('{"secret":"not public"}',encoding='utf-8')
            # A copied prior publication claim must be replaced for this local snapshot.
            (dest/'publication_inputs.json').write_text('{"upstream_ref":"old"}',encoding='utf-8')
            result=sync_public_inputs(None,dest)
            self.assertEqual(result['publication_consistency'],'local_snapshot')
            self.assertIsNone(result['upstream_ref'])
            written=json.loads((dest/'publication_inputs.json').read_text(encoding='utf-8'))
            self.assertEqual(written['publication_consistency'],'local_snapshot')
            self.assertIsNone(written['upstream_ref'])
            row=result['inputs']['flags.json']
            self.assertEqual(row['origin'],'untracked_local_input')
            self.assertFalse(row['revision_verified'])
            self.assertEqual(len(row['fallback_artifacts']['pie_flags.json']['sha256']),64)
            self.assertNotIn('private.json',result['inputs'])
            self.assertEqual(selected_public_hashes(result),{})



if __name__=='__main__': unittest.main()
