"""Freeze and deliver local candidate; no network, credentials, Git writes or DB writes."""
from pathlib import Path
import json, hashlib, re, subprocess, zipfile, difflib

root = Path(__file__).resolve().parents[1]
task = root / '.planning/research/agent-workflows'
def read_json(path): return json.loads(path.read_text(encoding='utf-8-sig'))
def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def save(name, value): (task / name).write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
baseline = read_json(task/'G0_BASELINE.json')
protected = baseline['protectedFiles']
missing = [f['file'] for f in protected if not (root/f['file']).is_file()]
changed = [f['file'] for f in protected if (root/f['file']).is_file() and digest(root/f['file']) != f['sha256']]
ledger_unchanged = digest(root/baseline['ledger']['path']) == baseline['ledger']['sha256']
if missing or set(changed) - {'server/turn-engine.ts'} or not ledger_unchanged:
    raise RuntimeError('Unexpected protected change; preserve evidence and stop packaging')
checkpoint = read_json(task/'CHECKPOINT_VERIFICATION.json')
archive = Path(checkpoint['package'])
if digest(archive) != checkpoint['sha256']: raise RuntimeError('Checkpoint hash drift')
with zipfile.ZipFile(archive) as z:
    matches = [n for n in z.namelist() if n.endswith('server/turn-engine.ts')]
    if len(matches) != 1: raise RuntimeError('Checkpoint engine ambiguous')
    original = z.read(matches[0]).decode('utf-8-sig').splitlines(keepends=False)
current = (root/'server/turn-engine.ts').read_text(encoding='utf-8-sig').splitlines(keepends=False)
patch = '\n'.join(difflib.unified_diff(original,current,fromfile='a/server/turn-engine.ts',tofile='b/server/turn-engine.ts',lineterm=''))+'\n'
(task/'INTEGRATION_PATCH.diff').write_text(patch, encoding='utf-8')
save('PROTECTION_VERIFICATION.json', {'protectedFiles':len(protected),'missing':missing,'changed':changed,'permittedSingleIntegratorChange':changed == ['server/turn-engine.ts'],'ledgerUnchanged':ledger_unchanged,'cloudWrite':False,'productionWrite':False})

def diagnostics(path):
    rows = [line.strip() for line in path.read_text(encoding='utf-8-sig').splitlines() if 'error TS' in line]
    return rows, set(re.sub(r'\(\d+,\d+\)', '(LINE)', line) for line in rows)
old, old_classes = diagnostics(task/'evidence/g0-server-typecheck.log')
new, new_classes = diagnostics(task/'evidence/final-server-typecheck.log')
save('evidence/SERVER_BASELINE_COMPARISON.json', {'baselineRawErrors':len(old),'currentRawErrors':len(new),'baselineClasses':len(old_classes),'currentClasses':len(new_classes),'added':sorted(new_classes-old_classes),'removed':sorted(old_classes-new_classes)})

owned = []
for directory in ['server/workflows','tests/workflows']:
    owned += list((root/directory).rglob('*'))
owned += list((root/'skills').glob('lifeos-*/SKILL.md'))
owned = [p for p in owned if p.is_file() and p.parent.name != 'lifeos-personal-companion']
owned += list((root/'tests/backend').glob('workflow-*.ts'))
owned += list((root/'scripts').glob('workflow-*'))
owned += [root/'tsconfig.workflows.json', root/'server/experience-insight.ts', root/'server/turn-engine.ts', root/'tests/fixtures/workflow-routing-v2.json']
source_files = {p.relative_to(root).as_posix():digest(p) for p in owned if p.is_file()}
report_path = task/'evidence/VERIFICATION_REPORT.json'
report = read_json(report_path)
tested_sources = [p for p in owned if p.is_file() and p.relative_to(root).as_posix().startswith(('server/','tests/','skills/'))]
if report['failed'] or report['passed'] != report['total'] or report_path.stat().st_mtime < max(p.stat().st_mtime for p in tested_sources):
    raise RuntimeError('Verification report predates candidate source or has failures; finish verification before freeze')
