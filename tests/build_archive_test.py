"""Exercise actual documented archive prefixes under both Git EOL settings."""
import io
import re
import shlex
import subprocess
import tarfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = ['skills/lifeos-direction-analysis/SKILL.md', 'server/workflows/task-journal.ts']


class BuildArchiveTests(unittest.TestCase):
    def test_actual_archive_commands_export_committed_bytes_under_both_eol_settings(self):
        for document in ['deploy/build-image.ps1', 'DEPLOYMENT_HANDOFF.md']:
            source = (ROOT / document).read_text(encoding='utf-8')
            match = re.search(r'^\s*git (.*?)archive\b', source, re.MULTILINE)
            self.assertIsNotNone(match, document)
            prefix = shlex.split(match.group(1))
            for autocrlf in ['true', 'false']:
                with self.subTest(document=document, autocrlf=autocrlf):
                    archive = subprocess.check_output(['git', '-c', 'core.autocrlf=' + autocrlf,
                                                       *prefix, 'archive', '--format=tar', 'HEAD', *FILES], cwd=ROOT)
                    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
                        for file in FILES:
                            blob = subprocess.check_output(['git', 'show', 'HEAD:' + file], cwd=ROOT)
                            self.assertEqual(tar.extractfile(file).read(), blob,
                                             'archive must contain exact Git blob bytes: ' + file)


if __name__ == '__main__':
    unittest.main()
