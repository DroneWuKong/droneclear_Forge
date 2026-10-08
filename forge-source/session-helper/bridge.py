#!/usr/bin/env python3
"""Local, receive-only MAVLink bridge and explicit Slack session upload.

Python standard library only. No vehicle commands, shell execution, or hosted
session storage. Slack credentials are read from the operator's environment.
"""
import argparse
import base64
from collections import deque
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import re
import secrets
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

LIMIT = 256 * 1024 * 1024
STATIC = ('workspace.css', 'session-recorder.css', 'session-recorder.js',
          'session-evidence.js', 'session-reports.js', 'session-store.js',
          'test-lab.js', 'session-recorder-icon.svg')


class Telemetry:
    def __init__(self):
        self.lock = threading.Lock()
        self.packets = deque(maxlen=2048)
        self.cursor = 0
        self.closed = threading.Event()

    def receive(self, udp):
        udp.settimeout(0.5)
        while not self.closed.is_set():
            try:
                data, _ = udp.recvfrom(65535)
            except socket.timeout:
                continue
            except OSError:
                break
            with self.lock:
                self.cursor += 1
                self.packets.append({'id': self.cursor, 'received_unix_ns': str(time.time_ns()),
                                     'data': base64.b64encode(data).decode('ascii')})

    def after(self, cursor):
        with self.lock:
            first = self.packets[0]['id'] if self.packets else self.cursor + 1
            return {'ok': True, 'cursor': self.cursor,
                    'gap': max(0, first - cursor - 1),
                    'packets': [p for p in self.packets if p['id'] > cursor][:256]}


def inspect_bundle(data):
    """Check file integrity without extracting anything to the filesystem."""
    if len(data) > LIMIT:
        raise ValueError('Session ZIP exceeds 256 MiB.')
    fixed = {'session.json', 'timeline.json', 'summary.txt', 'report.md', 'report.json',
             'screen.webm', 'screen.mp4', 'camera.webm', 'camera.mp4',
             'telemetry.mavlink', 'telemetry.tlog', 'telemetry-receipts.jsonl'}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        if not 3 <= len(entries) <= 96 or len({f.filename for f in entries}) != len(entries):
            raise ValueError('Invalid session ZIP directory.')
        for f in entries:
            name = f.filename
            if (f.compress_type != zipfile.ZIP_STORED or f.flag_bits & 1 or
                    f.file_size > LIMIT or f.file_size != f.compress_size or
                    (name not in fixed and (not re.fullmatch(
                        r'originals/[a-z0-9-]{8,80}/[a-zA-Z0-9][a-zA-Z0-9._-]{0,160}', name)
                        or '..' in name))):
                raise ValueError('Unsupported session ZIP entry.')
        if archive.getinfo('session.json').file_size > 1048576:
            raise ValueError('Session metadata exceeds 1 MiB.')
        session = json.loads(archive.read('session.json'))
        if (session.get('tool') != 'forge-uas-session' or session.get('schema_version') != 1
                or session.get('certification') is not False
                or session.get('program_acceptance') is not False
                or session.get('state') not in ('finished', 'interrupted')
                or not re.fullmatch(r'[-a-zA-Z0-9]{8,80}', session.get('id', ''))):
            raise ValueError('Invalid session identity or scope.')
        files = session.get('files', [])
        if not isinstance(files, list) or len(files) > 80:
            raise ValueError('Invalid evidence manifest.')
        expected = {'session.json', 'timeline.json', 'summary.txt'}
        for f in files:
            name = f['name']
            if name in expected:
                raise ValueError('Duplicate evidence file.')
            expected.add(name)
            info = archive.getinfo(name)
            if info.file_size != f['size']:
                raise ValueError('Evidence size differs from manifest.')
            digest = hashlib.sha256()
            with archive.open(name) as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                    digest.update(chunk)
            if digest.hexdigest() != f['sha256']:
                raise ValueError('Evidence hash differs from manifest.')
        if expected != {f.filename for f in entries}:
            raise ValueError('Unexpected or missing session files.')
        if archive.getinfo('summary.txt').file_size > 1048576:
            raise ValueError('Summary exceeds 1 MiB.')
        return session, archive.read('summary.txt').decode('utf-8')[:2800]