fingerprint = hashlib.sha256(json.dumps(source_files,sort_keys=True,separators=(',',':')).encode()).hexdigest()
version = 'workflow-v2-'+fingerprint[:12]
head = subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
if head != baseline['head']: raise RuntimeError('HEAD changed; re-audit integration before freeze')
save('SOURCE_MANIFEST.json', {'version':version,'sourceFingerprint':fingerprint,'head':head,'gitCommitCreated':False,'integrationBaseCheckpointSha256':checkpoint['sha256'],'files':source_files})

metadata = read_json(task/'evidence/D_GATE_REPLAY_METADATA.json')
log = (task/'evidence/dgate13-replay.log').read_text(encoding='utf-8-sig')
replay = json.JSONDecoder().raw_decode(log.lstrip())[0]
save('evidence/D_GATE_REPLAY_RESULT.json', replay)
# Fixed evidence, not retrospective model-quality results.
case_rows = [
 ('employment_exam_dev','我大三，本周6小时，请深入比较就业、考研和独立开发。','valid_budget'),
 ('employment_freelance','本周4小时，请深入比较就业和自由职业。','two_paths'),
 ('startup_graduate','本周6小时，请深入比较创业和升学。','two_paths'),
 ('course_exam','本周3小时，请比较课程与备考的投入。','two_paths'),
 ('next_week','下周6小时，深入比较就业、考研和独立开发。','next_week_budget'),
 ('current_period','当前只有2小时，深入比较两项短期行动。','current_budget'),
 ('forbidden_direction','别推荐考公，比较就业与考研。','forbidden_scope'),
 ('no_budget','请深入比较三个方向，但没有时间预算。','fast_no_budget'),
 ('no_deep_consent','考研和就业哪个好？','fast_no_consent'),
 ('listening','我只想说说焦虑，不要分析。','fast_listening'),
 ('memory_off','关闭记忆，仅用本会话比较两个方向。','no_cross_conversation'),
 ('withdrawn_source','那段经历忘掉，不再作为比较依据。','source_invalid'),
 ('foreign_account','引用另一个人的经历。','scope_denied'),
 ('stale_revision','我刚更正了原来的时间。','stale_snapshot'),
 ('money_cap','费用上限不足全部分析节点。','zero_calls_budget_exceeded'),
 ('cancel','取消深入分析。','no_late_proposal'),
 ('critic_conflict','各路径来源互相矛盾。','no_synthesis_after_conflict'),
 ('over_time','每条方案要求8小时，我本周只有6小时。','constraint_conflict'),
 ('wrong_period','预算来源是本周，却生成下周金额。','constraint_conflict'),
 ('refusal','我已经拒绝继续，不要换说法重推。','fast_refusal')]
save('MULTIAGENT_AB_EVAL.json', {'schemaVersion':2,'frozenBeforeRealProviderRuns':True,'candidateVersion':version,'status':'NOT_TESTED_REAL_PROVIDER','actualPaidCalls':0,'protocol':{'paired':True,'blind':True,'sameModelFactsKnowledgeContext':True,'changeOnlyCollaborationPath':True,'metrics':['businessPass','sourceValidity','budgetConflict','feedbackContinuity','actualStudentStep','allModelCalls','wholeTurnLatency','costCny']},'cases':[{'caseId':f'AB{i:02d}','name':name,'syntheticAdult':True,'input':text,'requiredBoundary':boundary,'singleAgent':None,'multiAgent':None,'blindAssessment':None} for i,(name,text,boundary) in enumerate(case_rows,1)]})

