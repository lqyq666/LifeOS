"""Fail closed at the existing serial-recovery operation's destructive boundary."""
import hashlib
import json
import re
import subprocess
import time
from pathlib import Path


def remaining_timeout(deadline, cap):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError('AGGREGATE_RECOVERY_DEADLINE')
    return min(cap, remaining)


def require_original(current, expected, labels):
    if (current.get('Id') != expected['containerId'] or
            current.get('Image') != expected['imageId'] or current.get('Name') != '/lifeos-app-1' or
            any(current.get('Config', {}).get('Labels', {}).get(key) != value for key, value in labels.items())):
        raise ValueError('ORIGINAL_CONTAINER_IDENTITY_CHANGED')


def encoder_inventory(proc=Path('/proc')):
    # Match actual model workers, regardless of container name or image tag.
    markers = ('coach-embedding-worker.py', 'embedding-worker.py', 'embedding_worker.py',
               'sentence_transformers', 'vllm', 'ollama serve', 'llama-server', 'text-embeddings-router')
    result = []
    for path in proc.iterdir():
        if not path.name.isdigit():
            continue
        try:
            command = (path / 'cmdline').read_bytes().replace(b'\0', b' ').decode(errors='replace').lower()
            if not any(marker in command for marker in markers):
                continue
            cgroup = (path / 'cgroup').read_text()
            match = re.search(r'(?:docker[-/])([a-f0-9]{64})(?:\.scope)?', cgroup)
            result.append({'pid': int(path.name), 'containerId': match.group(1) if match else None})
        except FileNotFoundError:
            # A process that exited during inspection owns no live encoder.
            continue
    return result


def require_encoder_exclusive(allowed_containers=(), proc=Path('/proc')):
    observed = encoder_inventory(proc)
    if any(row['containerId'] not in allowed_containers for row in observed):
        raise ValueError('HOST_MODEL_ENCODER_EXCLUSIVITY_UNCONFIRMED')
    return observed


def read_binding(path, operation, guards, verifier):
    raw = Path(path).read_bytes()
    value = json.loads(raw.decode('utf-8-sig'))
    for key in ('expectedHead', 'oldHead'):
        if not isinstance(value.get(key), str) or not re.fullmatch(r'[a-f0-9]{40}', value[key]):
            raise ValueError('EXACT_COMMIT_REQUIRED')
    for key in ('expectedImageId', 'oldImageId'):
        if not isinstance(value.get(key), str) or not re.fullmatch(r'sha256:[a-f0-9]{64}', value[key]):
            raise ValueError('EXACT_IMAGE_ID_REQUIRED')
    if not re.fullmatch(r'[a-f0-9]{64}', str(value.get('originalContainerId', ''))):
        raise ValueError('EXACT_ORIGINAL_CONTAINER_REQUIRED')
    if not re.fullmatch(r'recovery-' + value['expectedHead'][:7] + r'-[a-f0-9]{8}', str(value.get('releaseLabel', ''))):
        raise ValueError('EXACT_UNIQUE_RELEASE_REQUIRED')
    for key, file in [('operationSha256', operation), ('guardsSha256', guards), ('verifierSha256', verifier)]:
        if value.get(key) != hashlib.sha256(Path(file).read_bytes()).hexdigest():
            raise ValueError('REVIEWED_OPERATION_BYTES_CHANGED')
    labels = value.get('originalLabels')
    if (not isinstance(labels, dict) or labels.get('com.docker.compose.project') != 'lifeos' or
            labels.get('com.docker.compose.service') != 'app' or
            any(not isinstance(key, str) or not isinstance(item, str) for key, item in labels.items())):
        raise ValueError('ORIGINAL_OWNERSHIP_LABELS_REQUIRED')
    if value.get('publicOrigin') != 'https://lqynb.xyz':
        raise ValueError('EXISTING_PUBLIC_ORIGIN_REQUIRED')
    if value.get('providerCalls') != 0 or value.get('cozeCalls') != 0 or value.get('publish') is not False:
        raise ValueError('RECOVERY_IS_NOT_RELEASE_OR_PAID_ACCEPTANCE')
    migrations=value.get('oldMigrations')
    if (not isinstance(migrations,list) or not migrations or
            any(not isinstance(row,dict) or set(row)!={'name','sha256'} or
                not re.fullmatch(r'[0-9]+-[a-z0-9.-]+\.sql',str(row['name'])) or
                not re.fullmatch(r'[a-f0-9]{64}',str(row['sha256'])) for row in migrations) or
            len({row['name'] for row in migrations})!=len(migrations)):
        raise ValueError('ORIGINAL_MIGRATION_MANIFEST_REQUIRED')
    return value


if __name__ == '__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exclusive',action='store_true')
    parser.add_argument('--original-binding')
    args=parser.parse_args()
    if args.exclusive:
        require_encoder_exclusive()
        units=subprocess.check_output(['systemctl','list-units','--type=service','--state=running','--no-legend','--plain'],text=True,timeout=3)
        if any(re.search(r'ollama|vllm|embedding|encoder|llama',line.split()[0],re.I) for line in units.splitlines() if line.split()):
            raise ValueError('HOST_MODEL_SERVICE_RUNNING')
    elif args.original_binding:
        directory=Path(__file__).resolve().parent
        binding=read_binding(args.original_binding,directory/'rehearse-production.py',__file__,directory/'verify-restoration.py')
        current=json.loads(subprocess.check_output(['docker','inspect','lifeos-app-1'],text=True,timeout=3))[0]
        require_original(current,{'containerId':binding['originalContainerId'],'imageId':binding['oldImageId']},binding['originalLabels'])
    else:
        parser.error('A_SUPPORTED_RECOVERY_CHECK_REQUIRED')
