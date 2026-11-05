from pathlib import Path
import runpy
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
prepare = runpy.run_path(str(ROOT / "scripts/prepare-browser.py"))["prepare"]
TEST_HASH = "$2a$14$" + "A" * 53


class BrowserBundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)

    def test_no_secrets_keeps_local_only_access(self):
        self.assertFalse(prepare(self.directory, {}))
        self.assertFalse((self.directory / "compose.override.yml").exists())

    def test_only_hash_is_written_and_dollar_signs_survive(self):
        password = "private-test-password-529"
        environment = {"LOGS_UI_USERNAME": "vefa", "LOGS_UI_PASSWORD": password}
        self.assertTrue(prepare(self.directory, environment, lambda _: TEST_HASH))
        credentials = self.directory / "browser.env"
        self.assertIn(TEST_HASH, credentials.read_text())
        self.assertNotIn(password, credentials.read_text())
        self.assertEqual(credentials.stat().st_mode & 0o777, 0o600)
        self.assertIn("format: raw", (self.directory / "compose.override.yml").read_text())

    def test_incomplete_credentials_and_config_injection_are_rejected(self):
        for environment in [
            {"LOGS_UI_USERNAME": "vefa"},
            {"LOGS_UI_PASSWORD": "private-test-password"},
            {"LOGS_UI_USERNAME": "bad user}", "LOGS_UI_PASSWORD": "private-test-password"},
            {"LOGS_UI_USERNAME": "vefa", "LOGS_UI_PASSWORD": "short"},
            {"LOGS_UI_USERNAME": "vefa", "LOGS_UI_PASSWORD": "A" * 73},
            {"LOGS_UI_USERNAME": "vefa", "LOGS_UI_PASSWORD": "private-password\n"},
        ]:
            with self.subTest(environment=list(environment)):
                with self.assertRaises(ValueError):
                    prepare(self.directory, environment, lambda _: TEST_HASH)
        self.assertFalse((self.directory / "browser.env").exists())