class SlackUploader:
    def __init__(self, token, channel, receipt_path, request=urllib.request.urlopen):
        self.token, self.channel = token, channel
        self.receipt_path, self.request = Path(receipt_path), request
        self.lock = threading.Lock()
        try:
            self.receipts = json.loads(self.receipt_path.read_text())
        except (OSError, ValueError):
            self.receipts = {}

    def save(self):
        self.receipt_path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.receipt_path.with_suffix('.tmp')
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(self.receipts, stream)
        temp.replace(self.receipt_path)

    def api(self, method, values):
        request = urllib.request.Request('https://slack.com/api/' + method,
                   data=urllib.parse.urlencode(values).encode(),
                   headers={'Authorization': 'Bearer ' + self.token,
                            'Content-Type': 'application/x-www-form-urlencoded'})
        try:
            with self.request(request, timeout=60) as response:
                data = json.loads(response.read(1048576))
        except urllib.error.HTTPError as error:
            raise ValueError('Slack API returned HTTP ' + str(error.code) + '.') from None
        if not data.get('ok'):
            raise ValueError('Slack: ' + str(data.get('error', 'request_failed')))
        return data

    def upload(self, data):
        session, summary = inspect_bundle(data)
        digest = hashlib.sha256(data).hexdigest()
        key = self.channel + ':' + digest
        with self.lock:
            receipt = self.receipts.get(key)
            if receipt and receipt.get('complete'):
                return {'ok': True, 'channel': self.channel, **receipt}
            if receipt and receipt.get('completion_uncertain'):
                raise ValueError('Slack completion is uncertain for file ' + receipt['file_id'] +
                                 '. Check Slack before clearing its local receipt or retrying.')
            if not receipt:
                result = self.api('files.getUploadURLExternal',
                                  {'filename': 'forge-session-' + session['id'] + '.zip',
                                   'length': len(data)})
                url = urllib.parse.urlparse(result['upload_url'])
                if url.scheme != 'https' or not (url.hostname == 'slack.com' or
                                                 (url.hostname or '').endswith('.slack.com')):
                    raise ValueError('Unexpected Slack upload host.')
                receipt = {'file_id': result['file_id'], 'upload_url': result['upload_url'],
                           'uploaded': False, 'complete': False}
                self.receipts[key] = receipt
                self.save()
            if not receipt['uploaded']:
                req = urllib.request.Request(receipt['upload_url'], data=data, method='POST',
                                             headers={'Content-Type': 'application/octet-stream'})
                try:
                    with self.request(req, timeout=120) as response:
                        if response.status != 200:
                            raise ValueError('Slack file transfer failed.')
                        response.read(4096)
                except urllib.error.HTTPError as error:
                    raise ValueError('Slack file transfer returned HTTP ' + str(error.code) + '.') from None
                receipt['uploaded'] = True
                self.save()
            # A timeout during completion can have committed. Preserve this state
            # before sending so an uncertain retry cannot post another file.
            receipt['completion_uncertain'] = True
            self.save()
            result = self.api('files.completeUploadExternal',
                              {'files': json.dumps([{'id': receipt['file_id'],
                                                     'title': session.get('title') or 'UAS session'}]),
                               'channel_id': self.channel, 'initial_comment': summary})
            receipt.update({'complete': True, 'completion_uncertain': False,
                            'permalink': (result.get('files') or [{}])[0].get('permalink', '')})
            receipt.pop('upload_url', None)
            self.save()
            return {'ok': True, 'channel': self.channel, **receipt}


class BridgeServer(ThreadingHTTPServer):
    daemon_threads = True


