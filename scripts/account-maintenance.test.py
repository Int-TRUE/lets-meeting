#!/usr/bin/env python3
# coding: utf-8
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

mm = load('accounts', 'rename-mattermost-accounts.py')
app = load('update', 'update-selfhost-accounts.py')

class FakeAPI:
    def __init__(self):
        self.mapping = {actor: str(i + 1) * 26 for i, actor in enumerate(mm.TARGETS)}
        self.users = {uid: {'id': uid, 'profile': dict(zip(mm.FIELDS, [mm.OLD_HANDLES[actor], 'previous label', 'previous', 'label'])),
            'identity': {'roles': 'system_user', 'email': actor + '@example.invalid', 'auth_service': '', 'delete_at': 0, 'is_bot': False},
            'teams': [['team', 'team_user', True, False, 0]],
            'channels': [['channel', 'channel_user', True, False, False]]}
            for actor, uid in self.mapping.items()}
        self.writes = []
        self.fail_at = None
        self.lost_response = False
        self.external_owner = None
        self.mutate_permissions = False

    def snapshot(self, uid):
        return copy.deepcopy(self.users[uid])

    def request(self, path, data=None, missing=False):
        if '/username/' in path:
            name = path.rsplit('/', 1)[-1]
            if self.external_owner == name:
                return {'id': 'z' * 26}
            return next(({'id': uid} for uid, u in self.users.items() if u['profile']['username'] == name), None)
        uid = path.split('/')[2]
        self.writes.append((uid, copy.deepcopy(data)))
        if len(self.writes) == self.fail_at and not self.lost_response:
            raise mm.Stop('Injected failure')
        self.users[uid]['profile'] = copy.deepcopy(data)
        if self.mutate_permissions and len(self.writes) == 1:
            self.users[uid]['identity']['roles'] = 'changed elsewhere'
        if len(self.writes) == self.fail_at:
            raise mm.Stop('Injected lost response')
        return {'id': uid}


