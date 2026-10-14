"""Serial private-clone rehearsal; keep primary data and restore the public old service.

Adapted from the existing reviewed 82b8572 operation. Never invoke without exact
binding plus independent review of this operation, guards, verifier and dispatcher.
"""
import argparse,datetime,hashlib,json,os,pathlib,re,runpy,subprocess,time,urllib.parse,uuid

MIGRATION_QUERY="SELECT coalesce(json_agg(json_build_object('name',name,'sha256',sha256) ORDER BY name),'[]'::json) FROM lifeos_schema_migrations"

def main():
 import fcntl
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--binding',required=True)
 args=parser.parse_args()
 directory=pathlib.Path(__file__).resolve().parent
 guards_file=directory/'recovery-guards.py';verifier=directory/'verify-restoration.py'
 guards=runpy.run_path(str(guards_file))
 binding=guards['read_binding'](args.binding,__file__,guards_file,verifier)
 RELEASE_LABEL=binding['releaseLabel'];EXPECTED_HEAD=binding['expectedHead'];EXPECTED_IMAGE_ID=binding['expectedImageId']
 """Rendered constants supplied by the caller; private clone, internal network."""
 root=pathlib.Path('/opt/lifeos').resolve();assert str(root)=='/opt/lifeos'
 release=root/'releases'/RELEASE_LABEL
 assert release.resolve()==release and pathlib.Path(args.binding).resolve()==release/'operation-binding.json','CANONICAL_BINDING_PATH_REQUIRED'
 assert json.loads((release/'manifest.json').read_text())['head']==EXPECTED_HEAD
 old_head=binding['oldHead']
 old_image=binding['oldImageId']
 label=RELEASE_LABEL;names=['lifeos-serial-old-'+label,'lifeos-serial-new-'+label,'lifeos-serial-migrate-'+label]
 network='lifeos-rehearsal-'+label;db='lifeos_recovery_'+RELEASE_LABEL.replace('-','_')
 backup=root/'backups'/('rehearsal-'+label);report_path=release/'isolated-rehearsal-report.json'
 assert not report_path.exists() and not backup.exists()
 lock_path='/run/lifeos-serial-rehearsal.lock'
 lock=os.fdopen(os.open(lock_path,os.O_WRONLY|os.O_CREAT,0o600),'w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 started=time.monotonic();overall_deadline=started+435;deadline=started+300
 def budget(seconds):
  remaining=deadline-time.monotonic()
  if remaining<=0:raise RuntimeError('AGGREGATE_REHEARSAL_DEADLINE')
  return min(seconds,remaining)
 def bounded_run(args,timeout=20,**kw):
  return subprocess.run(args,timeout=budget(timeout),**kw)
 def pause(seconds):time.sleep(budget(seconds))
 def run(args,timeout=20,**kw):
  return subprocess.check_output(args,text=True,timeout=budget(timeout),stderr=subprocess.DEVNULL,**kw).strip()
 def sql(database,query):return run(['docker','exec','-e','PGOPTIONS=-c statement_timeout=2500','lifeos-db-1','psql','-U','lifeos','-d',database,'-Atc',query])
 def health(name):
  for _ in range(45):
   state=json.loads(run(['docker','inspect','--format','{{json .State}}',name]))
   if not state['Running']:raise RuntimeError('PRIVATE_CONTAINER_EXITED')
   try:
    body=json.loads(run(['docker','exec',name,'node','-e',"fetch('http://127.0.0.1:8787/api/ready').then(async r=>{const x=await r.json();if(!r.ok||!x.ready)process.exit(2);console.log(JSON.stringify(x));process.exit(0)}).catch(()=>process.exit(2))"],timeout=5))
    if body.get('ready'):return body
   except (subprocess.CalledProcessError,subprocess.TimeoutExpired,json.JSONDecodeError):pass
   pause(1)
  raise RuntimeError('PRIVATE_NOT_READY')
 def available():return int(next(x.split()[1] for x in pathlib.Path('/proc/meminfo').read_text().splitlines() if x.startswith('MemAvailable:')))*1024
 def campus():return {'unit':run(['systemctl','show','campus-advisor.service','-p','MainPID','-p','ActiveState']),'health':json.loads(run(['curl','-fsS','--max-time','5','http://127.0.0.1:8001/api/healthz']))}
 def version(name):return json.loads(run(['docker','exec',name,'node','-e',"fetch('http://127.0.0.1:8787/api/run/version').then(async r=>{console.log(JSON.stringify(await r.json()));process.exit(0)}).catch(()=>process.exit(2))"],timeout=8))
 original=json.loads(run(['docker','inspect','lifeos-app-1']))[0]
 expected_original={'containerId':binding['originalContainerId'],'imageId':old_image}
 guards['require_original'](original,expected_original,binding['originalLabels'])
 assert original['State']['Running'] and version('lifeos-app-1')['head']==old_head
 assert json.loads(sql('lifeos',MIGRATION_QUERY))==binding['oldMigrations']
 old_manifest=release/'original-migrations.json';assert not old_manifest.exists()
 old_manifest.write_text(json.dumps(binding['oldMigrations'])+'\n');os.chmod(old_manifest,0o600)
 old_manifest_sha=hashlib.sha256(old_manifest.read_bytes()).hexdigest()
 def public_recovery():
  return json.loads(run(['python3',str(verifier),'--origin',binding['publicOrigin'],'--expected-head',old_head,'--expected-image-id',old_image,'--app-container',expected_original['containerId'],'--migrations',str(old_manifest),'--migrations-sha256',old_manifest_sha,'--timeout-seconds',str(budget(40))],timeout=41))
 def exclusive(allowed=()):
  guards['require_encoder_exclusive'](allowed)
  units=run(['systemctl','list-units','--type=service','--state=running','--no-legend','--plain'])
  assert not any(re.search(r'ollama|vllm|embedding|encoder|llama',line.split()[0],re.I) for line in units.splitlines() if line.split()),'HOST_MODEL_SERVICE_RUNNING'
 exclusive([original['Id']])
 assert run(['docker','image','inspect','--format','{{.Id}}',EXPECTED_IMAGE_ID])==EXPECTED_IMAGE_ID
 assert json.loads(sql('lifeos',MIGRATION_QUERY))==binding['oldMigrations']
 for name in names:
  assert bounded_run(['docker','inspect',name],capture_output=True,timeout=8).returncode!=0,'EXISTING_PRIVATE_TARGET'
 running=json.loads(run(['docker','inspect',*run(['docker','ps','-q']).splitlines()]))
 assert all(c['Name'] in ['/lifeos-app-1','/lifeos-db-1'] or not (c['Config']['Image'].startswith('lifeos:') or any(e.startswith('LIFEOS_ORIGIN=') for e in c['Config']['Env'])) for c in running),'OTHER_LIFEOS_ENCODER_RUNNING'
 before_campus=campus();assert before_campus['health']['ok']
 env=dict(x.split('=',1) for x in original['Config']['Env'] if '=' in x)
 target=urllib.parse.urlsplit(env['DATABASE_URL']);assert target.hostname and '/' not in target.hostname
 env['DATABASE_URL']=urllib.parse.urlunsplit((target.scheme,target.netloc,'/'+db,target.query,target.fragment))
 env.update({'LIFEOS_ADVANCED_WORKFLOWS':'false','LIFEOS_REAL_WORKFLOWS':'false','LIFEOS_COZE_KNOWLEDGE':'false','LIFEOS_COZE_GROWTH':'false','LIFEOS_PASSWORD_RESET_ENABLED':'false'})
 private_env=release/('rehearsal-'+label+'.env');assert not private_env.exists()
 private_env.write_text('\n'.join(k+'='+v for k,v in env.items())+'\n');os.chmod(private_env,0o600)
 backup.mkdir(mode=0o700)
 ownership_path=release/'private-ownership.json';assert not ownership_path.exists()
 ownership={'releaseLabel':label,'containers':{},'network':None,'creationIntents':{}}
 def save_ownership():
  temporary=release/'private-ownership.next'
  with temporary.open('w') as output:
   os.chmod(temporary,0o600);output.write(json.dumps(ownership)+'\n');output.flush();os.fsync(output.fileno())
  os.replace(temporary,ownership_path)
  descriptor=os.open(release,os.O_RDONLY);os.fsync(descriptor);os.close(descriptor)
 save_ownership()
 rescue=release/('rescue-'+label+'.sh');assert not rescue.exists()
 recover='#!/bin/sh\nset -eu\nexec python3 '+str(guards_file)+' --rescue-binding '+str(release/'operation-binding.json')+' --migrations '+str(old_manifest)+' --migrations-sha256 '+old_manifest_sha+'\n'
 rescue.write_text(recover);os.chmod(rescue,0o700)
 unit='lifeos-isolated-rescue-'+RELEASE_LABEL
 run(['systemd-run','--unit='+unit,'--on-active=10m','--timer-property=AccuracySec=1s','--timer-property=RandomizedDelaySec=0','--property=Type=simple','--property=Restart=on-failure','--property=RestartSec=20s','--property=TimeoutStartSec=115s','--property=RuntimeMaxSec=115s','--property=TimeoutStopSec=5s','--property=KillMode=control-group','--property=SendSIGKILL=yes','--property=StartLimitIntervalSec=0',str(rescue)])
 assert run(['systemctl','is-active',unit+'.timer'])=='active'
 watchdog_properties=dict(line.split('=',1) for line in run(['systemctl','show',unit+'.service','-p','Type','-p','Restart','-p','RestartUSec','-p','RuntimeMaxUSec','-p','TimeoutStopUSec','-p','KillMode','-p','SendSIGKILL','-p','StartLimitIntervalUSec']).splitlines())
 guards['require_watchdog_properties'](watchdog_properties)
 def private_state(name):
  result=bounded_run(['docker','inspect',name],capture_output=True,text=True,timeout=budget(8))
  if result.returncode!=0:
   assert not run(['docker','ps','-aq','--filter','name=^/'+name+'$']),'PRIVATE_STATE_UNCONFIRMED'
   return None
  current=json.loads(result.stdout)[0]
  persisted=json.loads(ownership_path.read_text());assert persisted['releaseLabel']==label
  image=old_image if name==names[0] else EXPECTED_IMAGE_ID
  guards['require_private_or_inert_intent'](current,persisted['containers'].get(name),persisted.get('creationIntents',{}).get(name),name,image,label)
  return current
 def create_private(args,name,image,command=()):
  assert name not in ownership['creationIntents'] and name not in ownership['containers']
  token=uuid.uuid4().hex
  ownership['creationIntents'][name]={'name':name,'imageId':image,'token':token};save_ownership()
  container_id=run(args+['--label','lifeos.creation-intent='+token,image,*command]);assert re.fullmatch('[a-f0-9]{64}',container_id)
  expected={'name':name,'containerId':container_id,'imageId':image}
  guards['require_private'](json.loads(run(['docker','inspect',container_id]))[0],expected,label)
  ownership['containers'][name]=expected;save_ownership()
  return container_id
 def owned_network():
  expected=json.loads(ownership_path.read_text())['network'];assert expected,'NETWORK_NOT_CAPTURED'
  current=json.loads(run(['docker','network','inspect',expected['networkId']]))[0]
  guards['require_network'](current,expected,label)
  return current['Id']
 def attach_private(name):
  current=private_state(name);assert current and current['State']['Running'] is False
  assert set(current['NetworkSettings']['Networks'])=={'none'},'CREATE_MUST_BE_NETWORK_ISOLATED'
  run(['docker','network','disconnect','none',current['Id']])
  current=private_state(name);assert not current['NetworkSettings']['Networks']
  run(['docker','network','connect',owned_network(),current['Id']])
  current=private_state(name);owned_network()
  assert set(current['NetworkSettings']['Networks'])=={network},'PRIVATE_ATTACHMENT_CHANGED'
  return current['Id']
 def private_stopped():
  for name in names:
   current=private_state(name)
   if current:assert current['State']['Running'] is False,'PRIVATE_STILL_RUNNING'
  return True
 report={'kind':'ISOLATED_SERIAL_PRIVATE_RESTORED_IMAGE_REHEARSAL','head':EXPECTED_HEAD,'starts':[],'cleanupErrors':[],'providerNetwork':'internal_application_network_no_external_route','externalSmtpRouteAvailable':False,'smtpMessagesSent':'NOT_OBSERVED_NETWORK_ISOLATED','originalServiceRestored':False}
 created=[];network_created=False;db_connected=False
 try:
  current=json.loads(run(['docker','inspect','lifeos-app-1']))[0]
  guards['require_original'](current,expected_original,binding['originalLabels'])
  assert version(original['Id'])['head']==old_head
  exclusive([original['Id']])
  report['preStopMemory']=guards['require_recovery_memory'](current)
  run(['docker','stop','--time','35',original['Id']],timeout=45)
  exclusive()
  pause(8)
  report['postStopMemoryCapMiB']=guards['recovery_memory_cap'](available())
  dump=backup/'quiescent.dump'
  with dump.open('wb') as f:bounded_run(['docker','exec','lifeos-db-1','pg_dump','-U','lifeos','-d','lifeos','--format=custom','--no-owner','--no-acl'],stdout=f,stderr=subprocess.DEVNULL,check=True,timeout=budget(90))
  os.chmod(dump,0o600);run(['docker','exec','lifeos-db-1','createdb','-U','lifeos',db])
  with dump.open('rb') as f:bounded_run(['docker','exec','-i','lifeos-db-1','pg_restore','-U','lifeos','-d',db,'--no-owner','--no-acl','--exit-on-error'],stdin=f,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True,timeout=budget(90))
  tables=json.loads(sql('lifeos',"SELECT json_agg(json_build_object('name',table_name,'columns',(SELECT json_agg(column_name ORDER BY ordinal_position) FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=t.table_name)) ORDER BY table_name) FROM information_schema.tables t WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name<>'lifeos_schema_migrations'"))
  def digests(database,selected_tables=None):
   values=[]
   for t in selected_tables if selected_tables is not None else tables:
    q=lambda v:'"'+v.replace('"','""')+'"'
    query='SELECT count(*)::text||chr(58)||coalesce(md5(string_agg(md5(row_to_json(t)::text),chr(124) ORDER BY md5(row_to_json(t)::text))),chr(45)) FROM (SELECT '+','.join(q(c) for c in t['columns'])+' FROM '+q(t['name'])+') t'
    values.append({'table':t['name'],'digest':sql(database,query)})
   return values
  def column_metadata(database,full=False):
   rows=json.loads(sql(database,"SELECT coalesce(json_agg(json_build_object('table',table_name,'column',column_name,'ordinal',ordinal_position,'data_type',data_type,'udt_schema',udt_schema,'udt_name',udt_name,'nullable',is_nullable,'default',column_default,'length',character_maximum_length,'precision',numeric_precision,'scale',numeric_scale,'datetime_precision',datetime_precision,'identity',is_identity,'identity_generation',identity_generation,'generated',is_generated,'generation_expression',generation_expression,'collation_schema',collation_schema,'collation_name',collation_name) ORDER BY table_name,ordinal_position),'[]'::json) FROM information_schema.columns WHERE table_schema='public'"))
   old={(t['name'],c) for t in tables for c in t['columns']}
   return rows if full else [r for r in rows if (r['table'],r['column']) in old]
  before=digests('lifeos');before_columns=column_metadata('lifeos');assert digests(db)==before and column_metadata(db)==before_columns,'SOURCE_RESTORE_DIGEST_OR_SCHEMA_MISMATCH'
  assert json.loads(sql(db,MIGRATION_QUERY))==binding['oldMigrations'],'RESTORED_MIGRATION_MANIFEST_CHANGED'
  network_id=run(['docker','network','create','--internal','--label','lifeos.rehearsal='+label,network]);network_created=True
  ownership['network']={'name':network,'networkId':network_id};save_ownership()
  database_container=json.loads(run(['docker','inspect','lifeos-db-1']))[0]
  database_id=database_container['Id'];assert database_container['Config']['Labels'].get('com.docker.compose.service')=='db' and database_container['Config']['Labels'].get('com.docker.compose.project')=='lifeos'
  run(['docker','network','connect','--alias',target.hostname,owned_network(),database_id]);db_connected=True
  created.append(names[2])
  assert database_container['Image']==binding['databaseImageId'],'DATABASE_RUNTIME_IMAGE_CHANGED'
  migration_id=create_private(['docker','create','--name',names[2],'--label','lifeos.rehearsal='+label,'--network','none','--pids-limit','64','--log-driver','local','--log-opt','max-size=2m','--log-opt','max-file=2','--memory','256m','--memory-swap','256m','--cpus','0.5','--env-file',str(private_env),'--entrypoint','node'],names[2],EXPECTED_IMAGE_ID,['--import','tsx','scripts/migrate-db.ts'])
  assert attach_private(names[2])==migration_id
  assert private_state(names[2]);run(['docker','start','-a',migration_id],timeout=90)
  assert private_state(names[2])['State']['ExitCode']==0,'MIGRATION_CONTAINER_FAILED'
  assert json.loads(sql(db,MIGRATION_QUERY))==binding['expectedMigrations'],'POST_MIGRATION_EXACT_MANIFEST_CHANGED'
  assert digests(db)==before and digests('lifeos')==before,'COMMON_COLUMNS_CHANGED'
  assert column_metadata(db)==before_columns and column_metadata('lifeos')==before_columns,'EXISTING_COLUMN_SCHEMA_CHANGED'
  counts=lambda:sql(db,"SELECT json_build_object('spend',(SELECT count(*) FROM lifeos_provider_spend),'nodes',(SELECT count(*) FROM lifeos_workflow_nodes),'mail',(SELECT count(*) FROM lifeos_password_reset_deliveries))")
  # Table name is checked against the actual additive migration before execution.
  counts_before=counts()
  actor='rehearsal-research-'+EXPECTED_HEAD[:7]
  conversation,message,request=[str(uuid.uuid4()) for _ in range(3)]
  sql(db,"INSERT INTO \"user\"(id,name,email,\"emailVerified\",\"createdAt\",\"updatedAt\") VALUES ('"+actor+"','Synthetic rollback control','"+actor+"@example.invalid',false,now(),now()); INSERT INTO conversations(id,user_id,title) VALUES ('"+conversation+"','"+actor+"','Synthetic rollback control'); INSERT INTO messages(id,user_id,conversation_id,role,content,run_request_id) VALUES ('"+message+"','"+actor+"','"+conversation+"','user','先别推科研探索','"+request+"'); INSERT INTO runs(user_id,request_id,conversation_id,source_message_id,fingerprint,status,expected_version) VALUES ('"+actor+"','"+request+"','"+conversation+"','"+message+"','synthetic-rollback-control','completed',0); INSERT INTO growth_direction_controls(user_id,scope,state,revision,source_quote,source_conversation_id,source_message_id,origin_request_id) VALUES ('"+actor+"','research_exploration','paused',1,'先别推科研探索','"+conversation+"','"+message+"','"+request+"')")
  clone_tables=json.loads(sql(db,"SELECT json_agg(json_build_object('name',table_name,'columns',(SELECT json_agg(column_name ORDER BY ordinal_position) FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=t.table_name)) ORDER BY table_name) FROM information_schema.tables t WHERE table_schema='public' AND table_type='BASE TABLE'"))
  clone_baseline=digests(db,clone_tables);clone_columns=column_metadata(db,full=True)
  def schema_digest(database):
   text=run(['docker','exec','-e','PGOPTIONS=-c statement_timeout=2500','lifeos-db-1','pg_dump','-U','lifeos','-d',database,'--schema-only','--no-owner','--no-acl'],timeout=15)
   return guards['schema_sha256'](text)
  clone_schema= schema_digest(db)
  assert clone_schema==binding['expectedSchemaSha256'],'CANONICAL_POST_MIGRATION_SCHEMA_CHANGED'
  migrations=['034-workflow-provider-spend.sql','035-password-reset-delivery.sql','036-workflow-dispatch-boundary.sql','037-research-exploration-control.sql']
  for kind,image in [('old',old_image),('new',EXPECTED_IMAGE_ID)]:
   exclusive()
   cap=guards['recovery_memory_cap'](available())
   name=names[0 if kind=='old' else 1]
   args=['docker','create','--name',name,'--label','lifeos.rehearsal='+label,'--network','none','--init','--pids-limit','96','--log-driver','local','--log-opt','max-size=2m','--log-opt','max-file=2','--read-only','--tmpfs','/tmp:rw,nosuid,size=64m','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory',str(cap)+'m','--memory-swap',str(cap)+'m','--cpus','1','--env-file',str(private_env)]
   if kind=='new':args+=['-e','LIFEOS_EVIDENCE=/app/evidence/v1.3-action-coach/provider/qwen-current','-e','LIFEOS_BUILD_COMMIT='+EXPECTED_HEAD]
   else:
    for mount in original['Mounts']:
     if mount['Type']=='bind':args+=['--mount','type=bind,src='+mount['Source']+',dst='+mount['Destination']+',readonly']
    for migration in migrations:args+=['--mount','type=bind,src='+str(release/'app/server/migrations'/migration)+',dst=/app/server/migrations/'+migration+',readonly']
   created.append(name);container_id=create_private(args,name,image)
   assert attach_private(name)==container_id
   assert private_state(name);run(['docker','start',container_id])
   current=json.loads(run(['docker','inspect',name]))[0];assert current['Image']==image
   assert current['NetworkSettings']['Networks'][network]['NetworkID']==owned_network()
   ready=health(container_id);actual=version(container_id);assert actual['head']==(old_head if kind=='old' else EXPECTED_HEAD)
   if kind=='old':
    check="import {readDirectionControls} from './server/growth-controls.ts';import {buildTurnPrompt} from './server/turn-prompt.ts';import {pool} from './server/db.ts';const controls=await readDirectionControls('"+actor+"');const p=JSON.parse(buildTurnPrompt({currentMessageId:'synthetic-rollback-message',messages:[{id:'synthetic-rollback-message',role:'user',content:'我先了解实际工作。',created_at:new Date().toISOString()}],directionControls:controls,blockedDirectionScopes:controls.filter(x=>x.state==='paused').map(x=>x.scope)}));if(!p.directionControls.some(x=>x.scope==='research_exploration'&&x.state==='paused'&&x.sourceQuote==='先别推科研探索')||!p.blockedDirectionScopes.includes('research_exploration'))process.exit(2);await pool.end();console.log('OLD_RESEARCH_PAUSE_AND_PROVENANCE_RETAINED');"
    assert run(['docker','exec',container_id,'node','--import','tsx','--input-type=module','-e',check],timeout=15)=='OLD_RESEARCH_PAUSE_AND_PROVENANCE_RETAINED'
    report['oldReaderResearchPauseCompatibility']='VERIFIED_RAW_CONTROL_SOURCE_AND_BLOCKED_SCOPE_IN_ORDINARY_PROMPT'
   report['starts'].append({'kind':kind,'head':actual['head'],'ready':ready,'capMiB':cap,'hostReserveMiB':256,'externalNetwork':False,'imageId':image})
   owned=private_state(name);assert owned
   run(['docker','stop','--time','25',owned['Id']],timeout=35)
   assert private_state(name)['State']['Running'] is False
   assert digests(db,clone_tables)==clone_baseline,'POST_START_FULL_CLONE_TABLE_CONTENTS_CHANGED_'+kind
   assert column_metadata(db,full=True)==clone_columns,'POST_START_CLONE_COLUMN_METADATA_CHANGED_'+kind
   assert schema_digest(db)==clone_schema,'POST_START_FULL_CLONE_SCHEMA_CHANGED_'+kind
  assert counts()==counts_before,'STARTUP_ACCOUNTING_CHANGED'
  assert digests(db,clone_tables)==clone_baseline,'POST_START_FULL_CLONE_TABLE_CONTENTS_CHANGED'
  assert column_metadata(db,full=True)==clone_columns,'POST_START_CLONE_COLUMN_METADATA_CHANGED'
  assert schema_digest(db)==clone_schema,'POST_START_FULL_CLONE_SCHEMA_CHANGED'
  assert digests('lifeos')==before and column_metadata('lifeos')==before_columns,'PRIMARY_CONTENT_OR_SCHEMA_CHANGED'
  report['postStartupAllCloneTablesMatched']=len(clone_tables)
  report['restoredDatabase']=db;report['accountingCountsUnchanged']=json.loads(counts_before)
  report['backup']={'sha256':hashlib.sha256(dump.read_bytes()).hexdigest(),'bytes':dump.stat().st_size,'sourceRestoreAndMigratedCommonTablesMatched':len(before),'privateDataStayedOnServer':True,'preExistingColumnMetadataMatched':len(before_columns)}
  report['status']='PASS_PRIVATE_STARTUP_AND_SOURCE_RESTORE_FIDELITY'
 except Exception as error:
  report['status']='FAIL';report['failureType']=type(error).__name__;report['reason']=str(error) if isinstance(error,(AssertionError,RuntimeError)) else 'PRIVATE_OPERATION_FAILED'
 finally:
  deadline=min(overall_deadline,time.monotonic()+125)
  for name in names:
   try:
    owned=private_state(name)
    if not owned:continue
    stopped=bounded_run(['docker','stop','--time','2',owned['Id']],capture_output=True,timeout=15)
    if stopped.returncode!=0:
     again=private_state(name)
     if again:bounded_run(['docker','kill',again['Id']],capture_output=True,timeout=10,check=True)
    current=private_state(name)
    if current:assert current['State']['Running'] is False
   except Exception:report['cleanupErrors'].append('PRIVATE_STOP_UNCONFIRMED_'+name)
  if report['cleanupErrors']:
   try:
    # Delegate to the same supervised service, never a second unsupervised shell.
    run(['systemctl','start','--no-block',unit+'.service'])
    fcntl.flock(lock,fcntl.LOCK_UN)
    rescue_deadline=time.monotonic()+budget(112)
    while True:
     state=dict(line.split('=',1) for line in run(['systemctl','show',unit+'.service','-p','ActiveState','-p','Result','-p','ExecMainStatus']).splitlines())
     if state['ActiveState']=='inactive' and state['Result']=='success' and state['ExecMainStatus']=='0':break
     assert time.monotonic()<rescue_deadline,'SUPERVISED_RESCUE_PENDING'
     pause(1)
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    assert private_stopped()
    report['publicRestoration']=public_recovery()
    assert report['publicRestoration']['status']=='PASS_RESTORATION_READBACK' and campus()==before_campus
    report['supervisedImmediateRescueUsed']=True;report['originalServiceRestored']=True;report['cleanupErrors']=[]
   except Exception:report['cleanupErrors'].append('IMMEDIATE_RESCUE_UNCONFIRMED')
  if not report['cleanupErrors'] and not report['originalServiceRestored']:
   try:
    assert private_stopped()
    current=json.loads(run(['docker','inspect','lifeos-app-1']))[0]
    guards['require_original'](current,expected_original,binding['originalLabels'])
    exclusive([original['Id']] if current['State']['Running'] else ())
    if not current['State']['Running']:run(['docker','start',original['Id']])
    report['originalReady']=health(original['Id'])
    report['publicRestoration']=public_recovery()
    assert report['publicRestoration']['status']=='PASS_RESTORATION_READBACK'
    assert campus()==before_campus
    report['originalServiceRestored']=True
   except Exception:report['cleanupErrors'].append('ORIGINAL_SERVICE_VERIFICATION_FAILED')
  if report['originalServiceRestored']:
   try:
    for suffix in ['.timer','.service']:bounded_run(['systemctl','stop',unit+suffix],capture_output=True,timeout=15)
    for suffix in ['.timer','.service']:assert bounded_run(['systemctl','is-active',unit+suffix],capture_output=True,text=True,timeout=8).stdout.strip() not in ['active','activating','deactivating']
   except Exception:report['cleanupErrors'].append('RESCUE_STOP_UNCONFIRMED')
   try:
    if db_connected:bounded_run(['docker','network','disconnect','--force',owned_network(),database_id],capture_output=True,timeout=15,check=True)
    for name in names:
     current=private_state(name)
     if current and network in current['NetworkSettings']['Networks']:bounded_run(['docker','network','disconnect','--force',owned_network(),current['Id']],capture_output=True,timeout=15,check=True)
    if network_created:bounded_run(['docker','network','rm',owned_network()],capture_output=True,timeout=15,check=True)
   except Exception:report['cleanupErrors'].append('PRIVATE_NETWORK_CLEANUP_UNCONFIRMED')
  else:report['status']='RECOVERY_UNCONFIRMED_RESCUE_LEFT_ARMED'
  if report['cleanupErrors'] and report['originalServiceRestored']:report['status']='FAIL_CLEANUP'
  report['retainedPrivateArtifacts']={'backup':str(backup),'restoredDatabase':db,'environment':str(private_env),'intendedPrivateNames':names,'rescueScript':str(rescue),'retentionReason':'Recovery and exact first-attempt evidence retained privately; no automatic rerun with same names.'}
  report['elapsedSeconds']=time.monotonic()-started
  report['operationScope']='PRIVATE_DATABASE_SERIAL_STARTS_PUBLIC_OLD_VERSION_RESTORED_NO_RELEASE'
  report['at']=datetime.datetime.now(datetime.timezone.utc).isoformat();report_path.write_text(json.dumps(report,indent=2));os.chmod(report_path,0o600)

 print(json.dumps(report))
 if report['status']!='PASS_PRIVATE_STARTUP_AND_SOURCE_RESTORE_FIDELITY' or not report['originalServiceRestored']:raise SystemExit(2)

if __name__=='__main__':main()