class Handler(BaseHTTPRequestHandler):
    server_version = 'ForgeSessionHelper/1.0'

    def log_message(self, *_args):
        pass  # Never log keys, file names, summaries, or Slack credentials.

    def allowed(self, authenticated=True):
        if self.headers.get('Host') not in self.server.hosts:
            return False
        origin = self.headers.get('Origin')
        if origin and origin not in self.server.origins:
            return False
        return not authenticated or hmac.compare_digest(self.headers.get('X-Forge-Key', ''), self.server.key)

    def respond(self, code, data, mime='application/json'):
        payload = data if isinstance(data, bytes) else json.dumps(data).encode()
        self.send_response(code)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self), geolocation=()')
        origin = self.headers.get('Origin')
        if origin in self.server.origins:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        if not self.allowed(False):
            self.respond(403, {'error': 'Origin or host not allowed.'})
            return
        self.send_response(204)
        origin = self.headers.get('Origin')
        if origin:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Forge-Key, X-Forge-Session')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.end_headers()

    def do_GET(self):
        path = urllib.parse.urlparse(self.path)
        if not self.allowed(path.path in ('/status', '/telemetry')):
            self.respond(403, {'error': 'Invalid local connection key, origin or host.'})
            return
        if path.path == '/status':
            self.respond(200, {'ok': True, 'cursor': self.server.telemetry.cursor,
                              'udp_address': '127.0.0.1:' + str(self.server.udp_port),
                              'slack_enabled': bool(self.server.slack),
                              'slack_channel': self.server.slack.channel if self.server.slack else ''})
        elif path.path == '/telemetry':
            try:
                cursor = int(urllib.parse.parse_qs(path.query).get('after', ['0'])[0])
                if cursor < 0:
                    raise ValueError()
                self.respond(200, self.server.telemetry.after(cursor))
            except ValueError:
                self.respond(400, {'error': 'Invalid telemetry cursor.'})
        else:
            mapping = {'/': ('session-recorder.html', 'text/html'),
                       '/session-recorder/': ('session-recorder.html', 'text/html'),
                       '/session-recorder/app.webmanifest': ('app.webmanifest', 'application/manifest+json'),
                       '/session-recorder/sw.js': ('sw.js', 'text/javascript'),
                       '/system-tests/profiles.json': ('profiles.json', 'application/json'),
                       '/session-recorder/README.txt': ('README.txt', 'text/plain')}
            mapping['/session-recorder/SOP.md'] = ('SOP.md', 'text/plain')
            for name in STATIC:
                mapping['/static/' + name] = ('static/' + name,
                    'text/javascript' if name.endswith('.js') else 'text/css' if name.endswith('.css') else 'image/svg+xml')
            if path.path not in mapping:
                self.respond(404, {'error': 'Use the Forge website for other tools.'})
                return
            name, mime = mapping[path.path]
            try:
                self.respond(200, (self.server.root / name).read_bytes(), mime)
            except OSError:
                self.respond(404, {'error': 'Local app asset unavailable. Extract the complete downloaded package.'})

    def do_POST(self):
        if not self.allowed():
            self.respond(403, {'error': 'Invalid local connection key, origin or host.'})
            return
        if self.path != '/slack' or not self.server.slack:
            self.respond(404, {'error': 'Slack is not configured.'})
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= LIMIT or self.headers.get('Content-Type') != 'application/zip':
                raise ValueError('Send a session ZIP up to 256 MiB.')
            self.connection.settimeout(120)
            body = self.rfile.read(length)
            if len(body) != length:
                raise ValueError('Incomplete upload body.')
            self.respond(200, self.server.slack.upload(body))
        except (ValueError, OSError, KeyError, zipfile.BadZipFile, urllib.error.URLError) as error:
            self.respond(400, {'ok': False, 'error': str(error)[:500]})


def create_server(root, http_port=8767, udp_port=14551, token='', channel='', key=None):
    server = BridgeServer(('127.0.0.1', http_port), Handler)
    actual = server.server_address[1]
    server.root, server.key = Path(root), key or secrets.token_urlsafe(32)
    server.hosts = {'127.0.0.1:' + str(actual), 'localhost:' + str(actual)}
    server.origins = {'https://uas-forge.com', 'http://127.0.0.1:' + str(actual),
                      'http://localhost:' + str(actual)}
    server.telemetry = Telemetry()
    server.udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        server.udp.bind(('127.0.0.1', udp_port))
    except OSError:
        server.server_close()
        server.udp.close()
        raise
    server.udp_port = server.udp.getsockname()[1]
    server.slack = SlackUploader(token, channel, Path.home() / '.forge-session-helper' / 'slack-receipts.json') if token and channel else None
    threading.Thread(target=server.telemetry.receive, args=(server.udp,), daemon=True).start()
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--http-port', type=int, default=8767)
    parser.add_argument('--udp-port', type=int, default=14551)
    args = parser.parse_args()
    server = create_server(Path(__file__).resolve().parent, args.http_port, args.udp_port,
                           os.environ.get('FORGE_SLACK_TOKEN', ''), os.environ.get('FORGE_SLACK_CHANNEL', ''))
    print('Open http://127.0.0.1:' + str(server.server_address[1]) + '/session-recorder/')
    print('Connection key: ' + server.key)
    print('Forward a MAVLink copy to UDP 127.0.0.1:' + str(server.udp_port))
    print('Slack enabled.' if server.slack else 'Slack disabled. Local recording/export works without an account.')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.telemetry.closed.set()
        server.udp.close()
        server.server_close()


if __name__ == '__main__':
    main()
