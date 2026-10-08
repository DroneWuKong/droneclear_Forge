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
                self.assertEqual(len(archive.namelist()), 16)
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
