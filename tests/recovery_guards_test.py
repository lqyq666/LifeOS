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
    def test_actual_post_stop_operation_prefix_rejects_low_memory_before_dump(self):
        import ast
        from unittest.mock import Mock
        source=(Path(__file__).resolve().parents[1]/'deploy/rehearse-production.py').read_text(encoding='utf-8')
        main=next(node for node in ast.parse(source).body if isinstance(node,ast.FunctionDef) and node.name=='main')
        operation=next(node for node in main.body if isinstance(node,ast.Try))
        start=next(i for i,node in enumerate(operation.body) if isinstance(node,ast.Expr) and isinstance(node.value,ast.Call) and isinstance(node.value.func,ast.Name) and node.value.func.id=='pause')
        end=next(i for i,node in enumerate(operation.body) if isinstance(node,ast.With))
        actual=ast.Module(body=operation.body[start:end+1],type_ignores=[])
        dump=Mock();backup=Mock();backup.__truediv__=Mock(return_value=dump)
        env={'pause':Mock(),'report':{},'guards':{'recovery_memory_cap':guards.recovery_memory_cap},'available':lambda:895*1024**2,'backup':backup,'bounded_run':Mock(),'subprocess':Mock(),'budget':lambda n:n}
        with self.assertRaisesRegex(ValueError,'LOW_MEMORY_NO_ENCODER_STARTED'):
            exec(compile(actual,'actual-post-stop-prefix','exec'),env)
        backup.__truediv__.assert_not_called();dump.open.assert_not_called();env['bounded_run'].assert_not_called()
        self.assertEqual(guards.recovery_memory_cap(896*1024**2),640)
        self.assertEqual(guards.recovery_memory_cap(2048*1024**2),768)

    def test_uncommitted_creation_requires_exact_intent_and_never_started_network_none(self):
        intent={'name':'private','imageId':'sha256:'+'b'*64,'token':'c'*32}
        current={'Id':'a'*64,'Image':intent['imageId'],'Name':'/private',
                 'Config':{'Labels':{'lifeos.rehearsal':'owned','lifeos.creation-intent':intent['token']}},
                 'State':{'Running':False,'Status':'created','Pid':0,'StartedAt':'0001-01-01T00:00:00Z'},
                 'NetworkSettings':{'Networks':{'none':{}}}}
        def check(value,record=intent):
            guards.require_private_or_inert_intent(value,None,record,'private',intent['imageId'],'owned')
        check(current)
        import copy
        cases=[]
        for key,value in [('Running',True),('Status','exited'),('Pid',42),('StartedAt','2026-10-14T00:00:00Z')]:
            changed=copy.deepcopy(current);changed['State'][key]=value;cases.append(changed)
        for networks in ({},{'private':{}},{'none':{},'private':{}}):
            changed=copy.deepcopy(current);changed['NetworkSettings']['Networks']=networks;cases.append(changed)
        changed=copy.deepcopy(current);changed['Config']['Labels']['lifeos.creation-intent']='d'*32;cases.append(changed)
        for changed in cases:
            with self.assertRaisesRegex(ValueError,'IMMUTABLE_OWNERSHIP_CHANGED'):check(changed)
        with self.assertRaisesRegex(ValueError,'IMMUTABLE_OWNERSHIP_CHANGED'):check(current,None)

    def test_memory_gate_counts_bound_anonymous_memory_not_cache_and_rejects_wrong_cgroup(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);proc=root/'proc';cgroups=root/'cgroup';cid='a'*64
            (proc/'123').mkdir(parents=True)
            group=cgroups/('system.slice/docker-'+cid+'.scope');group.mkdir(parents=True)
            (proc/'123/cgroup').write_text('0::/system.slice/docker-'+cid+'.scope\n')
            (proc/'meminfo').write_text('MemAvailable: 524288 kB\n')
            (group/'cgroup.procs').write_text('123\n')
            (group/'memory.current').write_text(str(700*1024**2))
            (group/'memory.stat').write_text('anon '+str(512*1024**2)+'\nfile 0\n')
            current={'Id':cid,'State':{'Pid':123,'Running':True},'HostConfig':{'IpcMode':'private'}}
            self.assertEqual(guards.require_recovery_memory(current,proc,cgroups)['boundAnonymousBytes'],512*1024**2)
            (group/'memory.stat').write_text('anon 0\nfile '+str(700*1024**2)+'\n')
            with self.assertRaisesRegex(ValueError,'LOW_MEMORY_BEFORE_PUBLIC_STOP'):
                guards.require_recovery_memory(current,proc,cgroups)
            (proc/'123/cgroup').write_text('0::/system.slice/docker-'+'b'*64+'.scope\n')
            with self.assertRaisesRegex(ValueError,'CGROUP_UNCONFIRMED'):
                guards.require_recovery_memory(current,proc,cgroups)

    def test_private_replacement_copied_label_and_network_identity_rejected(self):
        expected={'containerId':'a'*64,'imageId':'sha256:'+'b'*64,'name':'private'}
        current={'Id':expected['containerId'],'Image':expected['imageId'],'Name':'/private','Config':{'Labels':{'lifeos.rehearsal':'owned'}}}
        guards.require_private(current,expected,'owned')
        for changed in [{**current,'Id':'c'*64},{**current,'Image':'sha256:'+'c'*64}]:
            with self.assertRaisesRegex(ValueError,'IMMUTABLE_OWNERSHIP_CHANGED'):guards.require_private(changed,expected,'owned')
        with self.assertRaisesRegex(ValueError,'IMMUTABLE_OWNERSHIP_CHANGED'):guards.require_private(current,None,'owned')
        network={'Id':'d'*64,'Name':'private','Internal':True,'Labels':{'lifeos.rehearsal':'owned'}}
        ownership={'networkId':network['Id'],'name':'private'}
        guards.require_network(network,ownership,'owned')
        for changed in [{**network,'Id':'e'*64},{**network,'Internal':False}]:
            with self.assertRaisesRegex(ValueError,'IMMUTABLE_OWNERSHIP_CHANGED'):guards.require_network(changed,ownership,'owned')

    def test_schema_digest_ignores_only_dump_comments_and_random_restrict_keys(self):
        dump='-- database header\n\\restrict one\nCREATE TABLE example (id text);\n\\unrestrict one'
        same=dump.replace('database header','another header').replace('restrict one','restrict two')
        self.assertEqual(guards.schema_sha256(dump),guards.schema_sha256(same))
        self.assertNotEqual(guards.schema_sha256(dump),guards.schema_sha256(dump.replace('id text','id integer')))

    def test_watchdog_rejects_startup_only_timeout_or_escaping_descendants(self):
        properties={'Type':'simple','Restart':'on-failure','RestartUSec':'20s',
                    'RuntimeMaxUSec':'1min 55s','TimeoutStopUSec':'5s','KillMode':'control-group',
                    'SendSIGKILL':'yes','StartLimitIntervalUSec':'0'}
        guards.require_watchdog_properties(properties)
        for key, wrong in [('RuntimeMaxUSec','infinity'),('KillMode','process'),
                           ('TimeoutStopUSec','infinity'),('SendSIGKILL','no'),
                           ('Restart','no'),('StartLimitIntervalUSec','10s')]:
            with self.subTest(key=key), self.assertRaisesRegex(ValueError,'RUNTIME_CONTAINMENT_UNCONFIRMED'):
                guards.require_watchdog_properties({**properties,key:wrong})

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

    def test_staged_migrations_require_exact_names_and_hashes(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);source=b'SELECT 1;\n';digest=hashlib.sha256(source).hexdigest()
            (root/'038-independent-coach-materials.sql').write_bytes(source)
            expected=[{'name':'038-independent-coach-materials.sql','sha256':digest}]
            self.assertEqual(guards.require_staged_migrations(root,expected),1)
            (root/'038-independent-coach-materials.sql').write_bytes(b'SELECT 2;\n')
            with self.assertRaisesRegex(ValueError,'STAGED_MIGRATION_HASH_MISMATCH'):
                guards.require_staged_migrations(root,expected)
            (root/'unexpected.sql').write_bytes(source)
            with self.assertRaisesRegex(ValueError,'STAGED_MIGRATION_SET_MISMATCH'):
                guards.require_staged_migrations(root,expected)

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
                   'oldMigrations':[{'name':'000-original.sql','sha256':'f'*64}],
                   'expectedSchemaSha256':'a'*64,'databaseImageId':'sha256:'+'b'*64}
            value['expectedMigrations']=value['oldMigrations']+[{'name':name,'sha256':'e'*64} for name in ['034-workflow-provider-spend.sql','035-password-reset-delivery.sql','036-workflow-dispatch-boundary.sql','037-research-exploration-control.sql','038-independent-coach-materials.sql']]
            value['stagedMigrations']=[{'name':'000-original.sql','sha256':'a'*64},*value['expectedMigrations'][1:]]
            binding=root/'binding.json';binding.write_text(json.dumps(value))
            self.assertEqual(guards.read_binding(binding,*files),value)
            legacy={**value,
                    'oldMigrations':[{'name':'000-original.sql','sha256':'1'*64}],
                    'expectedMigrations':[{'name':'000-original.sql','sha256':'1'*64},*value['expectedMigrations'][1:]],
                    'stagedMigrations':[{'name':'000-original.sql','sha256':'2'*64},*value['expectedMigrations'][1:]]}
            binding.write_text(json.dumps(legacy))
            self.assertEqual(guards.read_binding(binding,*files),legacy)
            binding.write_text(json.dumps({**legacy,'expectedMigrations':[{'name':'001-other.sql','sha256':'2'*64},*legacy['expectedMigrations'][1:]]}))
            with self.assertRaisesRegex(ValueError,'CANONICAL_POST_MIGRATION_BINDING_REQUIRED'):
                guards.read_binding(binding,*files)
            with self.assertRaisesRegex(ValueError,'CANONICAL_POST_MIGRATION_BINDING_REQUIRED'):
                binding.write_text(json.dumps({**value,'expectedMigrations':value['expectedMigrations'][:-1]}));guards.read_binding(binding,*files)
            for key,wrong in [('operationSha256','f'*64),('originalContainerId','short'),('releaseLabel','../escape'),('publicOrigin','http://lqynb.xyz'),('publish',True),('providerCalls',1),('oldMigrations',[]),('expectedMigrations',value['oldMigrations']),('stagedMigrations',value['stagedMigrations'][:-1]),('expectedSchemaSha256','short'),('databaseImageId','mutable-tag')]:
                with self.subTest(key=key),self.assertRaises(ValueError):
                    binding.write_text(json.dumps({**value,key:wrong}));guards.read_binding(binding,*files)


if __name__ == '__main__':
    unittest.main()
