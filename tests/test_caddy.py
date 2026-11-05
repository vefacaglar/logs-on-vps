import json
from pathlib import Path
import runpy
import tempfile
import unittest


MODULE = runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts/configure-caddy.py"))
updated_config = MODULE["updated_config"]
mounted_config = MODULE["mounted_config"]
apply_config = MODULE["apply_config"]
DOMAIN = MODULE["DOMAIN"]
UPSTREAM = MODULE["UPSTREAM"]


def adapted_route(upstream):
    return {"match": [{"host": [DOMAIN]}], "handle": [{"handler": "reverse_proxy", "upstreams": [{"dial": upstream}]}]}


class CaddyRouteTests(unittest.TestCase):
    def test_other_sites_are_preserved_and_managed_route_is_idempotent(self):
        original = 'auth.example.test {\n    reverse_proxy authserver:5175\n}\n'
        first = updated_config(original, {})
        self.assertTrue(first.startswith(original))
        self.assertEqual(updated_config(first, adapted_route(UPSTREAM)), first)
        self.assertEqual(first.count(DOMAIN), 1)

    def test_compatible_manual_route_is_preserved(self):
        original = f'{DOMAIN} {{\n    reverse_proxy {UPSTREAM}\n}}\n'
        self.assertEqual(updated_config(original, adapted_route(UPSTREAM)), original)

    def test_unmanaged_conflict_or_imported_domain_is_rejected(self):
        with self.assertRaises(RuntimeError):
            updated_config('import sites/*\n', adapted_route('another-service:8080'))
        with self.assertRaises(RuntimeError):
            updated_config(DOMAIN + ' { respond private }\n', {})

    def test_broken_markers_are_rejected(self):
        for text in [MODULE['BEGIN'], MODULE['END'] + '\n' + MODULE['BEGIN'], MODULE['BEGIN'] * 2]:
            with self.assertRaises(RuntimeError):
                updated_config(text, {})

    def test_only_persistent_mounts_with_safe_paths_are_accepted(self):
        mounts = [
            {'Type': 'bind', 'Source': '/opt/caddy', 'Destination': '/etc/caddy'},
            {'Type': 'bind', 'Source': '/opt/databases/Caddyfile', 'Destination': '/etc/caddy/Caddyfile'},
        ]
        self.assertEqual(mounted_config(mounts, '/etc/caddy/Caddyfile'), Path('/opt/databases/Caddyfile'))
        for path in ['relative', '/etc/caddy/../secrets', '/unmounted/Caddyfile']:
            with self.assertRaises(RuntimeError):
                mounted_config(mounts, path)

    def test_reload_failure_restores_file_and_reloads_previous_config(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'Caddyfile'
            original = 'auth.example.test {\n    respond ok\n}\n'
            source.write_text(original)
            inode = source.stat().st_ino
            calls = []

            def runner(arguments):
                calls.append(arguments[0])
                if arguments[0] == 'adapt':
                    return json.dumps({})
                if arguments[0] == 'reload' and calls.count('reload') == 1:
                    raise RuntimeError('mock reload failure')
                return ''

            with self.assertRaisesRegex(RuntimeError, 'original configuration restored'):
                apply_config(source, [], '/etc/caddy/Caddyfile', root / 'backups', runner)
            self.assertEqual(source.read_text(), original)
            self.assertEqual(source.stat().st_ino, inode)
            self.assertEqual(calls, ['adapt', 'validate', 'reload', 'reload'])
            backup = next((root / 'backups').iterdir())
            self.assertEqual(backup.read_text(), original)
            self.assertEqual(backup.stat().st_mode & 0o777, 0o600)

    def test_concurrent_changes_are_not_overwritten_on_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'Caddyfile'
            source.write_text('auth.example.test {\n    respond ok\n}\n')

            def runner(arguments):
                if arguments[0] == 'adapt':
                    return '{}'
                if arguments[0] == 'validate':
                    with source.open('a') as file:
                        file.write('# another deployment\n')
                return ''

            with self.assertRaisesRegex(RuntimeError, 'Concurrent Caddyfile change preserved'):
                apply_config(source, [], '/etc/caddy/Caddyfile', root / 'backups', runner)
            self.assertIn('# another deployment', source.read_text())
