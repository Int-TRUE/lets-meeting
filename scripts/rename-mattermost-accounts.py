#!/usr/bin/env python3
# coding: utf-8
"""Patch four existing profiles only. No SQL, account creation, posts or role writes."""
import argparse
import datetime
import fcntl
import getpass
import json
import os
from pathlib import Path
import re
import signal
import sys
import urllib.error
import urllib.parse
import urllib.request

TARGETS = {
    'sujin': ('jeong', '정금결', '금결', '정'),
    'jooyoung': ('kim', '김금달', '금달', '김'),
    'taeheon': ('tae', '태평양', '평양', '태'),
    'wooseok': ('jang', '장금별', '금별', '장'),
}
OLD_HANDLES = dict(zip(TARGETS, ['inttrue', 'kimjooyoung', 'taeheon', 'wooseok']))
FIELDS = ('username', 'nickname', 'first_name', 'last_name')

class Stop(Exception):
    pass

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

class API:
    def __init__(self, url, token):
        parsed = urllib.parse.urlsplit(url)
        if (parsed.scheme not in ('http', 'https') or parsed.username or parsed.password
                or parsed.query or parsed.fragment or parsed.path not in ('', '/')
                or (parsed.scheme == 'http' and parsed.hostname not in ('127.0.0.1', 'localhost'))):
            raise Stop('Use HTTPS or server-local http://127.0.0.1:8065.')
        self.base = url.rstrip('/')
        self.token = token
        self.opener = urllib.request.build_opener(NoRedirect(), urllib.request.ProxyHandler({}))

    def request(self, path, data=None, missing=False):
        req = urllib.request.Request(self.base + '/api/v4' + path,
            data=json.dumps(data).encode() if data is not None else None,
            method='PUT' if data is not None else 'GET',
            headers={'Authorization': 'Bearer ' + self.token, 'Content-Type': 'application/json'})
        try:
            with self.opener.open(req, timeout=20) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if missing and error.code == 404:
                return None
            # Never echo raw API errors: they can contain identifying information.
            raise Stop('Mattermost HTTP %s; no further account will be changed.' % error.code) from None
        except (OSError, ValueError):
            raise Stop('Mattermost response unavailable/invalid; result may be uncertain. Use saved backup.') from None

    def admin(self):
        me = self.request('/users/me')
        if me.get('delete_at') or 'system_admin' not in me.get('roles', '').split():
            raise Stop('An active system administrator token is required.')

    def snapshot(self, user_id):
        user = self.request('/users/' + user_id)
        if user.get('id') != user_id or user.get('delete_at') or user.get('is_bot'):
            raise Stop('Mapped account is missing, inactive, or a bot.')
        teams = self.request('/users/' + user_id + '/teams/members')
        # Compare permissions, not volatile read timestamps or message counters.
        team_roles = sorted((m['team_id'], m.get('roles', ''), m.get('scheme_user'),
                             m.get('scheme_admin'), m.get('delete_at', 0)) for m in teams)
        channels = self.request('/users/' + user_id + '/channels')
        channel_roles = []
        for channel in channels:
            member = self.request('/channels/' + channel['id'] + '/members/' + user_id)
            channel_roles.append((channel['id'], member.get('roles', ''),
                                  member.get('scheme_user'), member.get('scheme_admin'),
                                  member.get('scheme_guest')))
        return {'id': user_id, 'profile': {k: user.get(k, '') for k in FIELDS},
                'identity': {k: user.get(k) for k in ('roles', 'email', 'auth_service', 'delete_at', 'is_bot')},
                'teams': [list(x) for x in team_roles],
                'channels': [list(x) for x in sorted(channel_roles)]}


def mapping_from_env(path):
    lines = [line.split('=', 1)[1].strip() for line in path.read_text().splitlines()
             if line.split('=', 1)[0].strip() == 'MATTERMOST_USER_MAP' and '=' in line]
    if len(lines) != 1:
        raise Stop('Expected one MATTERMOST_USER_MAP; settings were not changed.')
    value = lines[0]
    if value[:1] in ('"', "'") and value[-1:] == value[:1]:
        value = value[1:-1]
    mapping = json.loads(value)
    ids = [mapping.get(actor) for actor in TARGETS]
    if any(not isinstance(uid, str) or not re.fullmatch('[a-z0-9]{26}', uid) for uid in ids) or len(set(ids)) != 4:
        raise Stop('Four distinct existing user IDs are required; fix mapping separately.')
    if any(actor not in TARGETS and uid in ids for actor, uid in mapping.items()):
        raise Stop('A target ID is also mapped to another app account.')
    return {actor: mapping[actor] for actor in TARGETS}


def write_json(path, value):
    with path.open('x') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    path.chmod(0o600)


def unchanged(a, b):
    return all(a[k] == b[k] for k in ('id', 'identity', 'teams', 'channels'))


