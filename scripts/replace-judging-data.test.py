#!/usr/bin/env python3
# coding: utf-8
"""Mocked lifecycle tests; optional isolated localhost PostgreSQL integration."""
import base64
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest
import urllib.parse
import uuid
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('replace_judging', Path(__file__).with_name('replace-judging-data.py'))
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)
DATE = '2026-10-28'
PEOPLE = [{'id': 'owner', 'name': "정금결's 이름", 'isTestAccount': True}, {'id': 'staff', 'name': '기존 직원'}]
ROOMS = [{'id': 'original-room', 'name': '기존 회의실', 'location': '명동', 'floor': '1층', 'capacity': 8, 'active': True}]
BYTES = '한글 첨부 자료\n작은따옴표 \' 와 $guard$'.encode()
DATA = {'prefix': 'final-judging', 'baseDate': DATE,
        'topics': [{'id': 'new-topic', 'title': "고객의 '질문'", 'description': '$guard$; -- 안전한 텍스트', 'roles': {'owner': 'Owner', 'staff': 'Attendee'}}],
        'meetings': [{'id': 'new-meeting', 'topicId': 'new-topic', 'title': '논의와 결정', 'creatorId': 'owner',
                      'participantIds': ['owner', 'staff'], 'roomId': 'new-room', 'room': '4층 회의실 A',
                      'start': DATE + 'T10:00', 'end': DATE + 'T11:00', 'files': ['자료.txt']}],
        'attachments': [{'meetingId': 'new-meeting', 'data': {'id': 'new-file', 'name': '자료.txt', 'type': 'text/plain',
                         'size': len(BYTES), 'authorId': 'owner', 'updatedAt': DATE + 'T09:00'}, 'bytes': base64.b64encode(BYTES).decode()}],
        'requests': {"key'\n": "value'\n"}, 'logs': [],
        'addedRooms': [{'id': 'new-room', 'name': '4층 회의실 A', 'location': '분당', 'floor': '4층', 'capacity': 6, 'active': True}]}

def before_snapshot():
    counts = {t: 1 for t in app.TABLES}
    counts.update(people=2, topic_members=2, meeting_participants=2)
    return {'counts': counts, 'fingerprints': {t: 'before-' + t for t in app.TABLES},
            'columns': [{'table': t, 'column': c, 'type': 'text', 'nullable': 'NO'} for t, cs in app.COLUMNS.items() for c in cs],
            'constraints': [{'name': 'reviewed-constraints'}], 'people': copy.deepcopy(PEOPLE), 'rooms': copy.deepcopy(ROOMS), 'seedVersion': '3'}

