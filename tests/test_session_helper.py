import hashlib
import importlib.util
import io
import json
from pathlib import Path
import socket
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bridge', ROOT / 'forge-source/session-helper/bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
from tools.build_session_recorder import export_recorder


def bundle():
    evidence = b'original-flight-log'
    session = {'tool': 'forge-uas-session', 'schema_version': 1, 'id': 'fixture-session-0001',
               'title': 'Test session', 'certification': False, 'program_acceptance': False,
               'state': 'finished', 'files': [{'name': 'originals/fixture-0001/flight.ulg',
                  'size': len(evidence), 'sha256': hashlib.sha256(evidence).hexdigest()}]}
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', compression=zipfile.ZIP_STORED) as archive:
        archive.writestr('session.json', json.dumps(session))
        archive.writestr('timeline.json', '[]')
        archive.writestr('summary.txt', 'Fixture support report')
        archive.writestr('originals/fixture-0001/flight.ulg', evidence)
    return buf.getvalue()


def edit_bundle(data, edit):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        files = {name: archive.read(name) for name in archive.namelist()}
    edit(files)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', compression=zipfile.ZIP_STORED) as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return buf.getvalue()


class Reply:
    status = 200
    def __init__(self, data):
        self.data = json.dumps(data).encode()
    def __enter__(self): return self
    def __exit__(self, *_): pass
    def read(self, *_): return self.data


