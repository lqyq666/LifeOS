import importlib.util
import tempfile
import hashlib
import json
import time
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('guards', Path(__file__).resolve().parents[1] / 'deploy/recovery-guards.py')
guards = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guards)


class RecoveryGuardsTests(unittest.TestCase):
    def test_container_replacement_same_name_and_image_still_rejected(self):
        expected = {'containerId': 'a' * 64, 'imageId': 'sha256:' + 'b' * 64}
        labels = {'com.docker.compose.project': 'lifeos', 'com.docker.compose.service': 'app'}
        current = {'Id': expected['containerId'], 'Image': expected['imageId'], 'Name': '/lifeos-app-1', 'Config': {'Labels': labels}}
        guards.require_original(current, expected, labels)
        for field, wrong in [('Id', 'c' * 64), ('Image', 'sha256:' + 'c' * 64), ('Name', '/another')]:
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'IDENTITY_CHANGED'):
                guards.require_original({**current, field: wrong}, expected, labels)
        with self.assertRaisesRegex(ValueError, 'IDENTITY_CHANGED'):
            guards.require_original({**current, 'Config': {'Labels': {**labels, 'com.docker.compose.project': 'another'}}}, expected, labels)

    def test_host_and_unknown_container_encoders_block_serial_start(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def process(pid, command, group):
                path = root / str(pid); path.mkdir()
                (path / 'cmdline').write_bytes(command.encode())
                (path / 'cgroup').write_text(group)
                return path
            original = 'a' * 64
            process(1, 'python\0server/coach-embedding-worker.py', '0::/system.slice/docker-' + original + '.scope')
            self.assertEqual(len(guards.require_encoder_exclusive([original], root)), 1)
            with self.assertRaisesRegex(ValueError, 'EXCLUSIVITY_UNCONFIRMED'):
                guards.require_encoder_exclusive([], root)
            unknown = process(2, 'ollama serve', '0::/system.slice/ollama.service')
            with self.assertRaisesRegex(ValueError, 'EXCLUSIVITY_UNCONFIRMED'):
                guards.require_encoder_exclusive([original], root)
            (unknown / 'cmdline').write_bytes(b'uvicorn campus:app')
            self.assertEqual(len(guards.require_encoder_exclusive([original], root)), 1)
            (unknown / 'cmdline').write_bytes(b'python sentence_transformers')
            (unknown / 'cgroup').write_text('0::/docker/' + 'b' * 64)
            with self.assertRaisesRegex(ValueError, 'EXCLUSIVITY_UNCONFIRMED'):
                guards.require_encoder_exclusive([original], root)

    def test_remaining_budget_never_resets_or_extends_after_expiry(self):
        self.assertLess(guards.remaining_timeout(time.monotonic() + .1, 20), .101)
        with self.assertRaisesRegex(TimeoutError, 'AGGREGATE_RECOVERY_DEADLINE'):
            guards.remaining_timeout(time.monotonic() - .1, 20)

    def test_binding_rejects_changed_sources_identity_scope_and_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            files=[root/name for name in ['operation.py','guards.py','verifier.py']]
            for file in files:file.write_bytes(file.name.encode())
            value={'expectedHead':'a'*40,'oldHead':'b'*40,'expectedImageId':'sha256:'+'c'*64,'oldImageId':'sha256:'+'d'*64,
                   'originalContainerId':'e'*64,'releaseLabel':'recovery-aaaaaaa-1234abcd',
                   'operationSha256':hashlib.sha256(files[0].read_bytes()).hexdigest(),
                   'guardsSha256':hashlib.sha256(files[1].read_bytes()).hexdigest(),
                   'verifierSha256':hashlib.sha256(files[2].read_bytes()).hexdigest(),
                   'originalLabels':{'com.docker.compose.project':'lifeos','com.docker.compose.service':'app'},
                   'publicOrigin':'https://lqynb.xyz','providerCalls':0,'cozeCalls':0,'publish':False,
                   'oldMigrations':[{'name':'000-original.sql','sha256':'f'*64}]}
            binding=root/'binding.json';binding.write_text(json.dumps(value))
            self.assertEqual(guards.read_binding(binding,*files),value)
            for key,wrong in [('operationSha256','f'*64),('originalContainerId','short'),('releaseLabel','../escape'),('publicOrigin','http://lqynb.xyz'),('publish',True),('providerCalls',1),('oldMigrations',[])]:
                with self.subTest(key=key),self.assertRaises(ValueError):
                    binding.write_text(json.dumps({**value,key:wrong}));guards.read_binding(binding,*files)


if __name__ == '__main__':
    unittest.main()