class Simulation:
    """Simulate container commands, including stdout file streams and restore input."""
    def __init__(self):
        self.current = before_snapshot()
        self.running = True
        self.calls = []
        self.dumps = {}
        self.fail_dump = self.fail_transaction = self.lost_response = self.corrupt_bytes = self.drift = False
        self.fail_list = self.corrupt_rows = self.guard_race = self.unknown_external_change = False
        self.mutations = self.restores = 0

    def __call__(self, command, **kwargs):
        self.calls.append((command, kwargs.get('input')))
        out = b''
        if command[1] == 'ps':
            out = b'container-id\n' if self.running else b''
        elif command[1] == 'stop':
            self.running = False
        elif command[1] == 'start':
            self.running = True
        elif 'node' in command:
            out = json.dumps(DATA).encode()
        elif 'pg_dump' in command:
            if self.fail_dump:
                raise subprocess.CalledProcessError(1, command, stderr=b'private password')
            stream = kwargs['stdout']
            payload = b'PGDMP:' + str(len(self.dumps)).encode() + b'x' * 100
            stream.write(payload)
            self.dumps[payload] = copy.deepcopy(self.current)
        elif 'pg_restore' in command:
            if '--list' in command:
                if self.fail_list:
                    raise subprocess.CalledProcessError(1, command)
                out = b'butler_selfhost TABLE DATA topics\n'
            else:
                self.restores += 1
                self.current = copy.deepcopy(self.dumps[kwargs['stdin'].read()])
        elif 'psql' in command:
            sql = kwargs['input'].decode()
            if 'DELETE FROM' in sql:
                self.mutations += 1
                if self.guard_race:
                    self.current['fingerprints']['topics'] = 'external-change-after-backup'
                    raise subprocess.CalledProcessError(3, command, stderr=b'private guard SQL')
                if not self.fail_transaction or self.lost_response:
                    self.current['counts'].update(app.new_counts(DATA))
                    self.current['counts']['rooms'] += len(DATA['addedRooms'])
                    self.current['rooms'] += copy.deepcopy(DATA['addedRooms'])
                    for table in (*app.DELETE_TABLES, 'rooms'):
                        self.current['fingerprints'][table] = 'after-' + table
                if self.unknown_external_change:
                    self.current['fingerprints']['people'] = 'unrelated-external-change'
                    raise subprocess.CalledProcessError(2, command, stderr=b'connection interrupted')
                if self.fail_transaction:
                    raise subprocess.CalledProcessError(1 if self.lost_response else 3, command, stderr=b'private SQL data')
            elif "'logical_rows'" in sql:
                rows = app.logical_rows(DATA)
                if self.corrupt_rows:
                    rows['requests'][0]['result'] = 'incorrect-suppression-marker'
                out = json.dumps({'logical_rows': rows}).encode()
            elif 'octet_length(bytes)' in sql:
                a = DATA['attachments'][0]
                value = [{'id': a['data']['id'], 'meetingId': a['meetingId'], 'data': a['data'], 'size': len(BYTES),
                          'sha256': 'wrong' if self.corrupt_bytes else hashlib.sha256(BYTES).hexdigest()}]
                out = json.dumps(value).encode()
            elif "'invalid'" in sql:
                out = b'{"invalid":0,"delivery_logs":0}'
            else:
                value = copy.deepcopy(self.current)
                if self.drift and not self.running:
                    value['fingerprints']['topics'] = 'concurrent-change'
                out = json.dumps(value).encode()
        else:
            raise AssertionError('Unexpected command: ' + repr(command))
        return subprocess.CompletedProcess(command, 0, stdout=out)

