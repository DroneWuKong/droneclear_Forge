#!/usr/bin/env python3
"""Resolve the current generated-data commit once, then build immutable inputs."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]

def resolve_ref():
    explicit = os.environ.get('AI_PROJECT_REF')
    if explicit:
        if not re.fullmatch(r'[a-fA-F0-9]{40}', explicit):
            raise ValueError('AI_PROJECT_REF must be an exact commit SHA')
        return explicit
    token = os.environ.get('GITHUB_PAT')
    if not token:
        raise ValueError('Pages builds require GITHUB_PAT or an explicit AI_PROJECT_REF')
    request = urllib.request.Request(
        'https://api.github.com/repos/DroneWuKong/Ai-Project/commits/automation%2Fpatterns-data',
        headers={'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json', 'User-Agent': 'Forge-Pages-build'},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        ref = json.load(response).get('sha', '')
    if not re.fullmatch(r'[a-fA-F0-9]{40}', ref):
        raise ValueError('Generated-data ref did not resolve to an immutable commit')
    return ref

if __name__ == '__main__':
    ref = resolve_ref()
    print(f'Building public inputs from Ai-Project commit {ref}', flush=True)
    subprocess.run([sys.executable, str(ROOT/'build_static.py'), '--data-ref', ref], cwd=ROOT, check=True)
