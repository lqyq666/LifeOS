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


def require_watchdog_properties(properties):
    # TimeoutStartSec alone does not bound a running simple service or its children.
    expected = {'Type': 'simple', 'Restart': 'on-failure', 'RestartUSec': '20s',
                'RuntimeMaxUSec': '1min 55s', 'TimeoutStopUSec': '5s',
                'KillMode': 'control-group', 'SendSIGKILL': 'yes', 'StartLimitIntervalUSec': '0'}
    if any(properties.get(key) != value for key, value in expected.items()):
        raise ValueError('PERSISTENT_WATCHDOG_RUNTIME_CONTAINMENT_UNCONFIRMED')


def require_original(current, expected, labels):
    if (current.get('Id') != expected['containerId'] or
            current.get('Image') != expected['imageId'] or current.get('Name') != '/lifeos-app-1' or
            any(current.get('Config', {}).get('Labels', {}).get(key) != value for key, value in labels.items())):
        raise ValueError('ORIGINAL_CONTAINER_IDENTITY_CHANGED')


def require_private(current, expected, label):
    if (not expected or current.get('Id') != expected.get('containerId') or
            current.get('Image') != expected.get('imageId') or current.get('Name') != '/' + expected.get('name', '') or
            current.get('Config', {}).get('Labels', {}).get('lifeos.rehearsal') != label):
        raise ValueError('PRIVATE_CONTAINER_IMMUTABLE_OWNERSHIP_CHANGED')


def require_network(current, expected, label):
    if (not expected or current.get('Id') != expected.get('networkId') or
            current.get('Name') != expected.get('name') or current.get('Internal') is not True or
            current.get('Labels', {}).get('lifeos.rehearsal') != label):
        raise ValueError('PRIVATE_NETWORK_IMMUTABLE_OWNERSHIP_CHANGED')


def require_private_or_inert_intent(current, expected, intent, name, image, label):
    """An uncommitted creation may be observed, never adopted or mutated."""
    if expected:
        require_private(current, expected, label)
        return
    state=current.get('State', {})
    labels=current.get('Config', {}).get('Labels', {}) or {}
    if (not isinstance(intent, dict) or intent.get('name')!=name or intent.get('imageId')!=image or
            not re.fullmatch('[a-f0-9]{32}',str(intent.get('token',''))) or
            not re.fullmatch('[a-f0-9]{64}',str(current.get('Id',''))) or
            current.get('Name')!='/'+name or current.get('Image')!=image or
            labels.get('lifeos.rehearsal')!=label or labels.get('lifeos.creation-intent')!=intent['token'] or
            state.get('Running') is not False or state.get('Status')!='created' or state.get('Pid')!=0 or
            state.get('StartedAt')!='0001-01-01T00:00:00Z' or
            set(current.get('NetworkSettings',{}).get('Networks',{}))!={'none'}):
        raise ValueError('PRIVATE_CONTAINER_IMMUTABLE_OWNERSHIP_CHANGED')


def schema_sha256(text):
    stable='\n'.join(line for line in text.strip().splitlines() if not line.startswith(('--','\\restrict ','\\unrestrict ')))
    return hashlib.sha256(stable.encode()).hexdigest()


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