class AccountsTest(unittest.TestCase):
    def test_conflict_in_fourth_account_prevents_all_writes(self):
        api = FakeAPI()
        api.external_owner = 'jang'
        with self.assertRaises(mm.Stop):
            mm.plan(api, api.mapping)
        self.assertEqual(api.writes, [])

    def test_auth_provider_stops_before_any_write(self):
        api = FakeAPI()
        api.users[api.mapping['wooseok']]['identity']['auth_service'] = 'ldap'
        with self.assertRaises(mm.Stop):
            mm.plan(api, api.mapping)
        self.assertEqual(api.writes, [])

    def test_only_profile_fields_written_id_membership_roles_remain(self):
        api = FakeAPI()
        original = copy.deepcopy(api.users)
        with tempfile.TemporaryDirectory() as folder, contextlib.redirect_stdout(io.StringIO()):
            mm.apply(api, mm.plan(api, api.mapping), Path(folder))
            self.assertEqual(json.loads((Path(folder) / 'result.json').read_text())['status'], 'verified')
        for uid, data in api.writes:
            self.assertEqual(set(data), set(mm.FIELDS))
            self.assertTrue(mm.unchanged(original[uid], api.snapshot(uid)))
        self.assertEqual(len(api.writes), 4)
        # A repeat is a verified no-op, never creates replacement accounts.
        with tempfile.TemporaryDirectory() as folder, contextlib.redirect_stdout(io.StringIO()):
            mm.apply(api, mm.plan(api, api.mapping), Path(folder))
        self.assertEqual(len(api.writes), 4)

    def test_failure_and_lost_response_both_restore_attempted_profiles(self):
        for lost in (False, True):
            with self.subTest(lost=lost):
                api = FakeAPI()
                original = copy.deepcopy(api.users)
                api.fail_at = 2
                api.lost_response = lost
                with tempfile.TemporaryDirectory() as folder, contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                    with self.assertRaises(mm.Stop):
                        mm.apply(api, mm.plan(api, api.mapping), Path(folder))
                    result = json.loads((Path(folder) / 'result.json').read_text())
                    self.assertEqual(result['rollback_unverified'], [])
                    self.assertTrue((Path(folder) / 'attempt-jooyoung.json').exists())
                self.assertEqual(api.users, original)

    def test_race_conflict_restores_first_and_does_not_change_second(self):
        api = FakeAPI()
        records = mm.plan(api, api.mapping)
        original = copy.deepcopy(api.users)
        # Conflict appearing after preflight still prevents all writes.
        api.external_owner = 'jeong'
        with tempfile.TemporaryDirectory() as folder, contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(mm.Stop):
                mm.apply(api, records, Path(folder))
        self.assertEqual(api.users, original)
        self.assertEqual(api.writes, [])

    def test_concurrent_permission_changes_are_not_overwritten_during_recovery(self):
        api = FakeAPI()
        api.mutate_permissions = True
        with tempfile.TemporaryDirectory() as folder, contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(mm.Stop):
                mm.apply(api, mm.plan(api, api.mapping), Path(folder))
            self.assertEqual(json.loads((Path(folder) / 'result.json').read_text())['rollback_unverified'], ['sujin'])
        self.assertEqual(len(api.writes), 1)

    def test_mapping_requires_all_four_distinct_ids(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'settings'
            path.write_text("MATTERMOST_USER_MAP='" + json.dumps(FakeAPI().mapping) + "'\n")
            self.assertEqual(len(mm.mapping_from_env(path)), 4)
            path.write_text('MATTERMOST_USER_MAP={}\n')
            with self.assertRaises(mm.Stop):
                mm.mapping_from_env(path)

    def test_http_credentials_rejected_for_remote_and_redirects_disabled(self):
        for url in ('http://example.com', 'https://user:pass@example.com', 'https://example.com/path'):
            with self.assertRaises(mm.Stop):
                mm.API(url, 'private-token')
        self.assertIsNone(mm.NoRedirect().redirect_request(None, None, None, None, None, None))

    def test_restore_plan_preserves_existing_ids_and_rejects_later_profile_edits(self):
        api = FakeAPI()
        original = copy.deepcopy(api.users)
        with tempfile.TemporaryDirectory() as folder, contextlib.redirect_stdout(io.StringIO()):
            mm.apply(api, mm.plan(api, api.mapping), Path(folder))
        saved = {actor: original[uid] for actor, uid in api.mapping.items()}
        records = mm.plan(api, api.mapping, saved)
        self.assertEqual(records[0]['desired'], saved['sujin']['profile'])
        api.users[api.mapping['sujin']]['profile']['nickname'] = 'later manual edit'
        with self.assertRaises(mm.Stop):
            mm.plan(api, api.mapping, saved)

class ArchiveTest(unittest.TestCase):
    def test_checksum_traversal_links_and_secret_paths_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'release.tar.gz'
            for bad in ('../outside', '.env.selfhost', 'data/old.sqlite', 'linked'):
                with self.subTest(bad=bad):
                    with tarfile.open(path, 'w:gz') as tar:
                        entry = tarfile.TarInfo(bad)
                        if bad == 'linked':
                            entry.type = tarfile.SYMTYPE
                            entry.linkname = '/etc'
                        tar.addfile(entry)
                    checksum = hashlib.sha256(path.read_bytes()).hexdigest()
                    with self.assertRaises(app.Stop):
                        app.checked_archive(path, checksum)
                    with self.assertRaises(app.Stop):
                        app.checked_archive(path, '0' * 64)

    def test_source_only_release_is_accepted(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'release.tar.gz'
            with tarfile.open(path, 'w:gz') as tar:
                for name in ('butler', 'package.json', 'server/postgres.ts', 'src/data/testDirectory.ts'):
                    tar.addfile(tarfile.TarInfo(name))
            self.assertEqual(len(app.checked_archive(path, hashlib.sha256(path.read_bytes()).hexdigest())), 4)

class RestoreTest(unittest.TestCase):
    def test_app_rollback_restores_source_settings_image_without_database_restore(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / 'app'
            backup = Path(folder) / 'backup'
            root.mkdir()
            backup.mkdir()
            (root / 'added.txt').write_text('new')
            (backup / 'settings').write_text('original-private-settings')
            with tarfile.open(backup / 'source.tar.gz', 'w:gz') as tar:
                data = b'old source'
                info = tarfile.TarInfo('old.txt')
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
            state = {'added_files': ['added.txt'], 'previous_image': 'old-image', 'origin': 'http://127.0.0.1:8088'}
            with patch.object(app, 'run') as run, patch.object(app, 'probe') as probe, contextlib.redirect_stdout(io.StringIO()):
                app.restore(root, backup, state)
                self.assertEqual(run.call_args_list[0].args[0], ['./butler', 'stop', 'app'])
                self.assertIn('old-image', run.call_args_list[1].args[0])
                self.assertFalse(any('pg_restore' in c.args[0] for c in run.call_args_list))
                probe.assert_called_once_with(state['origin'])
            self.assertEqual((root / 'old.txt').read_text(), 'old source')
            self.assertEqual((root / '.env.selfhost').read_text(), 'original-private-settings')
            self.assertFalse((root / 'added.txt').exists())

if __name__ == '__main__':
    unittest.main()
