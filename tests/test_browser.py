import base64
import json
import os
from pathlib import Path
import runpy
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
import uuid


ROOT = Path(__file__).resolve().parents[1]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


@unittest.skipUnless(os.environ.get("RUN_BROWSER_TEST") == "1", "Set RUN_BROWSER_TEST=1 for Docker browser tests")
class BrowserIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix="logs-browser-")
        cls.network = "logs-browser-" + uuid.uuid4().hex[:12]
        cls.password = "ephemeral-browser-" + uuid.uuid4().hex
        cls.environment = dict(os.environ, LOGS_PROXY_NETWORK=cls.network)
        cls.compose = ["docker", "compose", "-f", str(ROOT / "compose.yml"),
                       "-f", str(Path(cls.directory.name) / "compose.override.yml")]
        cls.addClassCleanup(cls.cleanup)
        prepare = runpy.run_path(str(ROOT / "scripts/prepare-browser.py"))["prepare"]
        prepare(cls.directory.name, {"LOGS_UI_USERNAME": "vefa", "LOGS_UI_PASSWORD": cls.password})
        override = Path(cls.directory.name) / "compose.override.yml"
        # Test-only loopback port; production publishes no browser container port.
        config = override.read_text().replace(
            "    restart: unless-stopped", "    ports: ['127.0.0.1::8080']\n    restart: unless-stopped"
        ).replace("path: ./browser.env", "path: " + json.dumps(str(Path(cls.directory.name) / "browser.env")))
        override.write_text(config)
        cls.command(["docker", "network", "create", cls.network])
        cls.command(cls.compose + ["up", "-d", "browser"])
        cls.url = "http://" + cls.command(cls.compose + ["port", "browser", "8080"]).strip()
        cls.opener = urllib.request.build_opener(NoRedirect())
        for _ in range(30):
            try:
                if cls.request("/select/vmui/")[0] == 401:
                    break
            except OSError:
                pass
            time.sleep(1)
        else:
            raise RuntimeError("Browser authentication did not become ready")

    @classmethod
    def command(cls, arguments):
        return subprocess.run(arguments, cwd=ROOT, env=cls.environment, check=True,
                              capture_output=True, text=True).stdout

    @classmethod
    def cleanup(cls):
        subprocess.run(cls.compose + ["rm", "--stop", "--force", "browser"], cwd=ROOT,
                       env=cls.environment, capture_output=True)
        subprocess.run(["docker", "network", "rm", cls.network], capture_output=True)
        cls.directory.cleanup()

    @classmethod
    def request(cls, path, password=None, data=None):
        headers = {}
        if password is not None:
            token = base64.b64encode(("vefa:" + password).encode()).decode()
            headers["Authorization"] = "Basic " + token
        request = urllib.request.Request(cls.url + path, headers=headers, data=data)
        try:
            with cls.opener.open(request, timeout=15) as response:
                return response.status, response.headers, response.read()
        except urllib.error.HTTPError as error:
            try:
                return error.code, error.headers, error.read()
            finally:
                error.close()

    def test_anonymous_and_invalid_credentials_are_denied(self):
        self.assertEqual(self.request("/")[0], 401)
        self.assertEqual(self.request("/select/vmui/")[0], 401)
        self.assertEqual(self.request("/select/vmui/", password="wrong")[0], 401)

    def test_authenticated_ui_and_post_query_work(self):
        status, headers, _ = self.request("/", password=self.password)
        self.assertEqual(status, 302)
        self.assertEqual(headers["Location"], "/select/vmui/")
        self.assertEqual(self.request("/select/vmui/", password=self.password)[0], 200)
        data = urllib.parse.urlencode({"query": "_time:1m", "limit": "1"}).encode()
        self.assertEqual(self.request("/select/logsql/query", password=self.password, data=data)[0], 200)

    def test_ingestion_and_system_endpoints_are_not_published(self):
        for path in ["/insert/jsonline", "/delete/0", "/metrics", "/flags", "/debug/pprof/", "/health"]:
            with self.subTest(path=path):
                self.assertEqual(self.request(path, password=self.password)[0], 404)
