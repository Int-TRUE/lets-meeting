#!/usr/bin/env python3
# coding: utf-8
"""Update the existing Compose app from a checked release; never reset its DB."""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

class Stop(Exception):
    pass


def run(command, root, capture=False, output=None):
    result = subprocess.run(command, cwd=root, check=True, text=output is None,
                            stdout=output if output else (subprocess.PIPE if capture else None))
    return result.stdout.strip() if capture else None


def private_json(path, data):
    with path.open('x') as stream:
        json.dump(data, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    path.chmod(0o600)


def checked_archive(archive, checksum):
    if not re.fullmatch('[a-f0-9]{64}', checksum):
        raise Stop('Expected a SHA-256 checksum.')
    with archive.open('rb') as stream:
        digest = hashlib.sha256()
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    if digest.hexdigest() != checksum:
        raise Stop('Archive checksum mismatch; nothing changed.')
    with tarfile.open(archive, 'r:gz') as tar:
        members = tar.getmembers()
        names = set()
        for member in members:
            parts = Path(member.name).parts
            if (not parts or member.name.startswith('/') or '..' in parts
                    or member.name in names or not (member.isfile() or member.isdir())
                    or parts[0] in ('.git', 'backup', 'data', 'node_modules', 'output')
                    or any(p.startswith('.env') and p != '.env.example' for p in parts)):
                raise Stop('Unsafe/unexpected release archive; nothing changed.')
            names.add(member.name)
        for required in ('butler', 'package.json', 'server/postgres.ts', 'src/data/testDirectory.ts'):
            if required not in names:
                raise Stop('Incomplete release archive.')
        return members


def probe(origin, commit=None):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def get(path):
        with opener.open(origin.rstrip('/') + path, timeout=15) as response:
            return json.load(response)
    if get('/healthz').get('ok') is not True:
        raise Stop('App health verification failed.')
    directory = get('/api/demo/directory')
    if commit:
        if get('/deployment-version.json').get('commit') != commit:
            raise Stop('Served release differs from the expected commit.')
        people = directory['people']
        expected = {'sujin': '정금결', 'jooyoung': '김금달', 'taeheon': '태평양', 'wooseok': '장금별'}
        if any(not any(p.get('id') == uid and p.get('name') == name for p in people) for uid, name in expected.items()):
            raise Stop('App account labels did not match the release.')
    return directory


def restore(root, backup, state):
    # No DB restore: keep work created since deployment, meetings, messages and IDs.
    run(['./butler', 'stop', 'app'], root)
    with tarfile.open(backup / 'source.tar.gz') as tar:
        tar.extractall(root)  # Locally generated root-owned backup, not the release archive.
    shutil.copy2(backup / 'settings', root / '.env.selfhost')
    for name in state['added_files']:
        path = root / name
        if path.is_file():
            path.unlink()
    run(['docker', 'image', 'tag', state['previous_image'], 'robot-butler-direct:local'], root)
    run(['./butler', 'up', '-d', '--no-deps', '--force-recreate', '--wait', '--wait-timeout', '120', 'app'], root)
    probe(state['origin'])
    print('APP ROLLBACK VERIFIED. Database was retained; profile rollback is separate.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app-dir', type=Path, required=True)
    parser.add_argument('--archive', type=Path)
    parser.add_argument('--sha256')
    parser.add_argument('--release', help='Full commit SHA of the source archive.')
    parser.add_argument('--expected-current', help='Current deployed commit after reviewing server-only changes.')
    parser.add_argument('--origin', default='http://100.123.150.118:8088')
    parser.add_argument('--rollback', type=Path)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise Stop('Run with sudo on the existing server.')
    os.umask(0o077)
    root = args.app_dir.resolve()
    if not (root / '.env.selfhost').is_file() or not (root / 'butler').is_file():
        raise Stop('Existing installation/settings required; no setup or reset performed.')
    with (root / '.account-maintenance.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.rollback:
            backup = args.rollback.resolve()
            state = json.loads((backup / 'state.json').read_text())
            if state['app_dir'] != str(root):
                raise Stop('Backup belongs to another installation.')
            restore(root, backup, state)
            return
        if not args.archive or not args.sha256 or not args.release or not args.expected_current:
            raise Stop('--archive, --sha256, --release and --expected-current are required.')
        if not re.fullmatch('[a-f0-9]{40}', args.release) or not re.fullmatch('[a-f0-9]{7,40}', args.expected_current):
            raise Stop('Invalid release/current commit.')
        archive = args.archive.resolve()
        members = checked_archive(archive, args.sha256)
        # Verify the running release, rather than assuming local source matches the container.
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(
                args.origin.rstrip('/') + '/deployment-version.json', timeout=15) as response:
            current = json.load(response).get('commit', '')
        if current != args.expected_current:
            raise Stop('Running commit differs from --expected-current; stop and compare server changes.')
        probe(args.origin)
        container = run(['./butler', 'ps', '-q', 'app'], root, capture=True)
        if not re.fullmatch('[a-f0-9]{12,64}', container):
            raise Stop('Expected exactly one running app container.')
        image = run(['docker', 'inspect', '--format', '{{.Image}}', container], root, capture=True)
        if not re.fullmatch('sha256:[a-f0-9]{64}', image):
            raise Stop('Could not identify the current app image.')
        backup = root / 'backup' / ('app-accounts-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
        backup.mkdir(parents=True, mode=0o700)
        shutil.copy2(root / '.env.selfhost', backup / 'settings')
        (backup / 'settings').chmod(0o600)
        # Preserve all existing source/config files, excluding volumes, credentials and caches.
        excluded = {'backup', 'node_modules', '.git', 'data', 'output', '.env.selfhost'}
        with tarfile.open(backup / 'source.tar.gz', 'w:gz') as tar:
            for path in root.iterdir():
                if path.name not in excluded:
                    tar.add(path, arcname=path.name)
        added = [m.name for m in members if m.isfile() and not (root / m.name).exists()]
        if not (root / 'public/deployment-version.json').exists():
            added.append('public/deployment-version.json')
        state = {'app_dir': str(root), 'previous_image': image, 'previous_commit': current,
                 'origin': args.origin, 'added_files': added, 'release': args.release}
        private_json(backup / 'state.json', state)
        run(['docker', 'image', 'tag', image, 'robot-butler-direct:before-accounts-' + backup.name], root)
        print('PRIVATE BACKUP: ' + str(backup), flush=True)
        changed = False
        stopped = False
        try:
            with tempfile.TemporaryDirectory(prefix='butler-release-') as staging:
                with tarfile.open(archive, 'r:gz') as tar:
                    tar.extractall(staging, members=members)
                # Refuse writes through symlinked destination components.
                for member in members:
                    path = root / member.name
                    if any(p.is_symlink() for p in [path, *path.parents] if p == root or root in p.parents):
                        raise Stop('Symlink in deployment target; refusing overwrite.')
                changed = True
                shutil.copytree(staging, root, dirs_exist_ok=True)
            (root / 'public').mkdir(exist_ok=True)
            (root / 'public/deployment-version.json').write_text(json.dumps({'commit': args.release, 'release': 'account-labels'}))
            run(['./butler', 'build', 'app'], root)
            stopped = True
            run(['./butler', 'stop', 'app'], root)
            with (backup / 'database.dump').open('xb') as stream:
                run(['./butler', 'exec', '-T', 'db', 'pg_dump', '-U', 'butler', '-d', 'robot_butler', '-Fc'], root, output=stream)
            if (backup / 'database.dump').stat().st_size == 0:
                raise Stop('Empty DB backup; refusing startup.')
            # Validate the custom-format backup with the same PostgreSQL image.
            with (backup / 'database.dump').open('rb') as stream:
                subprocess.run(['./butler', 'exec', '-T', 'db', 'pg_restore', '--list'], cwd=root,
                               stdin=stream, stdout=subprocess.DEVNULL, check=True)
            run(['./butler', 'up', '-d', '--no-deps', '--force-recreate', '--wait', '--wait-timeout', '120', 'app'], root)
            probe(args.origin, args.release)
            run(['./butler', 'exec', '-T', 'app', 'node', 'server.mjs', '--check-mattermost'], root)
            private_json(backup / 'result.json', {'status': 'verified', 'release': args.release})
            print('APP UPDATE VERIFIED. Existing DB/settings/mappings retained. Backup: ' + str(backup))
        except BaseException:
            if changed:
                try:
                    restore(root, backup, state)
                except BaseException:
                    print('AUTOMATIC ROLLBACK NOT VERIFIED. Use the saved backup and --rollback.', file=sys.stderr)
            elif stopped:
                print('App stopped; inspect the private backup before restarting.', file=sys.stderr)
            raise

if __name__ == '__main__':
    try:
        def terminate(signum, frame):
            raise KeyboardInterrupt()
        signal.signal(signal.SIGTERM, terminate)
        main()
    except (Stop, OSError, ValueError, KeyError, subprocess.CalledProcessError, KeyboardInterrupt) as error:
        print(str(error) if isinstance(error, Stop) else 'Stopped: command, input, connection or file error. See backup path above.', file=sys.stderr)
        sys.exit(1)
