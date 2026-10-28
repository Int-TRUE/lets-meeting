#!/usr/bin/env python3
# coding: utf-8
"""Read-only plan by default; --apply replaces authorized meeting data after backup.
Uses only the existing ./butler containers and Python's standard library.
"""
import argparse
import base64
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import urllib.parse
import urllib.request

SCHEMA = 'butler_selfhost'
COLUMNS = {
    'metadata': ('key', 'value'), 'people': ('id', 'data'), 'rooms': ('id', 'data'),
    'topics': ('id', 'data'), 'topic_members': ('topic_id', 'person_id', 'role'),
    'meetings': ('id', 'topic_id', 'data'), 'meeting_participants': ('meeting_id', 'person_id'),
    'attachments': ('id', 'meeting_id', 'data', 'bytes'), 'preferences': ('person_id', 'data'),
    'delivery_logs': ('id', 'data'), 'requests': ('id', 'result'),
}
TABLES = tuple(COLUMNS)
DELETE_TABLES = ('attachments', 'meeting_participants', 'topic_members', 'meetings', 'topics', 'delivery_logs', 'requests')
PRESERVED = ('people', 'preferences', 'metadata')
DEFAULT_URL = 'https://kftc-robot-butler.tailba32fb.ts.net:8443'

class Stop(Exception):
    """An operator-readable error with no private command output."""

class SqlTransactionRejected(Stop):
    """psql exit 3 under ON_ERROR_STOP: the uncommitted transaction was rolled back."""

class SqlOutcomeUnknown(Stop):
    """Connection/process failure: the COMMIT outcome cannot be assumed."""

def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))

def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()

def quoted(value):
    text = str(value)
    tag = '$judging_' + hashlib.sha256(text.encode()).hexdigest()[:20] + '$'
    while tag in text:
        tag = tag[:-1] + 'x$'
    return tag + text + tag

def table(name):
    if name not in TABLES:
        raise Stop('Unknown application table.')
    return '"' + SCHEMA + '"."' + name + '"'

def fingerprints_sql():
    pairs = []
    for name in TABLES:
        hashed = "encode(sha256(convert_to(to_jsonb(r)::text, 'UTF8')), 'hex')"
        value = ("(SELECT encode(sha256(convert_to(COALESCE(string_agg(h,'' ORDER BY h),''),'UTF8')),'hex') "
                 'FROM (SELECT ' + hashed + ' h FROM ' + table(name) + ' r) q)')
        pairs.extend([quoted(name), value])
    return 'jsonb_build_object(' + ','.join(pairs) + ')'

def snapshot_sql():
    counts = ','.join(quoted(t) + ',(SELECT count(*) FROM ' + table(t) + ')' for t in TABLES)
    columns = ("(SELECT COALESCE(jsonb_agg(jsonb_build_object('table',table_name,'column',column_name,"
               "'type',udt_name,'nullable',is_nullable) ORDER BY table_name,ordinal_position),'[]') "
               'FROM information_schema.columns WHERE table_schema=' + quoted(SCHEMA) + ')')
    constraints = ("(SELECT COALESCE(jsonb_agg(jsonb_build_object('table',c.relname,'name',k.conname,"
                   "'definition',pg_get_constraintdef(k.oid)) ORDER BY c.relname,k.conname),'[]') "
                   'FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n '
                   'ON n.oid=c.relnamespace WHERE n.nspname=' + quoted(SCHEMA) + ')')
    return ("SELECT jsonb_build_object('counts',jsonb_build_object(" + counts + "),'fingerprints'," + fingerprints_sql()
            + ",'columns'," + columns + ",'constraints'," + constraints
            + ",'people',(SELECT COALESCE(jsonb_agg(data ORDER BY id),'[]') FROM " + table('people')
            + "),'rooms',(SELECT COALESCE(jsonb_agg(data ORDER BY id),'[]') FROM " + table('rooms')
            + "),'seedVersion',(SELECT value FROM " + table('metadata') + " WHERE key='seed-version'));")

def baseline(snapshot):
    return {k: snapshot[k] for k in ('counts', 'fingerprints', 'columns', 'constraints', 'seedVersion')}