class HelperTests(unittest.TestCase):
    def test_package_is_reproducible_and_contains_only_selected_public_assets(self):
        with tempfile.TemporaryDirectory() as tmp:
            a, b = Path(tmp) / 'a', Path(tmp) / 'b'
            self.assertEqual(export_recorder(ROOT / 'forge-source', a), export_recorder(ROOT / 'forge-source', b))
            with zipfile.ZipFile(a / 'session-recorder/forge-session-helper.zip') as archive:
                self.assertIn('bridge.py', archive.namelist())
                self.assertIn('static/session-recorder.js', archive.namelist())
                self.assertIn('SOP.md', archive.namelist())
                self.assertEqual(len(archive.namelist()), 20)
                self.assertFalse(any('.env' in p or 'private' in p for p in archive.namelist()))
                package = Path(tmp) / 'local-app'
                archive.extractall(package)
            server = bridge.create_server(package, http_port=0, udp_port=0, key='fixture-key')
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            url = 'http://127.0.0.1:' + str(server.server_address[1])
            try:
                for route in ('/session-recorder/', '/session-recorder/sw.js',
                              '/session-recorder/SOP.md', '/session-recorder/app.webmanifest',
                              '/static/session-recorder.js', '/system-tests/profiles.json'):
                    with urllib.request.urlopen(url + route) as response:
                        self.assertEqual(response.status, 200)
                        self.assertGreater(len(response.read()), 20)
                html = (package / 'session-recorder.html').read_text()
                self.assertIn('href="https://uas-forge.com/test-lab/"', html)
                self.assertNotIn('href="/test-lab/"', html)
            finally:
                server.telemetry.closed.set();server.udp.close()
                server.shutdown();server.server_close();thread.join()

    def test_udp_copy_and_authenticated_origin_restrictions(self):
        server = bridge.create_server(ROOT / 'forge-source', http_port=0, udp_port=0, key='fixture-key')
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        url = 'http://127.0.0.1:' + str(server.server_address[1])
        try:
            for headers in ({}, {'X-Forge-Key': 'wrong'}, {'X-Forge-Key': 'fixture-key', 'Origin': 'https://other.example'}, {'X-Forge-Key': 'fixture-key', 'Host': 'rebound.example'}):
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(urllib.request.Request(url + '/status', headers=headers))
                self.assertEqual(error.exception.code, 403)
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.sendto(b'original-datagram', ('127.0.0.1', server.udp_port));sock.close()
            deadline = time.monotonic() + 2
            while not server.telemetry.cursor and time.monotonic() < deadline: time.sleep(0.01)
            req = urllib.request.Request(url + '/telemetry?after=0', headers={'X-Forge-Key': 'fixture-key', 'Origin': 'https://uas-forge.com'})
            with urllib.request.urlopen(req) as response:
                data = json.load(response)
                self.assertEqual(response.headers['Access-Control-Allow-Origin'], 'https://uas-forge.com')
            self.assertEqual(data['packets'][0]['data'], 'b3JpZ2luYWwtZGF0YWdyYW0=')
            self.assertEqual(data['gap'], 0)
        finally:
            server.telemetry.closed.set();server.udp.close();server.shutdown();server.server_close();thread.join()

    def test_gap_is_reported_after_buffer_overrun(self):
        telemetry = bridge.Telemetry()
        telemetry.cursor = 10
        telemetry.packets.extend([{'id': n} for n in range(7, 11)])
        self.assertEqual(telemetry.after(2)['gap'], 4)

    def test_field_folder_replaces_atomically_and_reopens_after_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / 'field'
            archive = bridge.FieldArchive(folder)
            first = bundle()
            result = archive.save(first)
            self.assertEqual(result['sha256'], hashlib.sha256(first).hexdigest())
            self.assertEqual(archive.read(result['id']), first)
            updated = edit_bundle(first, lambda files: files.update({'summary.txt': b'Updated support report'}))
            archive.save(updated)
            restarted = bridge.FieldArchive(folder)
            self.assertEqual(restarted.read(result['id']), updated)
            self.assertEqual(restarted.list()['sessions'][0]['id'], result['id'])
            self.assertEqual(len(list(folder.iterdir())), 1)
            tampered = edit_bundle(first, lambda files: files.update({'originals/fixture-0001/flight.ulg': b'tampered'}))
            with self.assertRaises(ValueError): restarted.save(tampered)
            self.assertEqual(restarted.read(result['id']), updated)
            with self.assertRaises(ValueError): restarted.read('../outside')
            malformed = edit_bundle(first, lambda files: files.update({'session.json': b'[]'}))
            with self.assertRaises(ValueError): restarted.save(malformed)
            (folder / 'forge-session-invalid-metadata.zip').write_bytes(malformed)
            self.assertEqual(len(restarted.list()['sessions']), 1)
            # File browser edits and symlinks must not expose arbitrary local files.
            outside = Path(tmp) / 'outside.zip'
            outside.write_bytes(first)
            link = folder / 'forge-session-symlink-session.zip'
            try:
                link.symlink_to(outside)
            except OSError:  # Windows runners can lack symlink privileges.
                return
            with self.assertRaises(ValueError): restarted.read('symlink-session')
            self.assertEqual(len(restarted.list()['sessions']), 1)

    def test_standalone_bootstrap_and_disk_endpoints_are_local_and_authenticated(self):
        with tempfile.TemporaryDirectory() as tmp:
            server = bridge.create_server(ROOT / 'forge-source', http_port=0, udp_port=0,
                key='fixture-key', standalone=True, session_directory=Path(tmp) / 'field')
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            url = 'http://127.0.0.1:' + str(server.server_address[1])
            def request(route, headers=None, data=None):
                return urllib.request.urlopen(urllib.request.Request(url + route, headers=headers or {}, data=data))
            try:
                for headers in ({}, {'X-Forge-Local': '1', 'Origin': 'https://uas-forge.com'},
                        {'X-Forge-Local': '1', 'Origin': 'https://attacker.example'},
                        {'X-Forge-Local': '1', 'Sec-Fetch-Site': 'cross-site'},
                        {'X-Forge-Local': '1', 'Host': 'attacker.example'}):
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        request('/local-config', headers)
                    self.assertEqual(error.exception.code, 403)
                with request('/local-config', {'X-Forge-Local': '1', 'Origin': url,
                                               'Sec-Fetch-Site': 'same-origin'}) as response:
                    self.assertEqual(response.headers['Cache-Control'], 'no-store')
                    self.assertEqual(json.load(response)['key'], 'fixture-key')
                headers = {'X-Forge-Key': 'fixture-key'}
                for route in ('/archives', '/archive/fixture-session-0001'):
                    with self.assertRaises(urllib.error.HTTPError) as error: request(route)
                    self.assertEqual(error.exception.code, 403)
                with self.assertRaises(urllib.error.HTTPError) as error:
                    request('/archive', {'Content-Type': 'application/zip'}, bundle())
                self.assertEqual(error.exception.code, 403)
                with request('/archive', {**headers, 'Content-Type': 'application/zip'}, bundle()) as response:
                    self.assertTrue(json.load(response)['ok'])
                with request('/archives', headers) as response:
                    self.assertEqual(len(json.load(response)['sessions']), 1)
                with request('/archive/fixture-session-0001', headers) as response:
                    self.assertEqual(response.headers['Content-Type'], 'application/zip')
                    self.assertEqual(response.read(), bundle())
                with request('/status', headers) as response:
                    status = json.load(response)
                    self.assertTrue(status['standalone'])
                    self.assertTrue(status['archive_enabled'])
                    self.assertNotIn('key', status)
            finally:
                server.telemetry.closed.set();server.udp.close()
                server.shutdown();server.server_close();thread.join()

    def test_original_hash_validation_rejects_tampered_manifest(self):
        data = bundle();self.assertEqual(bridge.inspect_bundle(data)[0]['id'], 'fixture-session-0001')
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            files = {n: archive.read(n) for n in archive.namelist()}
        files['originals/fixture-0001/flight.ulg'] = b'changed-flight-log'
        out = io.BytesIO()
        with zipfile.ZipFile(out, 'w') as archive:
            for n, content in files.items(): archive.writestr(n, content)
        with self.assertRaises(ValueError): bridge.inspect_bundle(out.getvalue())

    def test_slack_upload_flow_and_completed_retry_send_no_duplicate(self):
        calls = []
        def request(req, **_):
            calls.append(req)
            if req.full_url.endswith('getUploadURLExternal'): return Reply({'ok': True, 'file_id': 'F123', 'upload_url': 'https://files.slack.com/upload/fixture'})
            if req.full_url.endswith('completeUploadExternal'): return Reply({'ok': True, 'files': [{'permalink': 'https://slack.com/files/F123'}]})
            return Reply({})
        with tempfile.TemporaryDirectory() as tmp:
            uploader = bridge.SlackUploader('fixture-token', 'C123', Path(tmp) / 'receipts.json', request=request)
            result = uploader.upload(bundle());self.assertTrue(result['complete']);self.assertEqual(len(calls), 3)
            self.assertNotIn('Authorization', calls[1].headers)
            self.assertEqual(uploader.upload(bundle()), result);self.assertEqual(len(calls), 3)
            self.assertNotIn('fixture-token', (Path(tmp) / 'receipts.json').read_text())

    def test_slack_uncertain_completion_is_preserved_across_restart(self):
        calls = []
        def request(req, **_):
            calls.append(req.full_url)
            if req.full_url.endswith('getUploadURLExternal'): return Reply({'ok': True, 'file_id': 'F123', 'upload_url': 'https://files.slack.com/upload/fixture'})
            if req.full_url.endswith('completeUploadExternal'): raise OSError('timeout')
            return Reply({})
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'receipts.json'
            with self.assertRaises(OSError): bridge.SlackUploader('fixture-token', 'C123', path, request=request).upload(bundle())
            with self.assertRaisesRegex(ValueError, 'uncertain'): bridge.SlackUploader('fixture-token', 'C123', path, request=request).upload(bundle())
            self.assertEqual(len(calls), 3)


if __name__ == '__main__':
    unittest.main()
