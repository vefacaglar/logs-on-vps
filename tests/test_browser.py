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
            "    restart: unless-stopped", "    ports: ['127.0.0.1::8080']\n    environment:\n      LOGS_INSECURE_COOKIE: '1'\n    restart: unless-stopped"
        ).replace("path: ./browser.env", "path: " + json.dumps(str(Path(cls.directory.name) / "browser.env")))
        override.write_text(config)
        cls.command(["docker", "network", "create", cls.network])
        cls.command(cls.compose + ["up", "--build", "-d", "browser"])
        cls.url = "http://" + cls.command(cls.compose + ["port", "browser", "8080"]).strip()
        cls.opener = urllib.request.build_opener(NoRedirect())
        for _ in range(30):
            try:
                if cls.request("/api/session")[0] == 401:
                    break
            except OSError:
                pass
            time.sleep(1)
        else:
            raise RuntimeError("Browser authentication did not become ready")
        status, headers, _ = cls.login(cls.password)
        if status != 200:
            raise RuntimeError("Session login failed")
        cls.cookie = headers["Set-Cookie"].split(";", 1)[0]

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
    def request(cls, path, authenticated=False, data=None, json_body=None):
        headers = {"Origin": cls.url, "X-Requested-With": "logs-ui"}
        if authenticated:
            headers["Cookie"] = cls.cookie
        if json_body is not None:
            data = json.dumps(json_body).encode()
            headers["Content-Type"] = "application/json"
        elif data is not None:
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        request = urllib.request.Request(cls.url + path, headers=headers, data=data)
        try:
            with cls.opener.open(request, timeout=15) as response:
                return response.status, response.headers, response.read()
        except urllib.error.HTTPError as error:
            try:
                return error.code, error.headers, error.read()
            finally:
                error.close()

    @classmethod
    def login(cls, password):
        return cls.request("/api/login", json_body={"username": "vefa", "password": password})

    def test_anonymous_and_invalid_credentials_are_denied(self):
        self.assertEqual(self.request("/")[0], 303)
        self.assertEqual(self.request("/select/vmui/")[0], 303)
        self.assertEqual(self.request("/api/session")[0], 401)
        self.assertEqual(self.login("wrong")[0], 401)
        self.assertEqual(self.request("/login")[0], 200)

    def test_authenticated_ui_and_post_query_work(self):
        status, _, content = self.request("/", authenticated=True)
        self.assertEqual(status, 200)
        self.assertIn(b'/assets/', content)
        status, _, advanced = self.request("/explore", authenticated=True)
        self.assertEqual(status, 200)
        self.assertIn(b'id="root"', advanced)
        self.assertIn(b'/assets/', advanced)
        self.assertEqual(self.request('/select/vmui/assets/index.js', authenticated=True)[0], 404)
        data = urllib.parse.urlencode({"query": "_time:1m", "limit": "1"}).encode()
        self.assertEqual(self.request("/select/logsql/query", authenticated=True, data=data)[0], 200)
        end = time.time()
        status, _, body = self.request("/api/logs", authenticated=True, json_body={
            "query": "*", "start": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(end - 3600)),
            "end": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(end)), "offset": 0,
        })
        self.assertEqual(status, 200, body)
        self.assertIn("logs", json.loads(body))

    def test_ingestion_and_system_endpoints_are_not_published(self):
        for path in ["/insert/jsonline", "/delete/0", "/metrics", "/flags", "/debug/pprof/", "/health"]:
            with self.subTest(path=path):
                self.assertEqual(self.request(path, authenticated=True)[0], 404)

    def test_existing_caddy_is_configured_automatically_without_changing_other_sites(self):
        name = 'logs-main-caddy-' + uuid.uuid4().hex[:12]
        module = runpy.run_path(str(ROOT / 'scripts/configure-caddy.py'))
        with tempfile.TemporaryDirectory(prefix='logs-main-caddy-') as directory:
            path = Path(directory)
            source = path / 'Caddyfile'
            original = '{\n    local_certs\n    skip_install_trust\n}\n\nhttp://existing.example.test:8080 {\n    respond "existing survives"\n}\n'
            source.write_text(original)
            inode = source.stat().st_ino
            settings = path / 'settings.json'
            settings.write_text(json.dumps({'container': name, 'config_path': ''}))
            image = runpy.run_path(str(ROOT / 'scripts/prepare-browser.py'))['CADDY_IMAGE']
            try:
                self.command(['docker', 'run', '-d', '--rm', '--name', name, '--network', self.network,
                              '-p', '127.0.0.1::443', '-p', '127.0.0.1::8080', '--mount',
                              f'type=bind,source={source},target=/etc/caddy/Caddyfile', image])
                http_address = self.command(['docker', 'port', name, '8080']).strip()
                https_port = self.command(['docker', 'port', name, '443']).strip().rsplit(':', 1)[1]
                for _ in range(30):
                    try:
                        self.command(['curl', '--fail', '--silent', '--max-time', '2',
                                      '-H', 'Host: existing.example.test', 'http://' + http_address])
                        break
                    except subprocess.CalledProcessError:
                        time.sleep(1)
                else:
                    self.fail('Existing Caddy did not become ready')
                module['main'](settings, path / 'backups')
                module['main'](settings, path / 'backups')
                self.assertTrue(source.read_text().startswith(original))
                self.assertEqual(source.read_text().count(module['BEGIN']), 1)
                self.assertEqual(source.stat().st_ino, inode)
                self.assertEqual(self.command(['curl', '--fail', '--silent', '--max-time', '3',
                                              '-H', 'Host: existing.example.test', 'http://' + http_address]), 'existing survives')
                # This test uses Caddy's private CA, never a public TLS bypass.
                request = ['curl', '--silent', '--show-error', '--insecure', '--max-time', '10',
                           '--resolve', f'{module["DOMAIN"]}:{https_port}:127.0.0.1',
                           '--output', '/dev/null', '--write-out', '%{http_code}']
                url = f'https://{module["DOMAIN"]}:{https_port}/explore'
                for _ in range(20):
                    try:
                        status = self.command(request + [url])
                        if status == '303':
                            break
                    except subprocess.CalledProcessError:
                        pass
                    time.sleep(1)
                else:
                    self.fail('Managed HTTPS route did not require authentication')
                self.assertEqual(self.command(request + ['--cookie', self.cookie, url]), '200')
            finally:
                subprocess.run(['docker', 'rm', '-f', name], capture_output=True)