def require_recovery_memory(current, proc=Path('/proc'), cgroups=Path('/sys/fs/cgroup')):
    """Count only the bound private-IPC cgroup's anonymous memory, with headroom."""
    cid=current.get('Id','');pid=current.get('State',{}).get('Pid',0)
    if (not re.fullmatch('[a-f0-9]{64}',str(cid)) or not isinstance(pid,int) or pid<=0 or
            current.get('State',{}).get('Running') is not True or
            current.get('HostConfig',{}).get('IpcMode')!='private'):
        raise ValueError('RECOVERY_MEMORY_IDENTITY_UNCONFIRMED')
    lines=(proc/str(pid)/'cgroup').read_text().splitlines()
    paths=[line[3:] for line in lines if line.startswith('0::')]
    if len(paths)!=1 or paths[0] not in ('/system.slice/docker-'+cid+'.scope','/docker/'+cid):
        raise ValueError('RECOVERY_MEMORY_CGROUP_UNCONFIRMED')
    group=cgroups/paths[0].lstrip('/')
    if not group.resolve().is_relative_to(cgroups.resolve()) or str(pid) not in (group/'cgroup.procs').read_text().split():
        raise ValueError('RECOVERY_MEMORY_CGROUP_UNCONFIRMED')
    stats=dict(row.split() for row in (group/'memory.stat').read_text().splitlines())
    anonymous=int(stats['anon']);charged=int((group/'memory.current').read_text())
    available=int(next(row.split()[1] for row in (proc/'meminfo').read_text().splitlines() if row.startswith('MemAvailable:')))*1024
    if not 0<=anonymous<=charged or available<0:
        raise ValueError('RECOVERY_MEMORY_COUNTERS_INVALID')
    # 640 MiB minimum app + 256 MiB host reserve + 64 MiB uncertainty margin.
    if available+anonymous<960*1024**2:
        raise ValueError('LOW_MEMORY_BEFORE_PUBLIC_STOP')
    return {'availableBytes':available,'boundAnonymousBytes':anonymous,'requiredBytes':960*1024**2,
            'originalContainerId':cid,'originalPid':pid,'cgroup':paths[0]}