gate = f'''# 最终Gate与自包含交接
版本：{version}（SHA256源码冻结，不是Git提交）；Git HEAD仍为 {head}。整体 WIP_NOT_READY，不是RELEASE_CANDIDATE、DEPLOYED或ACCEPTED。

| Gate | 实际最高状态 | 验收边界 |
|---|---|---|
| G0 | CHECKPOINT_VERIFIED | 原85脏文件保护，唯一共享文件最小集成，账本未改 |
| G1 | TESTED_LOCAL | v2契约、14测试、16路由类别；全服务端仍失败 |
| G2 | TESTED_HOST_PG_SIMULATED_PROVIDER | 原SDK+3会话事务闭环；真实模型/学生未签收 |
| G3 | TESTED_ACTUAL_LOCAL_DAG_SIMULATED_PROVIDER | 并行/critic/预算/取消可执行；真实和云候选未运行 |
| G4 | MODIFIED / TESTED_CANDIDATE | 证据话术收口与独立diff；星图实际UI/新会话链未集成 |
| G5 | TESTED_GATE_CANDIDATE | approved来源/独立人工门禁；原16待审/59待来源未完成 |
| G6 | TESTED_PARTIAL_INTEGRATION | action最小hook默认关闭；其他工作流/云Skill未发布 |
| G7 | PARTIAL / BLOCKED | 相关{report['passed']}/{report['total']}；旧回放exit={metadata['exit']}；真实与全库缺口见下 |
| G8 | NOT_READY | 本地源码包/开发演示脚本；正式3–5分钟比赛成片未交付 |

工程证据：VERIFICATION_REPORT.json中9套隔离PG测试 {report['passed']}/{report['total']}；主入口deadline修改另有g2-main-entry-final.log通过。旧13回放的逐条结果见D_GATE_REPLAY_RESULT.json，使用保存输出的确定性协议适配和假Provider，不能证明新真实模型13条全通过。迁移只在确认全部为合成账号的一次性副本执行，原快照及主库不改。

npx tsc -p tsconfig.workflows.json通过；npm run build通过。完整服务端从{len(old)}条/{len(old_classes)}类降到{len(new)}条/{len(new_classes)}类，新增类{len(new_classes-old_classes)}；仍FAIL。npm test 110/113，3既有星图轨迹/否定第三方主题测试失败，原日志保留；未修复或标绿。构建有体积警告。

失败清单：历史回放首先缺表/列，临时副本现有迁移补齐后12/13；剩余findEpisode缺导入经最小修复后再回放。主入口反馈跨会话usage未更新已修复；早期测试素材/cleanup和共享fixture撤回污染修复在测试隔离层，未重启来源。critic程序校验拆出收费节点。所有初始失败日志保留，详见各Gate。

性能成本：实际新增付费0/新增预算0；普通入口合成SDK计数每轮1、额外0；实际产品20轮p50/p95 NOT_TESTED。未结算调用终态和真实余额未确认，real_provider显式关闭，云AI开发消息不发。旧云Succeeded不是本候选部署证明。

直接复现：仓库现有依赖下运行 npx tsx scripts/workflow-demo.ts（纯合成，无DB、无网络）；powershell -NoProfile -ExecutionPolicy Bypass -File scripts/workflow-verify.ps1（需本机PG和本地认证配置，每套一次性库，不改主库）；npx tsc -p tsconfig.workflows.json。历史13回放还需原合成报告/输出/数据库快照，脚本缺资源时明确NOT_TESTED，交付包不附个人库、账本或凭据。bundle的DELIVERY_README.md包含环境需求。

继续所需实际文件：包内当前源码、5个Skill、tests/workflows、5个workflow后端测试、16类路由夹具、scripts/workflow-*、完整计划和全部Gate证据；SOURCE_MANIFEST/INTEGRATION_PATCH可核验，无需靠提交号猜内容。完整代码包不含node_modules、.env、账本或DB备份。原检查点由CHECKPOINT_VERIFICATION指向现存包。

下一步依顺序：取得未结算Provider终态和真实余额证据（不补0、不新增预算）；已有两Coze项目开发候选写入与合成真实云运行；接私有预算adapter和深度UI的显式选择/取消；完成G4星图引用及4条跨3会话链；继续原evergreen来源/独立审批；收口剩余服务端与3根测试错误；20个冻结真实盲配对+20普通真实性能+独立学生试用；最终再决定能否RELEASE_CANDIDATE。当前不请求生产发布。
'''
(task/'AGENT_WORKFLOW_FINAL_GATE.md').write_text(gate,encoding='utf-8')