def check_schema(snapshot):
    found = {}
    for column in snapshot['columns']:
        found.setdefault(column['table'], []).append(column['column'])
    if {k: tuple(v) for k, v in found.items()} != COLUMNS:
        raise Stop('Server schema differs from the reviewed schema; no data changed.')
    if not snapshot['seedVersion']:
        raise Stop('Existing seed-version is required; initialization is not permitted.')
    for kind in ('people', 'rooms'):
        if not snapshot[kind] or len({r['id'] for r in snapshot[kind]}) != len(snapshot[kind]):
            raise Stop('Existing directory is missing or has inconsistent IDs.')

def private_json(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())

def checksum_file(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()

class Server:
    def __init__(self, root):
        self.root = Path(root).resolve()

    def command(self, arguments, *, data=None, source=None, destination=None, timeout=180):
        try:
            result = subprocess.run(['./butler', *arguments], cwd=self.root, input=data, stdin=source,
                                    stdout=destination if destination is not None else subprocess.PIPE,
                                    stderr=subprocess.PIPE, check=True, timeout=timeout)
            return result.stdout or b''
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as error:
            if 'psql' in arguments:
                if isinstance(error, subprocess.CalledProcessError) and error.returncode == 3:
                    raise SqlTransactionRejected('SQL was rejected; PostgreSQL rolled back the transaction. Current data is retained.') from None
                raise SqlOutcomeUnknown('SQL connection/process failed; commit outcome requires verification. Private details withheld.') from None
            raise Stop('Existing server command failed (' + arguments[0] + '); private details withheld.') from None

    def sql(self, statement, *, result=True):
        output = self.command(['exec', '-T', 'db', 'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
                               '-U', 'butler', '-d', 'robot_butler'], data=statement.encode(), timeout=300)
        if not result:
            return None
        try:
            return json.loads(output.decode().strip())
        except (ValueError, UnicodeError):
            raise Stop('Database returned an unexpected result; private details withheld.') from None

    def snapshot(self):
        value = self.sql('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n' + snapshot_sql() + '\nCOMMIT;')
        check_schema(value)
        return value

    def running(self):
        lines = self.command(['ps', '--status', 'running', '-q', 'app']).decode().strip().splitlines()
        if len(lines) > 1:
            raise Stop('Expected at most one existing app container.')
        return bool(lines)

    def stop(self):
        self.command(['stop', 'app'])
        if self.running():
            raise Stop('App remains running; database replacement is blocked.')

    def start(self):
        self.command(['start', 'app'])
        if not self.running():
            raise Stop('Existing app did not restart.')

    def generate(self, generator, input_data):
        encoded = base64.b64encode(Path(generator).read_bytes()).decode()
        script = ("const {buildDataset}=await import('data:text/javascript;base64," + encoded + "');\n"
                  'const d=await buildDataset(' + canonical(input_data) + ');\n'
                  'd.attachments=d.attachments.map(a=>({...a,bytes:Buffer.from(a.bytes).toString("base64")}));\n'
                  'process.stdout.write(JSON.stringify(d));\n')
        output = self.command(['exec', '-T', 'app', 'node', '--input-type=module'], data=script.encode())
        try:
            return json.loads(output)
        except ValueError:
            raise Stop('Dataset generator returned an invalid result; private details withheld.') from None

    def dump(self, path):
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            self.command(['exec', '-T', 'db', 'pg_dump', '-U', 'butler', '-d', 'robot_butler', '-Fc'],
                         destination=stream, timeout=600)
            stream.flush()
            os.fsync(stream.fileno())
        if path.stat().st_size < 32:
            raise Stop('Database backup is empty or incomplete; replacement is blocked.')
        self.check_dump(path)

    def check_dump(self, path):
        with path.open('rb') as stream:
            listing = self.command(['exec', '-T', 'db', 'pg_restore', '--list'], source=stream, timeout=300)
        if SCHEMA.encode() not in listing or b'TABLE DATA' not in listing:
            raise Stop('Backup does not contain the expected application schema and data.')

    def restore_dump(self, path):
        with path.open('rb') as stream:
            self.command(['exec', '-T', 'db', 'pg_restore', '-U', 'butler', '-d', 'robot_butler', '--clean',
                          '--if-exists', '--single-transaction', '--exit-on-error'], source=stream, timeout=600)

def validate_dataset(data, before, base_date):
    if data.get('baseDate') != base_date or not isinstance(data.get('prefix'), str) or not data['prefix']:
        raise Stop('Dataset identity/date differs from the requested plan.')
    if data.get('logs') != [] or not isinstance(data.get('requests'), dict):
        raise Stop('Dataset must contain no fabricated delivery logs and must declare request markers.')
    if any(not isinstance(k, str) or not isinstance(v, str) for k, v in data['requests'].items()):
        raise Stop('Request marker values must be strings.')
    def index(rows, label):
        if not isinstance(rows, list) or any(not isinstance(r.get('id'), str) or not r['id'] for r in rows):
            raise Stop('Invalid ' + label + ' IDs.')
        result = {r['id']: r for r in rows}
        if len(result) != len(rows):
            raise Stop('Duplicate ' + label + ' IDs.')
        return result
    people, rooms = index(before['people'], 'person'), index(before['rooms'], 'room')
    added = index(data['addedRooms'], 'new room')
    if set(rooms) & set(added) or len(added) > 3:
        raise Stop('New room IDs collide with existing rooms or exceed the authorized three.')
    for room in added.values():
        if room.get('location') != '분당' or not room.get('active') or not room.get('name') or room.get('capacity', 0) <= 0:
            raise Stop('New rooms must be active Bundang rooms with valid names and capacities.')
    rooms.update(added)
    topics, meetings = index(data['topics'], 'topic'), index(data['meetings'], 'meeting')
    if not topics or not meetings:
        raise Stop('Replacement requires nonempty topics and meetings.')
    for topic in topics.values():
        roles = topic.get('roles', {})
        if (not roles or any(p not in people or r not in ('Owner', 'Master', 'Attendee') for p, r in roles.items())
                or list(roles.values()).count('Owner') != 1):
            raise Stop('Topic roles or owner references are invalid.')
    for meeting in meetings.values():
        topic, participants = topics.get(meeting.get('topicId')), meeting.get('participantIds', [])
        if (not topic or meeting.get('creatorId') not in people or meeting.get('roomId') not in rooms
                or not participants or len(set(participants)) != len(participants)
                or any(p not in topic['roles'] for p in participants)):
            raise Stop('Meeting references are invalid.')
        if dt.datetime.fromisoformat(meeting['end']) <= dt.datetime.fromisoformat(meeting['start']):
            raise Stop('Meeting end must follow its start.')
    seen = set()
    for item in data['attachments']:
        meta = item['data']
        try:
            binary = base64.b64decode(item['bytes'], validate=True)
        except (ValueError, TypeError):
            raise Stop('Attachment encoding is invalid.') from None
        if (not meta.get('id') or meta['id'] in seen or item['meetingId'] not in meetings
                or meta.get('authorId') not in people or meta.get('size') != len(binary)
                or not binary or len(binary) > 2 * 1024 * 1024):
            raise Stop('Attachment references or byte length are invalid.')
        seen.add(meta['id'])
    return data

def new_counts(data):
    return {'topics': len(data['topics']), 'topic_members': sum(len(t['roles']) for t in data['topics']),
            'meetings': len(data['meetings']), 'meeting_participants': sum(len(m['participantIds']) for m in data['meetings']),
            'attachments': len(data['attachments']), 'delivery_logs': 0, 'requests': len(data['requests'])}

def make_plan(server, generator, base_date):
    if not server.running():
        raise Stop('The existing app must already be running to generate a plan; no app is started automatically.')
    before = server.snapshot()
    data = validate_dataset(server.generate(generator, {'baseDate': base_date, 'people': before['people'], 'rooms': before['rooms']}), before, base_date)
    summary = {'mode': 'plan', 'base_date': base_date, 'delete_counts': {k: before['counts'][k] for k in DELETE_TABLES},
               'insert_counts': new_counts(data), 'preserve_counts': {k: before['counts'][k] for k in (*PRESERVED, 'rooms')},
               'add_rooms': [{k: r[k] for k in ('id', 'name', 'location', 'floor', 'capacity')} for r in data['addedRooms']],
               'inventory_sha256': digest(baseline(before)), 'dataset_sha256': digest(data),
               'generator_sha256': checksum_file(Path(generator))}
    return before, data, summary

def replacement_sql(data, before):
    lines = ['BEGIN;', "SET LOCAL standard_conforming_strings=on;", "SET LOCAL lock_timeout='30s';",
             "SELECT pg_advisory_xact_lock(hashtext('" + SCHEMA + "'));",
             'LOCK TABLE ' + ','.join(table(t) for t in TABLES) + ' IN ACCESS EXCLUSIVE MODE;',
             'DO $guard$ BEGIN IF ' + fingerprints_sql() + ' <> ' + quoted(canonical(before['fingerprints'])) +
             "::jsonb THEN RAISE EXCEPTION 'Inventory changed after planning'; END IF; END $guard$;"]
    lines += ['DELETE FROM ' + table(t) + ';' for t in DELETE_TABLES]
    def insert(name, columns, values):
        lines.append('INSERT INTO ' + table(name) + ' (' + ','.join(columns) + ') VALUES (' + ','.join(values) + ');')
    for room in data['addedRooms']:
        insert('rooms', ('id', 'data'), (quoted(room['id']), quoted(canonical(room)) + '::jsonb'))
    for topic in data['topics']:
        body = {k: v for k, v in topic.items() if k != 'roles'}
        insert('topics', ('id', 'data'), (quoted(topic['id']), quoted(canonical(body)) + '::jsonb'))
        for person, role in topic['roles'].items():
            insert('topic_members', ('topic_id', 'person_id', 'role'), (quoted(topic['id']), quoted(person), quoted(role)))
    for meeting in data['meetings']:
        body = {k: v for k, v in meeting.items() if k not in ('participantIds', 'attachments', 'files')}
        insert('meetings', ('id', 'topic_id', 'data'), (quoted(meeting['id']), quoted(meeting['topicId']), quoted(canonical(body)) + '::jsonb'))
        for person in meeting['participantIds']:
            insert('meeting_participants', ('meeting_id', 'person_id'), (quoted(meeting['id']), quoted(person)))
    for item in data['attachments']:
        insert('attachments', ('id', 'meeting_id', 'data', 'bytes'), (quoted(item['data']['id']), quoted(item['meetingId']),
               quoted(canonical(item['data'])) + '::jsonb', 'decode(' + quoted(item['bytes']) + ",'base64')"))
    for key, value in data['requests'].items():
        insert('requests', ('id', 'result'), (quoted(key), quoted(value)))
    return '\n'.join([*lines, 'COMMIT;'])

def logical_rows(data):
    return {
        'topics': [{'id': t['id'], 'data': {k: v for k, v in t.items() if k != 'roles'}} for t in data['topics']],
        'topic_members': [{'topic_id': t['id'], 'person_id': p, 'role': r} for t in data['topics'] for p, r in t['roles'].items()],
        'meetings': [{'id': m['id'], 'topic_id': m['topicId'], 'data': {k: v for k, v in m.items() if k not in ('participantIds', 'attachments', 'files')}} for m in data['meetings']],
        'meeting_participants': [{'meeting_id': m['id'], 'person_id': p} for m in data['meetings'] for p in m['participantIds']],
        'requests': [{'id': k, 'result': v} for k, v in data['requests'].items()],
    }

def verify_replacement(server, before, data):
    after = server.snapshot()
    if after['columns'] != before['columns'] or after['constraints'] != before['constraints']:
        raise Stop('Schema changed during replacement.')
    if any(after['fingerprints'][t] != before['fingerprints'][t] for t in PRESERVED):
        raise Stop('Preserved account, preference or metadata rows changed.')
    if any(after['counts'][t] != n for t, n in new_counts(data).items()):
        raise Stop('Replacement row counts differ from the plan.')
    if {r['id']: r for r in after['rooms']} != {r['id']: r for r in before['rooms'] + data['addedRooms']}:
        raise Stop('Existing or newly added room records differ from the plan.')
    expected_rows = logical_rows(data)
    row_pairs = ','.join(quoted(t) + ",(SELECT COALESCE(jsonb_agg(to_jsonb(r)),'[]') FROM " + table(t) + ' r)' for t in expected_rows)
    actual_rows = server.sql("SELECT jsonb_build_object('logical_rows',jsonb_build_object(" + row_pairs + '));')['logical_rows']
    if any(sorted(actual_rows.get(t, []), key=canonical) != sorted(rows, key=canonical) for t, rows in expected_rows.items()):
        raise Stop('Topic, meeting, membership or request marker contents differ from the plan.')
    files_sql = ("SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'meetingId',meeting_id,'data',data,"
                 "'size',octet_length(bytes),'sha256',encode(sha256(bytes),'hex')) ORDER BY id),'[]') FROM " + table('attachments') + ';')
    expected = [{'id': a['data']['id'], 'meetingId': a['meetingId'], 'data': a['data'],
                 'size': len(base64.b64decode(a['bytes'])), 'sha256': hashlib.sha256(base64.b64decode(a['bytes'])).hexdigest()}
                for a in data['attachments']]
    if server.sql(files_sql) != sorted(expected, key=lambda a: a['id']):
        raise Stop('Attachment metadata, bytes or hashes differ from the plan.')
    refs = ("SELECT jsonb_build_object('invalid',"
            '(SELECT count(*) FROM ' + table('meetings') + ' m LEFT JOIN ' + table('rooms') + " r ON r.id=m.data->>'roomId' LEFT JOIN " + table('people') + " p ON p.id=m.data->>'creatorId' WHERE r.id IS NULL OR p.id IS NULL)+"
            '(SELECT count(*) FROM ' + table('attachments') + ' a LEFT JOIN ' + table('people') + " p ON p.id=a.data->>'authorId' WHERE p.id IS NULL)+"
            '(SELECT count(*) FROM ' + table('meeting_participants') + ' p JOIN ' + table('meetings') + ' m ON m.id=p.meeting_id LEFT JOIN ' + table('topic_members') + ' t ON t.topic_id=m.topic_id AND t.person_id=p.person_id WHERE t.person_id IS NULL),'
            "'delivery_logs',(SELECT count(*) FROM " + table('delivery_logs') + '));')
    if server.sql(refs) != {'invalid': 0, 'delivery_logs': 0}:
        raise Stop('Reference checks failed or delivery logs appeared unexpectedly.')
    return after

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def probe(origin, expected=None, attempts=12):
    parsed = urllib.parse.urlsplit(origin)
    if (parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password
            or parsed.path not in ('', '/') or parsed.query or parsed.fragment):
        raise Stop('Use a plain HTTP(S) application origin without credentials or a path.')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    for attempt in range(attempts):
        try:
            def get(path):
                with opener.open(origin.rstrip('/') + path, timeout=10) as response:
                    return json.load(response)
            if get('/healthz').get('ok') is not True:
                raise ValueError('health')
            directory = get('/api/demo/directory')
            if expected:
                for kind in ('people', 'rooms'):
                    rows = expected[kind] if kind == 'rooms' else [p for p in expected['people'] if p.get('isTestAccount')]
                    if {r['id']: r for r in directory[kind]} != {r['id']: r for r in rows}:
                        raise ValueError('directory')
            return
        except (OSError, ValueError, KeyError):
            if attempt + 1 < attempts:
                time.sleep(2)
    raise Stop('Health/directory verification failed; TLS verification was not bypassed.')

def backup_parent(root):
    parent = root.parent / '.robot-butler-judging-backups'
    if parent.is_symlink():
        raise Stop('Backup parent may not be a symbolic link.')
    parent.mkdir(mode=0o700, exist_ok=True)
    if parent.stat().st_mode & 0o077:
        raise Stop('Existing backup parent must have private permissions (700).')
    return parent

def new_backup(root):
    path = backup_parent(root) / dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    path.mkdir(mode=0o700)
    return path

def restore(server, backup, state, *, restart):
    path = backup / 'database.dump'
    if checksum_file(path) != state['dump_sha256']:
        raise Stop('Backup checksum mismatch; restore is blocked.')
    server.check_dump(path)
    server.stop()
    server.restore_dump(path)
    current = server.snapshot()
    if baseline(current) != state['before']:
        raise Stop('Restored inventory differs from the original; app remains stopped.')
    if restart:
        server.start()
        probe(state['base_url'], current)
    return current

def stabilize_after_failure(server):
    try:
        server.stop()
        return 'stopped'
    except BaseException:
        try:
            return 'running' if server.running() else 'stopped'
        except BaseException:
            return 'unknown'

def recover_unknown_outcome(server, backup, state, before, data):
    # Never overwrite data from another writer after a lost response or timeout.
    server.stop()
    current = None
    try:
        current = server.snapshot()
    except Stop:
        pass
    if current is not None and baseline(current) == baseline(before):
        if state['was_running']:
            server.start()
            probe(state['base_url'], current)
        return 'unchanged_after_unknown_outcome'
    matches_plan = False
    if current is not None:
        try:
            verify_replacement(server, before, data)
            matches_plan = True
        except Stop:
            pass
    if matches_plan:
        restore(server, backup, state, restart=state['was_running'])
        return 'rolled_back_verified'
    rescue = new_backup(server.root)
    server.dump(rescue / 'database.dump')
    saved = {'app_dir': str(server.root), 'base_url': state['base_url'], 'was_running': False,
             'dump_sha256': checksum_file(rescue / 'database.dump'), 'status': 'unknown_outcome_preserved'}
    if current is not None:
        saved['before'] = baseline(current)
    private_json(rescue / 'state.json', saved)
    print('MANUAL RECOVERY REQUIRED; current data was preserved and app remains stopped. Rescue backup: ' + str(rescue), file=sys.stderr)
    return 'unknown_outcome_preserved_for_operator'

def apply_plan(server, before, data, summary, origin):
    if not server.running():
        raise Stop('App state changed after planning; create a fresh plan.')
    probe(origin, before)
    backup = new_backup(server.root)
    print('PRIVATE BACKUP: ' + str(backup), flush=True)
    private_json(backup / 'plan.json', summary)
    state = {'app_dir': str(server.root), 'base_url': origin, 'was_running': True, 'before': baseline(before)}
    stopped = mutation_attempted = unknown_outcome = False
    recovery_expected = before
    try:
        stopped = True
        server.stop()
        if baseline(server.snapshot()) != baseline(before):
            raise Stop('Data changed since planning; no replacement attempted. Create a fresh plan.')
        server.dump(backup / 'database.dump')
        state['dump_sha256'] = checksum_file(backup / 'database.dump')
        private_json(backup / 'state.json', state)
        mutation_attempted = True
        try:
            server.sql(replacement_sql(data, before), result=False)
        except SqlTransactionRejected:
            mutation_attempted = False
            # A guard rejection can mean another writer changed data after backup.
            # Restart using that current state, never the now-stale backup state.
            recovery_expected = None
            recovery_expected = server.snapshot()
            raise
        except SqlOutcomeUnknown:
            unknown_outcome = True
            raise
        after = verify_replacement(server, before, data)
        server.start()
        probe(origin, after)
        verify_replacement(server, before, data)
        result = {**summary, 'mode': 'apply', 'status': 'verified', 'backup': str(backup), 'app_running': True}
        private_json(backup / 'result.json', result)
        return result
    except BaseException:
        status = 'unchanged'
        try:
            if unknown_outcome:
                status = recover_unknown_outcome(server, backup, state, before, data)
            elif mutation_attempted:
                restore(server, backup, state, restart=state['was_running'])
                status = 'rolled_back_verified'
            elif stopped and state['was_running']:
                server.start()
                probe(origin, recovery_expected)
        except BaseException:
            status = 'recovery_unverified'
            app_state = stabilize_after_failure(server)
            print('RECOVERY NOT VERIFIED; app state: ' + app_state + '. Inspect the private backup.', file=sys.stderr)
        private_json(backup / 'failure.json', {'status': status, 'backup': str(backup)})
        raise

def rollback(server, backup):
    backup = Path(backup).absolute()
    if backup.is_symlink() or backup.parent != server.root.parent / '.robot-butler-judging-backups':
        raise Stop('Rollback must name a private backup for this installation.')
    for path in (backup, backup / 'state.json', backup / 'database.dump'):
        if path.is_symlink() or path.stat().st_mode & 0o077:
            raise Stop('Rollback files must be private and may not be symbolic links.')
    state = json.loads((backup / 'state.json').read_text())
    if state['app_dir'] != str(server.root):
        raise Stop('Backup belongs to another installation.')
    # A rescue dump preserves any work created since the original replacement.
    was_running, rescue = server.running(), new_backup(server.root)
    print('PRE-ROLLBACK BACKUP: ' + str(rescue), flush=True)
    stopped = mutation_attempted = False
    try:
        stopped = True
        server.stop()
        before = server.snapshot()
        server.dump(rescue / 'database.dump')
        rescue_state = {'app_dir': str(server.root), 'base_url': state['base_url'], 'was_running': was_running,
                        'before': baseline(before), 'dump_sha256': checksum_file(rescue / 'database.dump')}
        private_json(rescue / 'state.json', rescue_state)
        mutation_attempted = True
        restore(server, backup, state, restart=was_running)
        result = {'mode': 'rollback', 'status': 'verified', 'backup': str(backup),
                  'pre_rollback_backup': str(rescue), 'app_running': was_running}
        private_json(rescue / 'result.json', result)
        return result
    except BaseException:
        try:
            if mutation_attempted:
                restore(server, rescue, rescue_state, restart=was_running)
            elif stopped and was_running:
                server.start()
        except BaseException:
            app_state = stabilize_after_failure(server)
            print('ROLLBACK RECOVERY NOT VERIFIED; app state: ' + app_state + '. Inspect private backups.', file=sys.stderr)
        raise

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app-dir', type=Path, default=Path('/home/mattermost-admin/robot-butler-direct-20261026'))
    parser.add_argument('--generator', type=Path, default=Path(__file__).with_name('judging-dataset.mjs'))
    parser.add_argument('--base-date', default=dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).date().isoformat())
    parser.add_argument('--base-url', default=DEFAULT_URL)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--apply', action='store_true', help='Replace ALL topics/meetings/attachments/logs/request markers after verified backup.')
    mode.add_argument('--rollback', type=Path, help='Restore a named private full-database backup.')
    parser.add_argument('--summary', type=Path, help='Write a new private JSON summary; never overwrite a file.')
    parser.add_argument('--expect-plan', type=Path, help='Require the inventory/dataset/generator hashes from a previously saved plan.')
    args = parser.parse_args(argv)
    if dt.date.fromisoformat(args.base_date).isoformat() != args.base_date:
        raise Stop('--base-date must be YYYY-MM-DD.')
    os.umask(0o077)
    server = Server(args.app_dir)
    if not (server.root / 'butler').is_file() or not (server.root / '.env.selfhost').is_file():
        raise Stop('Existing app and settings required; no setup is performed.')
    if args.summary and args.summary.exists():
        raise Stop('Summary file exists; choose a new filename.')
    if args.apply or args.rollback:
        with (backup_parent(server.root) / '.maintenance.lock').open('a') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise Stop('Another data maintenance operation is running.') from None
            if args.rollback:
                result = rollback(server, args.rollback)
            else:
                before, data, summary = make_plan(server, args.generator, args.base_date)
                if args.expect_plan:
                    reviewed = json.loads(args.expect_plan.read_text())
                    keys = ('base_date', 'inventory_sha256', 'dataset_sha256', 'generator_sha256')
                    if any(reviewed.get(k) != summary[k] for k in keys):
                        raise Stop('Reviewed plan changed; generate and review a fresh plan.')
                print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
                result = apply_plan(server, before, data, summary, args.base_url)
    else:
        _, _, result = make_plan(server, args.generator, args.base_date)
    if args.summary:
        private_json(args.summary, result)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return result

if __name__ == '__main__':
    try:
        def terminate(_signum, _frame):
            raise KeyboardInterrupt()
        signal.signal(signal.SIGTERM, terminate)
        main()
    except (Stop, OSError, ValueError, TypeError, KeyError, KeyboardInterrupt) as error:
        print(str(error) if isinstance(error, Stop) else 'Stopped: invalid input, file or interrupted operation. Private details withheld.', file=sys.stderr)
        sys.exit(1)