def recovery_memory_cap(available_bytes):
    cap=min(768,available_bytes//(1024*1024)-256)
    if cap<640:
        raise ValueError('LOW_MEMORY_NO_ENCODER_STARTED')
    return cap


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
    expected=value.get('expectedMigrations')
    additions={'034-workflow-provider-spend.sql','035-password-reset-delivery.sql','036-workflow-dispatch-boundary.sql','037-research-exploration-control.sql','038-independent-coach-materials.sql'}
    if (not isinstance(expected,list) or len(expected)!=len(migrations)+len(additions) or
            any(not isinstance(row,dict) or set(row)!={'name','sha256'} or
                not re.fullmatch(r'[0-9]+-[a-z0-9.-]+\.sql',str(row['name'])) or
                not re.fullmatch(r'[a-f0-9]{64}',str(row['sha256'])) for row in expected) or
            len({row['name'] for row in expected})!=len(expected) or
            {row['name'] for row in expected}-{row['name'] for row in migrations}!=additions or
            any(row not in expected for row in migrations) or
            not re.fullmatch(r'[a-f0-9]{64}',str(value.get('expectedSchemaSha256',''))) or
            not re.fullmatch(r'sha256:[a-f0-9]{64}',str(value.get('databaseImageId','')))):
        raise ValueError('CANONICAL_POST_MIGRATION_BINDING_REQUIRED')
    return value


def recover_original(binding_path, migration_path, migration_sha256):
    """One supervised retry, with 45s private cleanup and a 110s total budget."""
    import fcntl
    directory=Path(__file__).resolve().parent
    binding=read_binding(binding_path,directory/'rehearse-production.py',__file__,directory/'verify-restoration.py')
    assert Path(binding_path).resolve()==Path('/opt/lifeos/releases')/binding['releaseLabel']/'operation-binding.json'
    migrations=Path(migration_path)
    assert migrations.resolve()==directory/'original-migrations.json'
    assert hashlib.sha256(migrations.read_bytes()).hexdigest()==migration_sha256
    assert json.loads(migrations.read_text())==binding['oldMigrations']
    with open('/run/lifeos-serial-rehearsal.lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        started=time.monotonic();deadline=started+110;cleanup_deadline=started+45
        def run(args,cap=3,phase_deadline=None):
            return subprocess.check_output(args,text=True,stderr=subprocess.DEVNULL,
                timeout=remaining_timeout(min(deadline,phase_deadline or deadline),cap)).strip()
        images={'lifeos-serial-'+kind+'-'+binding['releaseLabel']:binding['oldImageId'] if kind=='old' else binding['expectedImageId'] for kind in ('old','new','migrate')}
        def owned(name):
            manifest=json.loads((directory/'private-ownership.json').read_text())
            assert manifest['releaseLabel']==binding['releaseLabel']
            expected=manifest['containers'].get(name)
            if expected:
                assert expected['name']==name and expected['imageId']==images[name] and re.fullmatch('[a-f0-9]{64}',expected['containerId'])
            try:current=json.loads(run(['docker','inspect',name],phase_deadline=cleanup_deadline))[0]
            except subprocess.CalledProcessError:
                assert not run(['docker','ps','-aq','--filter','name=^/'+name+'$'],phase_deadline=cleanup_deadline)
                return None
            require_private_or_inert_intent(current,expected,manifest.get('creationIntents',{}).get(name),
                                           name,images[name],binding['releaseLabel'])
            return current
        for name in images:
            current=owned(name)
            if current and current['State']['Running']:
                try:run(['docker','stop','--time','2',current['Id']],cap=8,phase_deadline=cleanup_deadline)
                except (subprocess.CalledProcessError,subprocess.TimeoutExpired):
                    current=owned(name)
                    if current and current['State']['Running']:run(['docker','kill',current['Id']],phase_deadline=cleanup_deadline)
            current=owned(name)
            assert not current or current['State']['Running'] is False
        current=json.loads(run(['docker','inspect','lifeos-app-1']))[0]
        require_original(current,{'containerId':binding['originalContainerId'],'imageId':binding['oldImageId']},binding['originalLabels'])
        require_encoder_exclusive([current['Id']] if current['State']['Running'] else ())
        units=run(['systemctl','list-units','--type=service','--state=running','--no-legend','--plain'])
        assert not any(re.search(r'ollama|vllm|embedding|encoder|llama',line.split()[0],re.I) for line in units.splitlines() if line.split())
        if not current['State']['Running']:run(['docker','start',current['Id']],cap=10)
        result=json.loads(run(['python3',str(directory/'verify-restoration.py'),'--origin',binding['publicOrigin'],
            '--expected-head',binding['oldHead'],'--expected-image-id',binding['oldImageId'],
            '--app-container',current['Id'],'--migrations',str(migrations),'--migrations-sha256',migration_sha256,
            '--timeout-seconds',str(remaining_timeout(deadline,40))],cap=41))
        assert result['status']=='PASS_RESTORATION_READBACK'
        print(json.dumps(result))


if __name__ == '__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exclusive',action='store_true')
    parser.add_argument('--original-binding')
    parser.add_argument('--rescue-binding')
    parser.add_argument('--migrations')
    parser.add_argument('--migrations-sha256')
    args=parser.parse_args()
    if args.rescue_binding:
        recover_original(args.rescue_binding,args.migrations,args.migrations_sha256)
    elif args.exclusive:
        require_encoder_exclusive()
        units=subprocess.check_output(['systemctl','list-units','--type=service','--state=running','--no-legend','--plain'],text=True,timeout=3)
        if any(re.search(r'ollama|vllm|embedding|encoder|llama',line.split()[0],re.I) for line in units.splitlines() if line.split()):
            raise ValueError('HOST_MODEL_SERVICE_RUNNING')
    elif args.original_binding:
        directory=Path(__file__).resolve().parent
        binding_path=args.original_binding
        binding=read_binding(binding_path,directory/'rehearse-production.py',__file__,directory/'verify-restoration.py')
        current=json.loads(subprocess.check_output(['docker','inspect','lifeos-app-1'],text=True,timeout=3))[0]
        require_original(current,{'containerId':binding['originalContainerId'],'imageId':binding['oldImageId']},binding['originalLabels'])
    else:
        parser.error('A_SUPPORTED_RECOVERY_CHECK_REQUIRED')