class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / 'app'
        self.root.mkdir()
        self.generator = self.root / 'judging-dataset.mjs'
        self.generator.write_text('export const buildDataset = () => ({});')
        self.sim = Simulation()
        self.server = app.Server(self.root)
        self.addCleanup(patch.stopall)
        patch.object(app.subprocess, 'run', side_effect=self.sim).start()
        self.probe = patch.object(app, 'probe').start()
        self.stdout = io.StringIO()
        self.stderr = io.StringIO()
        self.redirect_out = contextlib.redirect_stdout(self.stdout)
        self.redirect_out.__enter__()
        self.addCleanup(self.redirect_out.__exit__, None, None, None)
        self.redirect_err = contextlib.redirect_stderr(self.stderr)
        self.redirect_err.__enter__()
        self.addCleanup(self.redirect_err.__exit__, None, None, None)

    def plan(self):
        return app.make_plan(self.server, self.generator, DATE)

    def apply(self):
        return app.apply_plan(self.server, *self.plan(), app.DEFAULT_URL)

    def test_plan_is_readonly_counts_are_exact_and_output_omits_people(self):
        before, data, summary = self.plan()
        self.assertEqual(summary['delete_counts'], {t: before['counts'][t] for t in app.DELETE_TABLES})
        self.assertEqual(summary['insert_counts']['attachments'], 1)
        self.assertNotIn(PEOPLE[0]['name'], json.dumps(summary, ensure_ascii=False))
        self.assertEqual({c[0][1] for c in self.sim.calls}, {'ps', 'exec'})
        self.assertFalse((self.root.parent / '.robot-butler-judging-backups').exists())
        self.assertEqual(self.sim.mutations, 0)

    def test_backup_or_list_failure_prevents_deletion_and_restarts_app(self):
        for failure in ('fail_dump', 'fail_list'):
            with self.subTest(failure=failure):
                setattr(self.sim, failure, True)
                with self.assertRaises(app.Stop):
                    self.apply()
                self.assertEqual(self.sim.mutations, 0)
                self.assertEqual(self.sim.restores, 0)
                self.assertTrue(self.sim.running)
                setattr(self.sim, failure, False)

    def test_inventory_drift_after_stop_prevents_dump_and_deletion(self):
        self.sim.drift = True
        with self.assertRaisesRegex(app.Stop, 'changed since planning'):
            self.apply()
        self.assertEqual(self.sim.dumps, {})
        self.assertEqual(self.sim.mutations, 0)
        self.assertTrue(self.sim.running)

    def test_sql_rejection_preserves_state_and_lost_response_verifies_before_restore(self):
        for lost in (False, True):
            with self.subTest(lost=lost):
                self.sim.fail_transaction = True
                self.sim.lost_response = lost
                with self.assertRaises(app.Stop):
                    self.apply()
                self.assertEqual(self.sim.current, before_snapshot())
                self.assertTrue(self.sim.running)
        self.assertEqual(self.sim.restores, 1)
        restore_commands = [c for c, _ in self.sim.calls if 'pg_restore' in c and '--list' not in c]
        self.assertTrue(all('--clean' in c and '--single-transaction' in c for c in restore_commands))

    def test_late_inventory_guard_rejection_does_not_restore_over_external_changes(self):
        self.sim.guard_race = True
        with self.assertRaises(app.SqlTransactionRejected):
            self.apply()
        self.assertEqual(self.sim.restores, 0)
        self.assertEqual(self.sim.current['fingerprints']['topics'], 'external-change-after-backup')
        self.assertTrue(self.sim.running)
        expected = self.probe.call_args.args[1]
        self.assertEqual(expected['fingerprints']['topics'], 'external-change-after-backup')

    def test_unknown_commit_with_unrelated_changes_is_backed_up_and_left_stopped(self):
        self.sim.unknown_external_change = True
        with self.assertRaises(app.SqlOutcomeUnknown):
            self.apply()
        self.assertEqual(self.sim.restores, 0)
        self.assertEqual(self.sim.current['fingerprints']['people'], 'unrelated-external-change')
        self.assertFalse(self.sim.running)
        self.assertEqual(len(self.sim.dumps), 2)
        self.assertIn('MANUAL RECOVERY REQUIRED', self.stderr.getvalue())

    def test_success_preserves_directory_preferences_metadata_and_private_files(self):
        result = self.apply()
        self.assertEqual(result['status'], 'verified')
        for name in app.PRESERVED:
            self.assertEqual(self.sim.current['fingerprints'][name], before_snapshot()['fingerprints'][name])
        self.assertEqual(self.sim.current['rooms'][0], ROOMS[0])
        backup = Path(result['backup'])
        self.assertEqual(backup.stat().st_mode & 0o777, 0o700)
        self.assertTrue(all(p.stat().st_mode & 0o077 == 0 for p in backup.iterdir()))
        self.assertFalse(any('build' in c or 'up' in c for c, _ in self.sim.calls))
        self.assertFalse(any(p.name.startswith('.env') for p in backup.iterdir()))

    def test_attachment_hash_failure_restores_before_restart(self):
        self.sim.corrupt_bytes = True
        with self.assertRaisesRegex(app.Stop, 'Attachment'):
            self.apply()
        self.assertEqual(self.sim.restores, 1)
        self.assertEqual(self.sim.current, before_snapshot())

    def test_request_marker_content_mismatch_triggers_restore(self):
        self.sim.corrupt_rows = True
        with self.assertRaisesRegex(app.Stop, 'request marker contents'):
            self.apply()
        self.assertEqual(self.sim.restores, 1)
        self.assertEqual(self.sim.current, before_snapshot())

    def test_failed_recovery_probe_stops_app_and_reports_actual_state(self):
        self.probe.side_effect = [None, app.Stop('New app health failure'), app.Stop('Restored app health failure')]
        with self.assertRaises(app.Stop):
            self.apply()
        self.assertFalse(self.sim.running)
        self.assertIn('app state: stopped', self.stderr.getvalue())
        self.assertEqual(self.sim.current, before_snapshot())

    def test_previously_reviewed_plan_hash_mismatch_prevents_stop_and_changes(self):
        (self.root / 'butler').write_text('placeholder')
        (self.root / '.env.selfhost').write_text('test-only-placeholder')
        _, _, summary = self.plan()
        summary['dataset_sha256'] = 'changed'
        saved = self.root / 'reviewed-plan.json'
        saved.write_text(json.dumps(summary))
        with self.assertRaisesRegex(app.Stop, 'Reviewed plan changed'):
            app.main(['--app-dir', str(self.root), '--generator', str(self.generator), '--base-date', DATE,
                      '--apply', '--expect-plan', str(saved)])
        self.assertEqual(self.sim.mutations, 0)
        self.assertFalse(any(c[1] == 'stop' for c, _ in self.sim.calls))

    def test_explicit_rollback_backs_up_later_state_and_keeps_stopped_app_stopped(self):
        result = self.apply()
        self.sim.running = False
        restored = app.rollback(self.server, Path(result['backup']))
        self.assertEqual(restored['status'], 'verified')
        self.assertFalse(self.sim.running)
        self.assertEqual(self.sim.current, before_snapshot())
        self.assertTrue((Path(restored['pre_rollback_backup']) / 'database.dump').is_file())

    def test_sql_quotes_korean_apostrophes_and_never_deletes_preserved_tables(self):
        sql = app.replacement_sql(DATA, before_snapshot())
        self.assertIn(app.quoted("key'\n"), sql)
        body = {k: v for k, v in DATA['topics'][0].items() if k != 'roles'}
        self.assertIn(app.quoted(app.canonical(body)) + '::jsonb', sql)
        self.assertIn("pg_advisory_xact_lock(hashtext('butler_selfhost'))", sql)
        self.assertIn('IN ACCESS EXCLUSIVE MODE', sql)
        for name in (*app.PRESERVED, 'rooms'):
            self.assertNotIn('DELETE FROM ' + app.table(name), sql)
        literal = app.quoted("한글 ' \\ $guard$; DROP TABLE anything; --\n")
        delimiter = literal[:literal.index('$', 1) + 1]
        self.assertEqual(literal.count(delimiter), 2)

    def test_invalid_refs_room_collisions_fake_logs_and_bytes_rejected(self):
        variants = []
        for mutate in (lambda d: d['meetings'][0].update(creatorId='missing'),
                       lambda d: d['addedRooms'][0].update(id='original-room'),
                       lambda d: d['logs'].append({'result': 'sent'}),
                       lambda d: d['attachments'][0]['data'].update(size=999)):
            value = copy.deepcopy(DATA)
            mutate(value)
            variants.append(value)
        for data in variants:
            with self.assertRaises(app.Stop):
                app.validate_dataset(data, before_snapshot(), DATE)

    def test_command_error_never_discloses_stderr(self):
        self.sim.fail_dump = True
        with self.assertRaises(app.Stop) as caught:
            self.apply()
        self.assertNotIn('private password', str(caught.exception))
        self.assertNotIn('private password', self.stdout.getvalue() + self.stderr.getvalue())

    def test_directory_probe_compares_only_sign_in_accounts_but_all_rooms(self):
        patch.stopall()
        payloads = [{'ok': True}, {'people': [PEOPLE[0]], 'rooms': ROOMS}]
        class Response(io.StringIO):
            def __enter__(self): return self
            def __exit__(self, *args): self.close()
        class Opener:
            def open(self, *args, **kwargs): return Response(json.dumps(payloads.pop(0)))
        with patch.object(app.urllib.request, 'build_opener', return_value=Opener()):
            app.probe(app.DEFAULT_URL, {'people': PEOPLE, 'rooms': ROOMS}, attempts=1)
        self.assertEqual(payloads, [])