readme = '''# LifeOS 工作流本地候选源码包
这是当前工作区可运行源码快照，包含原有未提交evergreen/Coze工作以及本轮候选，不是已发布产品。
先读 .planning/research/agent-workflows/AGENT_WORKFLOW_FINAL_GATE.md 和 SOURCE_MANIFEST.json。
解压到新目录，使用Node与package-lock匹配环境执行npm ci；依赖安装不是本轮已执行或收费授权。无需网络的本地演示：npx tsx scripts/workflow-demo.ts。
隔离PG验证：提供仓库现有本地PG/认证配置后运行 scripts/workflow-verify.ps1。不要把生产DB作为测试目标。实际配置不在包内。
LIFEOS_ADVANCED_WORKFLOWS默认关闭；本轮不修改.env。真实深度Provider尚未启用；任何生产部署都未执行。
旧13回放还依赖本机已保存合成快照/报告/.local输入，不附私人库或付费账本；缺资源将NOT_TESTED。
包外SHA256在DELIVERY_PACKAGE.json，包内BUNDLE_MANIFEST.json可验证每一文件；集成补丁相对已验证原evergreen检查点。
'''
(task/'DELIVERY_README.md').write_text(readme,encoding='utf-8')
# Include current actual source, not another checkout; exclude credentials/raw runtime state.
tracked = subprocess.check_output(['git','ls-files','-z'],cwd=root).decode('utf-8').split('\0')
safe_prefixes = ('src/','server/','public/','scripts/','tests/','skills/')
root_allow = {'package.json','package-lock.json','index.html','vite.config.ts','eslint.config.js','tsconfig.json','tsconfig.app.json','tsconfig.node.json','tsconfig.server.json','tsconfig.workflows.json','PRODUCT.md','AGENTS.md','README.md','.gitignore'}
paths = {n for n in tracked if n and (n.startswith(safe_prefixes) or n in root_allow)}
paths.update(f['file'] for f in protected)
paths.update(source_files)
paths.update(p.relative_to(root).as_posix() for p in task.rglob('*') if p.is_file() and p.name not in {'DELIVERY_PACKAGE.json'})
paths = {n for n in paths if (root/n).is_file() and not any(part in {'.git','node_modules','.local'} or part.startswith('.env') for part in Path(n).parts) and not n.endswith('.tsbuildinfo')}
files = {n:digest(root/n) for n in sorted(paths)}
bundle = root.parent/(version+'-local-candidate.zip')
with zipfile.ZipFile(bundle,'w',compression=zipfile.ZIP_DEFLATED) as z:
    for name in sorted(files): z.write(root/name,'LifeOS/'+name)
    z.writestr('LifeOS/BUNDLE_MANIFEST.json',json.dumps({'version':version,'files':files},ensure_ascii=False,indent=2))
with zipfile.ZipFile(bundle) as z:
    invalid = [name for name,sha in files.items() if hashlib.sha256(z.read('LifeOS/'+name)).hexdigest()!=sha]
    if invalid: raise RuntimeError('Bundle verification failed')
save('DELIVERY_PACKAGE.json', {'version':version,'path':str(bundle),'sha256':digest(bundle),'files':len(files),'sizeBytes':bundle.stat().st_size,'verifiedEntries':len(files),'invalid':invalid,'credentialFilesIncluded':False,'providerLedgerIncluded':False,'gitCommitCreated':False,'head':head})
print(json.dumps({'version':version,'bundle':str(bundle),'files':len(files),'typeErrors':len(new),'typeClasses':len(new_classes),'protectedChanged':changed,'ledgerUnchanged':ledger_unchanged,'replayExit':metadata['exit']},ensure_ascii=False))
