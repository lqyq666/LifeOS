"""Linux-only simulated Docker faults, isolated from host Docker and production."""
import contextlib,hashlib,importlib.util,io,json,subprocess,unittest,uuid
from pathlib import Path
from unittest.mock import patch

source=Path(__file__).resolve().parents[1]/'deploy/recovery-guards.py'
spec=importlib.util.spec_from_file_location('guards',source)
guards=importlib.util.module_from_spec(spec);spec.loader.exec_module(guards)

class RecoveryWatchdogTests(unittest.TestCase):
    def setUp(self):
        self.label='recovery-aaaaaaa-'+uuid.uuid4().hex[:8]
        self.root=Path('/opt/lifeos/releases')/self.label;self.root.mkdir()
        for name,content in [('recovery-guards.py',source.read_bytes()),('rehearse-production.py',b'fixture-operation'),('verify-restoration.py',b'fixture-verifier')]:
            (self.root/name).write_bytes(content)
        self.old=[{'name':'000-original.sql','sha256':'f'*64}]
        self.binding={'releaseLabel':self.label,'expectedHead':'a'*40,'oldHead':'b'*40,
            'expectedImageId':'sha256:'+'c'*64,'oldImageId':'sha256:'+'d'*64,'databaseImageId':'sha256:'+'e'*64,
            'originalContainerId':'f'*64,'originalLabels':{'com.docker.compose.project':'lifeos','com.docker.compose.service':'app'},
            'oldMigrations':self.old,'expectedMigrations':self.old+[{'name':name,'sha256':'e'*64} for name in ['034-workflow-provider-spend.sql','035-password-reset-delivery.sql','036-workflow-dispatch-boundary.sql','037-research-exploration-control.sql']],
            'expectedSchemaSha256':'a'*64,'publicOrigin':'https://lqynb.xyz','providerCalls':0,'cozeCalls':0,'publish':False}
        for key,name in [('operationSha256','rehearse-production.py'),('guardsSha256','recovery-guards.py'),('verifierSha256','verify-restoration.py')]:
            self.binding[key]=hashlib.sha256((self.root/name).read_bytes()).hexdigest()
        self.path=self.root/'operation-binding.json';self.path.write_text(json.dumps(self.binding))
        self.migrations=self.root/'original-migrations.json';self.migrations.write_text(json.dumps(self.old))
        self.sha=hashlib.sha256(self.migrations.read_bytes()).hexdigest()
        self.original={'Id':'f'*64,'Name':'/lifeos-app-1','Image':self.binding['oldImageId'],'Config':{'Labels':self.binding['originalLabels']},'State':{'Running':False}}
        self.containers={};owners={}
        for index,kind in enumerate(('old','new','migrate')):
            name='lifeos-serial-'+kind+'-'+self.label;cid=str(index+1)*64
            image=self.binding['oldImageId'] if kind=='old' else self.binding['expectedImageId']
            owners[name]={'name':name,'containerId':cid,'imageId':image}
            self.containers[name]={'Id':cid,'Name':'/'+name,'Image':image,'Config':{'Labels':{'lifeos.rehearsal':self.label}},'State':{'Running':True}}
        (self.root/'private-ownership.json').write_text(json.dumps({'releaseLabel':self.label,'containers':owners}))
        self.clock=0;self.calls=[];self.allowed=[];self.fail_stops=False

    def command(self,args,**kwargs):
        cap=kwargs['timeout'];self.calls.append((args,cap))
        duration=3
        if args[:2]==['docker','stop']:duration=8
        if args[:2]==['docker','start']:duration=10
        if args[0]=='python3':duration=40
        if duration>cap or (self.fail_stops and args[:2]==['docker','stop']):
            self.clock+=cap;raise subprocess.TimeoutExpired(args,cap)
        self.clock+=duration
        if args[:2]==['docker','inspect']:
            if args[2]=='lifeos-app-1':return json.dumps([self.original])
            return json.dumps([self.containers[args[2]]])
        if args[:2] in (['docker','stop'],['docker','kill']):
            next(value for value in self.containers.values() if value['Id']==args[-1])['State']['Running']=False
            return args[-1]
        if args[:2]==['docker','start']:self.original['State']['Running']=True;return args[2]
        if args[0]=='systemctl':return 'campus-advisor.service loaded active running'
        if args[0]=='python3':return json.dumps({'status':'PASS_RESTORATION_READBACK'})
        raise AssertionError(args)

    def recover(self):
        with patch.object(guards,'__file__',str(self.root/'recovery-guards.py')),patch.object(guards.time,'monotonic',lambda:self.clock),patch.object(guards.subprocess,'check_output',self.command),patch.object(guards,'require_encoder_exclusive',lambda allowed:self.allowed.append(list(allowed))),contextlib.redirect_stdout(io.StringIO()):
            guards.recover_original(str(self.path),str(self.migrations),self.sha)

    def test_near_maximum_docker_commands_leave_full_public_verification_budget(self):
        self.recover()
        self.assertLessEqual(self.clock,110)
        verifier=next((args,cap) for args,cap in self.calls if args[0]=='python3')
        self.assertGreaterEqual(float(verifier[0][-1]),40)
        self.assertGreaterEqual(verifier[1],40)
        self.assertTrue(self.original['State']['Running'])

    def test_retry_after_original_start_allows_only_bound_original_encoder(self):
        self.original['State']['Running']=True
        self.recover()
        self.assertEqual(self.allowed,[['f'*64]])
        self.assertFalse(any(args[:2]==['docker','start'] for args,_ in self.calls))
        self.assertTrue(any(args[0]=='python3' for args,_ in self.calls))

    def test_replacement_with_copied_label_rejected_before_any_stop(self):
        next(iter(self.containers.values()))['Id']='9'*64
        with self.assertRaisesRegex(ValueError,'IMMUTABLE_OWNERSHIP_CHANGED'):self.recover()
        self.assertFalse(any(args[:2]==['docker','stop'] for args,_ in self.calls))

    def test_cleanup_budget_expiry_never_starts_original_over_private_workload(self):
        self.fail_stops=True
        with self.assertRaises((TimeoutError,subprocess.TimeoutExpired)):self.recover()
        self.assertLessEqual(self.clock,45)
        self.assertFalse(self.original['State']['Running'])
        self.assertFalse(any(args[:2]==['docker','start'] for args,_ in self.calls))

    def test_uncommitted_network_none_creation_is_retained_without_claim_or_start(self):
        name=next(iter(self.containers))
        manifest=json.loads((self.root/'private-ownership.json').read_text())
        del manifest['containers'][name]
        (self.root/'private-ownership.json').write_text(json.dumps(manifest))
        self.containers[name]['State']['Running']=False
        self.containers[name]['NetworkSettings']={'Networks':{'none':{}}}
        with self.assertRaisesRegex(ValueError,'IMMUTABLE_OWNERSHIP_CHANGED'):self.recover()
        self.assertFalse(any(args[:2] in (['docker','stop'],['docker','kill'],['docker','start']) for args,_ in self.calls))

    def test_committed_inert_containers_before_and_after_attachment_allow_original_recovery(self):
        for value,networks in zip(self.containers.values(),[{'none':{}},{},{'private-internal':{}}]):
            value['State']['Running']=False;value['NetworkSettings']={'Networks':networks}
        self.recover()
        self.assertTrue(self.original['State']['Running'])
        self.assertFalse(any(args[:2] in (['docker','stop'],['docker','kill']) for args,_ in self.calls))

if __name__=='__main__':unittest.main(verbosity=2)