# This integration never contacts an arbitrary or production hostname/database.
PG_URL = os.environ.get('POSTGRES_TEST_URL')
PG_TOOLS = bool(shutil.which('psql'))

@unittest.skipUnless(PG_URL and PG_TOOLS, 'POSTGRES_TEST_URL or psql unavailable; isolated integration skipped')
class PostgreSQLIntegration(unittest.TestCase):
    def setUp(self):
        parsed = urllib.parse.urlsplit(PG_URL)
        if parsed.hostname not in ('127.0.0.1', 'localhost', '::1') or parsed.path != '/butler_test':
            self.fail('Integration requires localhost and the dedicated butler_test database.')
        self.schema = 'butler_test_judging_' + uuid.uuid4().hex[:16]
        self.assertRegex(self.schema, r'^butler_test_judging_[a-f0-9]{16}$')
        self.env = {**os.environ, 'PGPASSWORD': urllib.parse.unquote(parsed.password or '')}
        self.connection = ['--host', parsed.hostname, '--port', str(parsed.port or 5432),
                           '--username', urllib.parse.unquote(parsed.username or 'postgres'), '--dbname', 'butler_test']
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.schema_patch = patch.object(app, 'SCHEMA', self.schema)
        self.schema_patch.start()
        self.addCleanup(self.schema_patch.stop)
        self.addCleanup(lambda: self.sql('DROP SCHEMA IF EXISTS "' + self.schema + '" CASCADE;', result=False))
        definitions = {
            'metadata': 'key TEXT PRIMARY KEY,value TEXT NOT NULL', 'people': 'id TEXT PRIMARY KEY,data JSONB NOT NULL',
            'rooms': 'id TEXT PRIMARY KEY,data JSONB NOT NULL', 'topics': 'id TEXT PRIMARY KEY,data JSONB NOT NULL',
            'topic_members': 'topic_id TEXT REFERENCES {topics}(id),person_id TEXT REFERENCES {people}(id),role TEXT CHECK(role IN (\'Owner\',\'Master\',\'Attendee\')),PRIMARY KEY(topic_id,person_id)',
            'meetings': 'id TEXT PRIMARY KEY,topic_id TEXT REFERENCES {topics}(id),data JSONB NOT NULL',
            'meeting_participants': 'meeting_id TEXT REFERENCES {meetings}(id),person_id TEXT REFERENCES {people}(id),PRIMARY KEY(meeting_id,person_id)',
            'attachments': 'id TEXT PRIMARY KEY,meeting_id TEXT REFERENCES {meetings}(id),data JSONB NOT NULL,bytes BYTEA',
            'preferences': 'person_id TEXT PRIMARY KEY REFERENCES {people}(id),data JSONB NOT NULL',
            'delivery_logs': 'id TEXT PRIMARY KEY,data JSONB NOT NULL', 'requests': 'id TEXT PRIMARY KEY,result TEXT NOT NULL'}
        ddl = 'CREATE SCHEMA "' + self.schema + '";\n'
        for name, body in definitions.items():
            ddl += 'CREATE TABLE ' + app.table(name) + '(' + body.format(**{t: app.table(t) for t in app.TABLES}) + ');\n'
        ddl += 'INSERT INTO ' + app.table('metadata') + " VALUES ('seed-version','3'),('preserve-key','value');\n"
        for person in PEOPLE:
            ddl += 'INSERT INTO ' + app.table('people') + ' VALUES (' + app.quoted(person['id']) + ',' + app.quoted(app.canonical(person)) + '::jsonb);\n'
        for room in ROOMS:
            ddl += 'INSERT INTO ' + app.table('rooms') + ' VALUES (' + app.quoted(room['id']) + ',' + app.quoted(app.canonical(room)) + '::jsonb);\n'
        ddl += 'INSERT INTO ' + app.table('preferences') + " VALUES ('owner','{\"materials\":false}'::jsonb);\n"
        ddl += 'INSERT INTO ' + app.table('topics') + " VALUES ('old-topic','{\"id\":\"old-topic\"}'::jsonb);\n"
        ddl += 'INSERT INTO ' + app.table('delivery_logs') + " VALUES ('old-log','{\"result\":\"pending\"}'::jsonb);\n"
        ddl += 'INSERT INTO ' + app.table('requests') + " VALUES ('old-request','old-result');\n"
        self.sql(ddl, result=False)
        outer = self
        class LocalServer(app.Server):
            def sql(self, statement, *, result=True): return outer.sql(statement, result=result)
        self.server = LocalServer(self.temp.name)

    def run_tool(self, tool, extra, data=None):
        args = [tool, *self.connection, *extra]
        result = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=self.env)
        if result.returncode:
            raise app.Stop('Isolated PostgreSQL test command failed (private output withheld).')
        return result.stdout

    def sql(self, statement, *, result=True):
        output = self.run_tool('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], statement.encode())
        return json.loads(output) if result else None

    def test_real_replace_preserves_records_and_attachment_bytes(self):
        before = self.server.snapshot()
        app.validate_dataset(DATA, before, DATE)
        self.server.sql(app.replacement_sql(DATA, before), result=False)
        after = app.verify_replacement(self.server, before, DATA)
        self.assertEqual(after['counts']['rooms'], 2)
        self.assertEqual(after['counts']['delivery_logs'], 0)

    def test_real_replace_preserves_records_and_restores_custom_format_backup(self):
        if not all(shutil.which(t) for t in ('pg_dump', 'pg_restore')):
            self.skipTest('Optional pg_dump/pg_restore tools unavailable; SQL replacement is covered separately')
        version = subprocess.run(['pg_dump', '--version'], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True).stdout
        client = int(re.search(r'(\d+)', version).group(1))
        server = self.sql("SELECT current_setting('server_version_num')::integer;") // 10000
        if client < server:
            self.skipTest('Optional dump client is older than the test server; SQL replacement is covered separately')
        before = self.server.snapshot()
        app.validate_dataset(DATA, before, DATE)
        dump = self.run_tool('pg_dump', ['-Fc', '--schema', self.schema])
        self.server.sql(app.replacement_sql(DATA, before), result=False)
        after = app.verify_replacement(self.server, before, DATA)
        self.assertEqual(after['counts']['rooms'], 2)
        self.run_tool('pg_restore', ['--clean', '--if-exists', '--single-transaction', '--exit-on-error'], dump)
        self.assertEqual(app.baseline(self.server.snapshot()), app.baseline(before))

    def test_real_failed_insert_and_stale_inventory_leave_old_data_unchanged(self):
        before = self.server.snapshot()
        bad = copy.deepcopy(DATA)
        bad['meetings'][0]['participantIds'].append('unknown-person')
        with self.assertRaises(app.Stop):
            self.server.sql(app.replacement_sql(bad, before), result=False)
        self.assertEqual(app.baseline(self.server.snapshot()), app.baseline(before))
        stale = copy.deepcopy(before)
        stale['fingerprints']['topics'] = 'stale'
        with self.assertRaises(app.Stop):
            self.server.sql(app.replacement_sql(DATA, stale), result=False)
        self.assertEqual(app.baseline(self.server.snapshot()), app.baseline(before))

if __name__ == '__main__':
    unittest.main()
