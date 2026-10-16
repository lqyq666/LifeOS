"""Read-only recovery gate. Supervise the entire check, including its children."""
import argparse
import hashlib
import json
import os
import re
import signal
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path


def supervise(command, seconds):
    started = time.monotonic()
    deadline = started + seconds
    cleanup_budget = min(1, seconds / 4)
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                               start_new_session=os.name == 'posix')
    try:
        output, _ = process.communicate(timeout=max(0.001, deadline - cleanup_budget - time.monotonic()))
        if time.monotonic() >= deadline:
            return 124, b''
        return process.returncode, output
    except subprocess.TimeoutExpired:
        if os.name == 'posix':
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        else:
            process.kill()
        try:
            process.communicate(timeout=max(0.001, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            # A pipe held by an unresponsive child must never extend the gate.
            process.stdout.close()
        return 124, b''


def read_expectations(path, expected_digest):
    source = Path(path).read_bytes()
    if not isinstance(expected_digest, str) or not re.fullmatch(r'[a-f0-9]{64}', expected_digest) or hashlib.sha256(source).hexdigest() != expected_digest:
        raise ValueError('EXPECTED_MIGRATION_MANIFEST_HASH_MISMATCH')
    rows = json.loads(source.decode('utf-8-sig'))
    if not isinstance(rows, list) or not rows:
        raise ValueError('EXPECTED_MIGRATIONS_REQUIRED')
    if any(not isinstance(row, dict) or set(row) != {'name', 'sha256'} or
           not isinstance(row['name'], str) or not re.fullmatch(r'[0-9]+-[a-z0-9.-]+\.sql', row['name']) or
           not isinstance(row['sha256'], str) or not re.fullmatch(r'[a-f0-9]{64}', row['sha256']) for row in rows):
        raise ValueError('EXPECTED_MIGRATIONS_INVALID')
    if len({row['name'] for row in rows}) != len(rows):
        raise ValueError('EXPECTED_MIGRATIONS_DUPLICATE')
    return sorted(rows, key=lambda row: row['name'])


def verify_once(args, expected, remaining):
    def budget():
        return max(0.001, min(3, remaining()))

    def docker(arguments):
        return subprocess.check_output(['docker', *arguments], timeout=budget(),
                                       stderr=subprocess.DEVNULL, text=True).strip()

    def http(path):
        with urllib.request.urlopen(args.origin + path, timeout=budget()) as response:
            if response.status != 200:
                raise ValueError('PUBLIC_HTTP_FAILED')
            # A slow response body is bounded by the outer process supervisor.
            return json.loads(response.read(1024 * 1024 + 1))

    ready = http('/api/ready')
    version = http('/api/run/version')
    image = docker(['inspect', '--format', '{{.Image}}', args.app_container])
    query = "SELECT coalesce(json_agg(json_build_object('name',name,'sha256',sha256) ORDER BY name),'[]'::json) FROM lifeos_schema_migrations"
    schema = json.loads(docker(['exec', '-e', 'PGOPTIONS=-c statement_timeout=2500', args.db_container,
                               'psql', '-U', 'lifeos', '-d', 'lifeos', '-Atc', query]))
    if not isinstance(ready, dict) or ready.get('ready') is not True:
        raise ValueError('PUBLIC_NOT_READY')
    if not isinstance(version, dict) or version.get('head') != args.expected_head:
        raise ValueError('PUBLIC_VERSION_MISMATCH')
    if image != args.expected_image_id:
        raise ValueError('PUBLIC_IMAGE_MISMATCH')
    if schema != expected:
        raise ValueError('PUBLIC_MIGRATION_MANIFEST_MISMATCH')
    return {'status': 'PASS_RESTORATION_READBACK', 'head': version['head'],
            'imageId': image, 'ready': True, 'migrationCount': len(schema)}


def arguments(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--origin', default='http://127.0.0.1:8787')
    parser.add_argument('--expected-head', required=True)
    parser.add_argument('--expected-image-id', required=True)
    parser.add_argument('--migrations', required=True)
    parser.add_argument('--migrations-sha256', required=True)
    parser.add_argument('--app-container', default='lifeos-app-1')
    parser.add_argument('--db-container', default='lifeos-db-1')
    parser.add_argument('--timeout-seconds', type=float, default=40)
    args = parser.parse_args(argv)
    origin = urllib.parse.urlsplit(args.origin)
    if origin.username or origin.password or origin.path not in ['', '/'] or origin.query or origin.fragment:
        parser.error('ORIGIN_MUST_BE_A_BASE_URL_WITHOUT_CREDENTIALS')
    if not origin.hostname or (origin.scheme != 'https' and not (
            origin.scheme == 'http' and origin.hostname in ['127.0.0.1', 'localhost', '::1'])):
        parser.error('HTTPS_OR_LOOPBACK_REQUIRED')
    if not re.fullmatch(r'[a-f0-9]{40}', args.expected_head) or not re.fullmatch(r'sha256:[a-f0-9]{64}', args.expected_image_id):
        parser.error('EXACT_HEAD_AND_IMAGE_ID_REQUIRED')
    if not 0 < args.timeout_seconds <= 120 or any(not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]*', name) for name in [args.app_container, args.db_container]):
        parser.error('TIMEOUT_OR_CONTAINER_INVALID')
    args.origin = args.origin.rstrip('/')
    return args


def worker(args):
    expected = read_expectations(args.migrations, args.migrations_sha256)
    deadline = time.monotonic() + args.timeout_seconds
    while time.monotonic() < deadline:
        try:
            result = verify_once(args, expected, lambda: deadline - time.monotonic())
            if time.monotonic() >= deadline:
                break
            print(json.dumps(result))
            return 0
        except (OSError, ValueError, subprocess.SubprocessError):
            time.sleep(min(0.2, max(0, deadline - time.monotonic())))
    return 1


def main():
    args = arguments()
    # The supported CLI always enters the supervisor. The private worker is
    # invoked by importing this exact file; there is no CLI bypass flag.
    entry = "import runpy,sys; m=runpy.run_path(sys.argv[1]); sys.exit(m['worker'](m['arguments'](sys.argv[2:])))"
    code, output = supervise([sys.executable, '-c', entry, str(Path(__file__).resolve()), *sys.argv[1:]], args.timeout_seconds)
    if code == 0:
        sys.stdout.buffer.write(output)
        return 0
    print(json.dumps({'status': 'FAIL_RESTORATION', 'reason': 'HARD_TIMEOUT' if code == 124 else 'READBACK_FAILED'}))
    return 1


if __name__ == '__main__':
    sys.exit(main())
