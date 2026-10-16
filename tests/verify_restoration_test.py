"""Offline fault injection; no Docker daemon or external HTTP calls."""
import importlib.util
import hashlib
import io
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('restoration', Path(__file__).resolve().parents[1] / 'deploy/verify-restoration.py')
restoration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restoration)


class Response(io.BytesIO):
    status = 200


class RestorationTests(unittest.TestCase):
    def setUp(self):
        self.expected = [{'name': '000-better-auth-1.7.7.sql', 'sha256': 'b' * 64}]
        self.args = SimpleNamespace(origin='http://127.0.0.1:8787', expected_head='a' * 40,
                                    expected_image_id='sha256:' + 'c' * 64,
                                    app_container='lifeos-app-1', db_container='lifeos-db-1')

    def readback(self, ready=True, head=None, image=None, schema=None):
        responses = [Response(json.dumps({'ready': ready}).encode()),
                     Response(json.dumps({'head': head or self.args.expected_head}).encode())]
        with patch.object(restoration.urllib.request, 'urlopen', side_effect=responses), \
                patch.object(restoration.subprocess, 'check_output', side_effect=[
                    image or self.args.expected_image_id, json.dumps(self.expected if schema is None else schema)]):
            return restoration.verify_once(self.args, self.expected, lambda: 5)

    def test_requires_ready_exact_head_image_and_full_migration_hashes(self):
        self.assertEqual(self.readback()['status'], 'PASS_RESTORATION_READBACK')
        for changes, error in [({'ready': 'true'}, 'PUBLIC_NOT_READY'),
                               ({'head': 'd' * 40}, 'PUBLIC_VERSION_MISMATCH'),
                               ({'image': 'sha256:' + 'd' * 64}, 'PUBLIC_IMAGE_MISMATCH'),
                               ({'schema': []}, 'PUBLIC_MIGRATION_MANIFEST_MISMATCH'),
                               ({'schema': self.expected + [{'name': '001-extra.sql', 'sha256': 'e' * 64}]}, 'PUBLIC_MIGRATION_MANIFEST_MISMATCH'),
                               ({'schema': [{**self.expected[0], 'name': '000-replaced.sql'}]}, 'PUBLIC_MIGRATION_MANIFEST_MISMATCH'),
                               ({'schema': [{**self.expected[0], 'sha256': 'd' * 64}]}, 'PUBLIC_MIGRATION_MANIFEST_MISMATCH')]:
            with self.subTest(error=error), self.assertRaisesRegex(ValueError, error):
                self.readback(**changes)

    def test_reads_actual_versioned_migration_names_and_rejects_duplicates(self):
        directory = Path(__file__).resolve().parents[1] / 'server/migrations'
        expected = [{'name': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
                    for path in sorted(directory.glob('*.sql'))]
        with tempfile.TemporaryDirectory(prefix='lifeos-restoration-test-') as temporary:
            manifest = Path(temporary) / 'migrations.json'
            manifest.write_text(json.dumps(expected), encoding='utf-8')
            digest = lambda: hashlib.sha256(manifest.read_bytes()).hexdigest()
            original_digest = digest()
            self.assertEqual(restoration.read_expectations(manifest, original_digest), expected)
            manifest.write_text(json.dumps(expected + [expected[0]]), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'EXPECTED_MIGRATION_MANIFEST_HASH_MISMATCH'):
                restoration.read_expectations(manifest, original_digest)
            with self.assertRaisesRegex(ValueError, 'EXPECTED_MIGRATIONS_DUPLICATE'):
                restoration.read_expectations(manifest, digest())

    def test_hard_deadline_terminates_a_blocked_worker(self):
        started = time.monotonic()
        code, output = restoration.supervise([sys.executable, '-c', 'import time; time.sleep(60)'], 0.2)
        self.assertEqual((code, output), (124, b''))
        self.assertLess(time.monotonic() - started, 2)

    @unittest.skipUnless(os.name == 'posix', 'Linux production process-group verification')
    def test_hard_deadline_also_terminates_worker_descendants(self):
        with tempfile.TemporaryDirectory(prefix='lifeos-restoration-tree-') as temporary:
            pid_file = Path(temporary) / 'child.pid'
            command = ('import pathlib,subprocess,sys,time; '
                       'child=subprocess.Popen([sys.executable,"-c","import time;time.sleep(60)"]); '
                       'pathlib.Path(sys.argv[1]).write_text(str(child.pid)); time.sleep(60)')
            code, _ = restoration.supervise([sys.executable, '-c', command, str(pid_file)], 0.5)
            self.assertEqual(code, 124)
            pid = int(pid_file.read_text())
            state = Path('/proc') / str(pid) / 'stat'
            for _ in range(20):
                if not state.exists() or state.read_text().split()[2] == 'Z':
                    break
                time.sleep(0.05)
            else:
                self.fail('worker descendant survived the hard deadline')

    def test_supervisor_preserves_failed_exit_and_success_output(self):
        self.assertEqual(restoration.supervise([sys.executable, '-c', 'raise SystemExit(7)'], 3)[0], 7)
        code, output = restoration.supervise([sys.executable, '-c', 'print("readback")'], 3)
        self.assertEqual(code, 0)
        self.assertEqual(output.strip(), b'readback')

    def test_supported_cli_has_no_worker_bypass_and_bounds_unavailable_services(self):
        with tempfile.TemporaryDirectory(prefix='lifeos-restoration-cli-') as temporary:
            manifest = Path(temporary) / 'migrations.json'
            manifest.write_text(json.dumps(self.expected), encoding='utf-8')
            command = [sys.executable, str(Path(restoration.__file__)),
                       '--expected-head', self.args.expected_head,
                       '--expected-image-id', self.args.expected_image_id,
                       '--migrations', str(manifest),
                       '--migrations-sha256', hashlib.sha256(manifest.read_bytes()).hexdigest(),
                       '--origin', 'http://127.0.0.1:1', '--timeout-seconds', '0.3']
            bypass = subprocess.run([*command, '--worker'], capture_output=True, timeout=3)
            self.assertEqual(bypass.returncode, 2)
            self.assertIn(b'unrecognized arguments: --worker', bypass.stderr)
            started = time.monotonic()
            result = subprocess.run(command, capture_output=True, timeout=3)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(json.loads(result.stdout)['status'], 'FAIL_RESTORATION')
            self.assertLess(time.monotonic() - started, 1.5)


if __name__ == '__main__':
    unittest.main()
