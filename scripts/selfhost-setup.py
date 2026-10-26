#!/usr/bin/env python3
"""Prepare a new standalone installation without touching Neon or Mattermost data."""
import json
import os
from pathlib import Path
import re
import secrets
import subprocess

root = Path(__file__).resolve().parents[1]
target = root / '.env.selfhost'
if target.exists():
    raise SystemExit('Existing .env.selfhost preserved. Use it; do not regenerate the DB password.')
relay = Path.home() / 'mattermost-transfer/.env.mattermost-local/relay.env'
values = {}
for line in relay.read_text().splitlines():
    if '=' not in line or line.lstrip().startswith('#'):
        continue
    key, value = line.split('=', 1)
    values[key.strip()] = value.strip().strip("\"'")
bot_id = values.get('MATTERMOST_BOT_ID', '')
token = values.get('MATTERMOST_BOT_TOKEN', '')
users = json.loads(values.get('MATTERMOST_USER_MAP', '{}'))
if (not re.fullmatch(r'[a-z0-9]{26}', bot_id)
        or not re.fullmatch(r'[a-zA-Z0-9_-]+', token)
        or not isinstance(users, dict) or not users
        or any(not re.fullmatch(r'[a-zA-Z0-9_-]+', k) or not isinstance(v, str)
               or not re.fullmatch(r'[a-z0-9]{26}', v) for k, v in users.items())):
    raise SystemExit('Check the existing relay bot ID, token, and account mapping.')
container = json.loads(subprocess.check_output(['sudo', 'docker', 'inspect', 'robot-butler-mattermost-mattermost-1']))[0]
networks = [name for name, value in container['NetworkSettings']['Networks'].items()
            if 'mattermost' in (value.get('Aliases') or [])]
if len(networks) != 1 or not re.fullmatch(r'[a-zA-Z0-9_.-]+', networks[0]):
    raise SystemExit('Could not uniquely identify the Mattermost Compose network.')
status = json.loads(subprocess.check_output(['tailscale', 'status', '--json']))
hostname = status['Self']['DNSName'].rstrip('.')
if not re.fullmatch(r'[a-zA-Z0-9.-]+\.ts\.net', hostname):
    raise SystemExit('Connect Tailscale and enable MagicDNS first.')
origin = 'https://' + hostname
os.umask(0o077)
with target.open('x') as f:
    f.write(f'POSTGRES_PASSWORD={secrets.token_hex(32)}\nPUBLIC_ORIGIN={origin}\n')
    f.write(f'MATTERMOST_NETWORK={networks[0]}\nMATTERMOST_BOT_ID={bot_id}\nMATTERMOST_BOT_TOKEN={token}\n')
    f.write("MATTERMOST_USER_MAP='" + json.dumps(users, separators=(',', ':')) + "'\n")
    f.write(f'MATTERMOST_INTERACTION_SECRET={secrets.token_hex(32)}\n')
print('SETUP OK — new database, existing Mattermost account mappings preserved.')
print('Site: ' + origin)
