#!/usr/bin/env python3
"""Link the existing Mattermost @tester to the app's tester, without sending messages."""
import argparse
import datetime
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import urllib.request


class Stop(Exception):
    pass


def updated_settings(text, user_id):
    if not re.fullmatch(r'[a-z0-9]{26}', user_id):
        raise Stop('Invalid Mattermost user ID.')
    lines = text.splitlines(keepends=True)
    indices = [i for i, line in enumerate(lines)
               if '=' in line and line.split('=', 1)[0].strip() == 'MATTERMOST_USER_MAP']
    if len(indices) != 1:
        raise Stop('Expected exactly one MATTERMOST_USER_MAP.')
    i = indices[0]
    raw = lines[i].split('=', 1)[1].strip()
    if raw[:1] in ('"', "'") and raw[-1:] == raw[:1]:
        raw = raw[1:-1]
    mapping = json.loads(raw)
    if not isinstance(mapping, dict) or any(
            not isinstance(k, str) or not isinstance(v, str) or
            not re.fullmatch(r'[a-z0-9]{26}', v) for k, v in mapping.items()):
        raise Stop('Invalid existing account mapping.')
    if mapping.get('tester', user_id) != user_id:
        raise Stop('tester is already linked to a different account; refusing overwrite.')
    if any(k != 'tester' and v == user_id for k, v in mapping.items()):
        raise Stop('@tester is already linked to a different app account.')
    if mapping.get('tester') == user_id:
        return text
    mapping['tester'] = user_id
    lines[i] = "MATTERMOST_USER_MAP='" + json.dumps(mapping, separators=(',', ':')) + "'\n"
    return ''.join(lines)


def atomic_write(path, text):
    fd, name = tempfile.mkstemp(prefix='.tester-map-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(name, 0o600)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def lookup(root, verify=False):
    code = r'''
const r = await fetch(process.env.MATTERMOST_URL.replace(/\/$/,'')+'/api/v4/users/username/tester', {
 headers:{Authorization:'Bearer '+process.env.MATTERMOST_BOT_TOKEN},
 redirect:'error', signal:AbortSignal.timeout(10000)
});
if(!r.ok) throw new Error('Mattermost tester lookup failed: HTTP '+r.status);
const u=await r.json();
if(u.username!=='tester'||u.delete_at||u.is_bot||! /^[a-z0-9]{26}$/.test(u.id))
 throw new Error('Expected active human @tester');
const mapped=JSON.parse(process.env.MATTERMOST_USER_MAP||'{}').tester;
if(process.argv.includes('--verify') && mapped!==u.id) throw new Error('Running mapping mismatch');
console.log(JSON.stringify({id:u.id}));
'''
    result = subprocess.run(['./butler', 'exec', '-T', 'app', 'node', '--input-type=module',
                             '-e', code, *(['--', '--verify'] if verify else [])],
                            cwd=root, capture_output=True, text=True)
    if result.returncode:
        raise Stop('Could not verify active @tester with the existing bot; settings unchanged/unverified.')
    return json.loads(result.stdout)['id']


def restart(root):
    subprocess.run(['./butler', 'up', '-d', '--no-deps', '--force-recreate', '--wait',
                    '--wait-timeout', '120', 'app'], cwd=root, check=True)


def verify_app(origin):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(origin.rstrip('/')+'/api/demo/directory', timeout=15) as response:
        people = json.load(response)['people']
    matches = [p for p in people if p.get('id') == 'tester']
    if len(matches) != 1 or matches[0].get('name') != '테스터' or matches[0].get('isAdmin'):
        raise Stop('Deploy the tester account app update first; no mapping changed.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app-dir', type=Path, default=Path('/home/mattermost-admin/robot-butler-direct-20261026'))
    parser.add_argument('--origin', default='https://kftc-robot-butler.tailba32fb.ts.net:8443')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise Stop('Run with sudo on the existing server.')
    os.umask(0o077)
    root = args.app_dir.resolve()
    settings = root / '.env.selfhost'
    if not settings.is_file() or settings.is_symlink():
        raise Stop('Existing regular .env.selfhost required.')
    with (root / '.account-maintenance.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        before = settings.read_text()
        user_id = lookup(root)
        after = updated_settings(before, user_id)
        if not args.apply:
            print('PREFLIGHT OK: existing active @tester found; no changes or messages sent.')
            return
        verify_app(args.origin)
        if after == before:
            lookup(root, verify=True)
            print('TESTER LINK VERIFIED (already linked; no messages sent).')
            return
        backup = root / 'backup' / ('tester-link-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
        backup.mkdir(parents=True, mode=0o700)
        (backup / 'settings').write_text(before)
        (backup / 'settings').chmod(0o600)
        print('PRIVATE BACKUP: '+str(backup), flush=True)
        if settings.read_text() != before:
            raise Stop('Settings changed concurrently; refusing overwrite.')
        atomic_write(settings, after)
        try:
            restart(root)
            if lookup(root, verify=True) != user_id:
                raise Stop('@tester identity changed during update.')
            verify_app(args.origin)
        except BaseException:
            if settings.read_text() == after:
                atomic_write(settings, before)
                restart(root)
                print('Previous mapping restored; tester app account retained.', file=sys.stderr)
            else:
                print('Settings changed concurrently; restore requires review.', file=sys.stderr)
            raise
        print('TESTER LINK VERIFIED. Existing mappings preserved; no messages sent.')


if __name__ == '__main__':
    try:
        main()
    except (Stop, OSError, ValueError, subprocess.CalledProcessError):
        print('STOP: Tester linking could not be verified. Check account availability, permissions and private backup; no secrets printed.', file=sys.stderr)
        sys.exit(1)