def plan(api, mapping, restore=None):
    records = []
    for actor, values in TARGETS.items():
        before = api.snapshot(mapping[actor])
        if before['identity'].get('auth_service'):
            raise Stop('An account uses an external login provider; no changes made.')
        desired = dict(zip(FIELDS, values)) if restore is None else restore[actor]['profile']
        if restore is None and before['profile']['username'] not in (OLD_HANDLES[actor], values[0]):
            raise Stop('Mapped account username differs from the expected source/target; no changes made.')
        if restore is not None:
            allowed = (dict(zip(FIELDS, values)), restore[actor]['profile'])
            if before['profile'] not in allowed or not unchanged(before, restore[actor]):
                raise Stop('Profile/permissions changed since backup; manual review required.')
        owner = api.request('/users/username/' + urllib.parse.quote(desired['username'], safe=''), missing=True)
        if owner is not None and owner.get('id') != before['id']:
            raise Stop('Username conflict for @%s; no changes made.' % desired['username'])
        records.append({'actor': actor, 'before': before, 'desired': desired})
    return records


def apply(api, records, folder):
    attempted = []
    try:
        for record in records:
            before, desired = record['before'], record['desired']
            if api.snapshot(before['id']) != before:
                raise Stop('Concurrent account change detected.')
            owner = api.request('/users/username/' + urllib.parse.quote(desired['username'], safe=''), missing=True)
            if owner is not None and owner.get('id') != before['id']:
                raise Stop('Username became occupied.')
            if before['profile'] != desired:
                # Journal BEFORE the request: a lost response can still mean a successful update.
                write_json(folder / ('attempt-%s.json' % record['actor']), record)
                attempted.append(record)
                api.request('/users/' + before['id'] + '/patch', desired)
            after = api.snapshot(before['id'])
            if after['profile'] != desired or not unchanged(before, after):
                raise Stop('Post-change identity/permission verification failed.')
            owner = api.request('/users/username/' + desired['username'])
            if owner.get('id') != before['id']:
                raise Stop('Username lookup verification failed.')
            print('@%s VERIFIED (existing ID and permissions retained)' % desired['username'])
        write_json(folder / 'result.json', {'status': 'verified'})
    except BaseException:
        failed = []
        for record in reversed(attempted):
            before = record['before']
            try:
                current = api.snapshot(before['id'])
                if not unchanged(before, current) or current['profile'] not in (before['profile'], record['desired']):
                    raise Stop('Concurrent changes; refusing overwrite.')
                owner = api.request('/users/username/' + before['profile']['username'], missing=True)
                if owner is not None and owner.get('id') != before['id']:
                    raise Stop('Rollback username occupied.')
                if current['profile'] != before['profile']:
                    api.request('/users/' + before['id'] + '/patch', before['profile'])
                if api.snapshot(before['id']) != before:
                    raise Stop('Rollback verification failed.')
            except BaseException:
                failed.append(record['actor'])
        write_json(folder / 'result.json', {'status': 'stopped', 'rollback_unverified': failed})
        if failed:
            print('ROLLBACK UNVERIFIED: ' + ', '.join(failed), file=sys.stderr)
        else:
            print('Attempted changes restored and verified.', file=sys.stderr)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app-dir', type=Path, required=True)
    parser.add_argument('--url', default='http://127.0.0.1:8065')
    parser.add_argument('--apply', action='store_true', help='Without this flag, preflight only.')
    parser.add_argument('--restore', type=Path, help='Private backup directory from a prior run.')
    args = parser.parse_args()
    os.umask(0o077)
    root = args.app_dir.resolve()
    with (root / '.account-maintenance.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        mapping = mapping_from_env(root / '.env.selfhost')
        if not sys.stdin.isatty():
            raise Stop('Run in an interactive terminal so the administrator token stays hidden.')
        api = API(args.url, getpass.getpass('Mattermost system admin personal access token (hidden): '))
        api.admin()
        restore = None
        if args.restore:
            saved = json.loads((args.restore / 'profiles.json').read_text())
            if saved['url'] != api.base or saved['mapping'] != mapping:
                raise Stop('Backup server/account mapping differs.')
            restore = saved['accounts']
        records = plan(api, mapping, restore)
        print('PREFLIGHT OK: four mapped accounts; target usernames available; permissions readable.')
        if not args.apply:
            print('Read-only check. Re-run with --apply to change profiles.')
            return
        folder = root / 'backup' / ('accounts-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
        folder.mkdir(parents=True, mode=0o700)
        write_json(folder / 'profiles.json', {'url': api.base, 'mapping': mapping,
                   'accounts': {r['actor']: r['before'] for r in records}})
        print('Private backup: ' + str(folder))
        apply(api, records, folder)
        print('PROFILE UPDATE COMPLETE. Messages were not edited. Admin token was not saved.')

if __name__ == '__main__':
    try:
        def terminate(signum, frame):
            raise KeyboardInterrupt()
        signal.signal(signal.SIGTERM, terminate)
        main()
    except (Stop, OSError, ValueError, KeyError, KeyboardInterrupt) as error:
        # Avoid traceback/local variables and user profile values in shared logs.
        print(str(error) if isinstance(error, Stop) else 'Stopped: local input, file, lock or interrupt error. No further changes.', file=sys.stderr)
        sys.exit(1)
