#!/usr/bin/env python3
"""Change only the existing app's public origin/bind settings; preserve DB and bot secrets."""
import datetime
import os
from pathlib import Path
from selfhost_network import http_settings, replace_settings

root = Path(__file__).resolve().parents[1]
path = root / '.env.selfhost'
if not path.is_file():
    raise SystemExit('No .env.selfhost found. For a new installation run scripts/selfhost-setup.py first.')
settings = http_settings()
original = path.read_text()
updated = replace_settings(original, settings)
if original != updated:
    os.umask(0o077)
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    backup = path.with_name('.env.selfhost.before-http-' + stamp)
    with backup.open('x') as f:
        f.write(original)
    temp = path.with_name('.env.selfhost.http-' + stamp)
    with temp.open('x') as f:
        f.write(updated)
    os.chmod(temp, 0o600)
    temp.replace(path)
print('HTTP SETTINGS OK — DB password, bot mapping, and interaction key preserved.')
print('Site: ' + settings['PUBLIC_ORIGIN'])
print('Apply with: sudo ./butler up -d --no-deps --force-recreate --wait app')
