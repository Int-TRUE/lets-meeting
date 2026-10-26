import unittest
from unittest.mock import patch
from selfhost_network import http_settings, replace_settings

class NetworkTests(unittest.TestCase):
    def test_settings_preserve_secrets_and_are_idempotent(self):
        with patch('subprocess.check_output', return_value='100.123.150.118\n'):
            settings = http_settings()
        original = 'POSTGRES_PASSWORD=keep\nMATTERMOST_BOT_TOKEN=keep-token\nPUBLIC_ORIGIN=https://old.ts.net\nMATTERMOST_INTERACTION_SECRET=keep-key\n'
        updated = replace_settings(original, settings)
        self.assertIn('POSTGRES_PASSWORD=keep\n', updated)
        self.assertIn('MATTERMOST_BOT_TOKEN=keep-token\n', updated)
        self.assertIn('MATTERMOST_INTERACTION_SECRET=keep-key\n', updated)
        self.assertNotIn('https://old', updated)
        self.assertEqual(updated, replace_settings(updated, settings))
        self.assertEqual(settings['ROBOT_BUTLER_BIND_IP'], '100.123.150.118')

    def test_reject_non_tailnet_address(self):
        for value in ['192.168.1.1', '0.0.0.0', '100.128.0.1', '']:
            with patch('subprocess.check_output', return_value=value):
                with self.assertRaises(ValueError):
                    http_settings()

if __name__ == '__main__':
    unittest.main()
