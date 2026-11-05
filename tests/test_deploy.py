import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
DEPLOY_ID = "a" * 40 + "-123-1"
NEXT_ID = "b" * 40 + "-124-1"


class ActivationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="logs-deploy-", dir="/tmp")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)

    def release(self, deploy_id, status=0):
        release = self.base / "releases" / deploy_id
        (release / "scripts").mkdir(parents=True)
        (release / ".env.example").write_text("VPS_LOG_HOST=default\n")
        start = release / "scripts/start.sh"
        start.write_text(
            f"#!/bin/sh\nprintf '%s\\n' '{deploy_id}' >> '{self.base}/attempts'\nexit {status}\n"
        )
        start.chmod(0o755)
        return release

    def activate(self, deploy_id):
        return subprocess.run(
            ["bash", str(ROOT / "scripts/activate.sh"), str(self.base), deploy_id],
            capture_output=True, text=True,
        )

    def test_success_keeps_server_environment_and_switches_release(self):
        self.release(DEPLOY_ID)
        self.assertEqual(self.activate(DEPLOY_ID).returncode, 0)
        (self.base / ".env").write_text("VPS_LOG_HOST=custom\n")
        newer = self.release(NEXT_ID)
        result = self.activate(NEXT_ID)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.base / "current").resolve(), newer)
        self.assertEqual((newer / ".env").read_text(), "VPS_LOG_HOST=custom\n")
        self.assertEqual((self.base / ".env").stat().st_mode & 0o777, 0o600)

    def test_failed_update_restores_previous_release_and_reports_failure(self):
        previous = self.release(DEPLOY_ID)
        self.assertEqual(self.activate(DEPLOY_ID).returncode, 0)
        self.release(NEXT_ID, status=1)
        result = self.activate(NEXT_ID)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.base / "current").resolve(), previous)
        self.assertEqual((self.base / "attempts").read_text().splitlines(), [DEPLOY_ID, NEXT_ID, DEPLOY_ID])

    def test_first_deploy_failure_does_not_publish_current_link(self):
        self.release(DEPLOY_ID, status=1)
        result = self.activate(DEPLOY_ID)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("No previous managed release", result.stderr)
        self.assertFalse((self.base / "current").exists())

    def test_rollback_failure_is_explicit(self):
        self.release(DEPLOY_ID)
        self.assertEqual(self.activate(DEPLOY_ID).returncode, 0)
        (self.base / "releases" / DEPLOY_ID / "scripts/start.sh").write_text("#!/bin/sh\nexit 1\n")
        self.release(NEXT_ID, status=1)
        result = self.activate(NEXT_ID)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Rollback also failed", result.stderr)


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="logs-transport-", dir="/tmp")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.repo = self.base / "repo"
        shutil.copytree(ROOT, self.repo, ignore=shutil.ignore_patterns(".git", "__pycache__", ".env"))
        (self.repo / ".env").write_text("DO_NOT_UPLOAD=private\n")
        (self.repo / "unrelated-private.txt").write_text("private\n")
        self.bin = self.base / "bin"
        self.bin.mkdir()
        fake_ssh = self.bin / "ssh"
        fake_ssh.write_text("""#!/usr/bin/env python3
import json, os, pathlib, stat, sys
args = sys.argv[1:]
key = pathlib.Path(args[args.index('-i') + 1])
assert stat.S_IMODE(key.stat().st_mode) == 0o600
with open(os.environ['SSH_CALLS'], 'a') as f:
    f.write(json.dumps(args) + '\\n')
if args[-1].startswith('tar '):
    pathlib.Path(os.environ['BUNDLE_COPY']).write_bytes(sys.stdin.buffer.read())
if 'activate.sh' in args[-1]:
    sys.exit(int(os.environ.get('ACTIVATE_STATUS', '0')))
""")
        fake_ssh.chmod(0o755)
        self.env = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ["PATH"],
                        VPS_HOST="vps.example.test", VPS_USER="root", VPS_PORT="22",
                        VPS_SSH_KEY="test-private-key", VPS_KNOWN_HOSTS="test-host-key",
                        VPS_DEPLOY_DIR="/opt/logs-on-vps", DEPLOY_ID=DEPLOY_ID,
                        SSH_CALLS=str(self.base / "calls"), BUNDLE_COPY=str(self.base / "bundle.tar.gz"))

    def deploy(self):
        return subprocess.run(["bash", str(self.repo / "scripts/ssh-deploy.sh")],
                              env=self.env, capture_output=True, text=True)

    def test_bundle_allowlist_host_verification_and_credential_cleanup(self):
        result = self.deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        with tarfile.open(self.base / "bundle.tar.gz") as bundle:
            names = bundle.getnames()
        self.assertIn(".env.example", names)
        self.assertIn("scripts/activate.sh", names)
        self.assertNotIn(".env", names)
        self.assertNotIn("unrelated-private.txt", names)
        calls = [json.loads(line) for line in (self.base / "calls").read_text().splitlines()]
        self.assertEqual(len(calls), 3)
        for call in calls:
            self.assertIn("StrictHostKeyChecking=yes", call)
            self.assertIn("BatchMode=yes", call)
            self.assertFalse(Path(call[call.index("-i") + 1]).exists())

    def test_unsafe_paths_are_rejected_before_connecting(self):
        for path in ["/", "/opt/../root", "/opt/logs;whoami", "relative", "/opt/logs on vps"]:
            self.env["VPS_DEPLOY_DIR"] = path
            self.assertNotEqual(self.deploy().returncode, 0, path)
        self.assertFalse((self.base / "calls").exists())

    def test_remote_failure_is_not_reported_as_success(self):
        self.env["ACTIVATE_STATUS"] = "17"
        self.assertEqual(self.deploy().returncode, 17)


if __name__ == "__main__":
    unittest.main()
