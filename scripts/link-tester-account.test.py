import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('link_tester', Path(__file__).with_name('link-tester-account.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class MappingTests(unittest.TestCase):
    def test_preserves_other_settings_and_is_idempotent(self):
        original = "SECRET=keep\nMATTERMOST_USER_MAP='{}'\nORIGIN=keep\n"
        result = m.updated_settings(original, 't'*26)
        self.assertIn('SECRET=keep\n', result)
        self.assertIn('\nORIGIN=keep\n', result)
        self.assertEqual(m.updated_settings(result, 't'*26), result)

    def test_preserves_existing_mapping(self):
        text = "MATTERMOST_USER_MAP='" + '{"sujin":"'+'s'*26+'"}' + "'\n"
        self.assertIn('"sujin":"'+'s'*26+'"', m.updated_settings(text, 't'*26))

    def test_rejects_collisions_and_invalid_settings(self):
        for text in ['', 'MATTERMOST_USER_MAP={}\nMATTERMOST_USER_MAP={}\n',
                     'MATTERMOST_USER_MAP={"tester":"'+'s'*26+'"}\n',
                     'MATTERMOST_USER_MAP={"sujin":"'+'t'*26+'"}\n',
                     'MATTERMOST_USER_MAP=[]\n']:
            with self.assertRaises(m.Stop):
                m.updated_settings(text, 't'*26)

if __name__ == '__main__':
    unittest.main()
