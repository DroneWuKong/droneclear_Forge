#!/usr/bin/env python3
"""Start the standalone field recorder. Bundled builds need no Python install."""
import argparse
import json
import os
from pathlib import Path
import sys
import threading
import webbrowser

from bridge import create_server


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--http-port', type=int, default=8767)
    parser.add_argument('--udp-port', type=int, default=14551)
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--session-dir', type=Path,
                        default=Path.home() / '.forge-uas-recorder' / 'sessions')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    if getattr(sys, 'frozen', False):
        root = root / 'app'
    try:
        server = create_server(root, args.http_port, args.udp_port,
                               os.environ.get('FORGE_SLACK_TOKEN', ''),
                               os.environ.get('FORGE_SLACK_CHANNEL', ''),
                               standalone=True, session_directory=args.session_dir)
    except OSError as error:
        print('Could not start the field recorder: ' + str(error), flush=True)
        print('Close another recorder instance or choose different --http-port / --udp-port values.', flush=True)
        return 1
    url = 'http://127.0.0.1:' + str(server.server_address[1]) + '/session-recorder/'
    print(json.dumps({'url': url, 'udp_port': server.udp_port, 'version': '1.3.1'}), flush=True)
    print('Field folder: ' + str(server.archive.directory), flush=True)
    print('Keep this window open. Press Ctrl+C to close the recorder after stopping your session.', flush=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        if not args.no_browser:
            webbrowser.open(url)
        while thread.is_alive():
            thread.join(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.telemetry.closed.set()
        server.udp.close()
        server.shutdown()
        server.server_close()
        thread.join()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
