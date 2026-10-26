#!/usr/bin/env python3
"""Retire the legacy relay and allow signed callbacks from Mattermost to the app."""
import datetime
import json
import os
from pathlib import Path
import re
import subprocess

root = Path(__file__).resolve().parents[1]
mm = Path.home() / 'mattermost-transfer'
overlay = mm / 'docker/mattermost-relay/compose.yaml'
def run(args, cwd=mm):
    return subprocess.run(args, cwd=cwd, check=True)

# Validate bot and mapped accounts without sending any messages, before changing services.
run(['sudo', './butler', 'run', '--rm', '--no-deps', 'app', 'node', 'server.mjs', '--check-mattermost'], root)
original = overlay.read_text()
pattern = r'(?m)^(\s+MM_SERVICESETTINGS_ALLOWEDUNTRUSTEDINTERNALCONNECTIONS:)\s*[^\n]*$'
if len(re.findall(pattern, original)) != 1 or '\n  relay:\n' not in original:
    raise SystemExit('Unexpected Mattermost compose layout; nothing changed.')
container = json.loads(subprocess.check_output(['sudo', 'docker', 'inspect', 'robot-butler-mattermost-mattermost-1']))[0]
env = dict(item.split('=', 1) for item in container['Config']['Env'] if '=' in item)
allowed = env.get('MM_SERVICESETTINGS_ALLOWEDUNTRUSTEDINTERNALCONNECTIONS', 'relay').split()
if 'robot-butler' not in allowed:
    allowed.append('robot-butler')
updated = re.sub(pattern, lambda m: m[1] + ' ' + json.dumps(' '.join(allowed)), original)
# The old relay remains recoverable but normal Compose starts cannot bring it back.
if 'profiles: [legacy-relay]' not in updated:
    updated = updated.replace('\n  relay:\n', '\n  relay:\n    profiles: [legacy-relay]\n', 1)
os.umask(0o077)
backup = overlay.with_name('compose.before-direct-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '.yaml')
backup.write_text(original)
run(['sudo', './dc', 'stop', 'relay'])
ids = subprocess.check_output(['sudo', './dc', 'ps', '-a', '-q', 'relay'], cwd=mm, text=True).split()
if ids:
    run(['sudo', 'docker', 'update', '--restart=no', *ids])
temp = overlay.with_name('compose.direct.tmp')
with temp.open('x') as f:
    f.write(updated)
os.chmod(temp, overlay.stat().st_mode & 0o777)
temp.replace(overlay)
run(['sudo', './dc', 'up', '-d', '--no-deps', '--wait', '--wait-timeout', '180', 'mattermost'])
print('CUTOVER READY — Mattermost retained; legacy relay stopped; direct callbacks permitted.')
print('Start the new app with: sudo ./butler up -d --wait app')
