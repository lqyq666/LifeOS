"""Bind selected actions to actually validated direction assessments once."""
import copy
import hashlib
import importlib
import json
from pathlib import Path
from lifeos_host.http_route import provider_http as original

target = Path('src/lifeos_host/http_route/provider_http.py')
before = target.read_bytes()
assert hashlib.sha256(before).hexdigest() == 'fed51d3e097416f48e9b91bc0b90a04f0958a49050303a0f7e11a79a447397fc'
nodes = [json.loads(x) for x in Path('/tmp/assessment_ui_first_nodes.jsonl').read_text().splitlines()]
failed = next(n for n in nodes if n.get('text'))
wire = json.loads(Path('/tmp/assessment_ui_first_wire.json').read_text())
import base64
flat = json.loads(base64.b64decode(wire['payloadB64']))
facts = original._facts(flat['evidenceRecords'])
obj = json.loads(failed['text'])
assert any(e not in {a['evidenceId'] for a in obj['assessments']} for b in obj['actionBasis'] for e in b['evidenceIds'])
try: original._parse_analyst(failed['text'], facts, failed['context'])
except original.WorkflowError: pass
else: raise AssertionError('captured unassessed action source did not fail')

source = before.decode()
dynamic = '        props["actionBasis"] = {"type":"array","items":{"type":"object","additionalProperties":False,"required":["actionId","evidenceIds"],"properties":{"actionId":{"type":"string","enum":action_ids},"evidenceIds":{"type":"array","minItems":1,"items":{"type":"string","enum":list(facts)}}}}}\n'
assert source.count(dynamic) == 1
source = source.replace(dynamic, '')
anchor = '_CRITIC_SCHEMA = '
assert source.count(anchor) == 1
source = source.replace(anchor, '# Action provenance is projected from validated direction assessments,\n# rather than a second generated source list that can disagree with them.\n_ANALYST_SCHEMA["required"].remove("actionBasis")\ndel _ANALYST_SCHEMA["properties"]["actionBasis"]\n\n'+anchor)
old = 'set(obj)!={"actionIds","tradeoffIds","actionBasis","stageReasonId","stopCondition","weeklyMinutes","assessments","decisionReason"}'
assert source.count(old) == 1
source = source.replace(old, 'set(obj)!={"actionIds","tradeoffIds","stageReasonId","stopCondition","weeklyMinutes","assessments","decisionReason"}')
old = '    basis = obj["actionBasis"]'
assert source.count(old) == 1
source = source.replace(old, '    # These are candidate actions selected by the model for this direction.\n    # Their source refs are the direction assessments already validated above;\n    # no unassessed source or new personal fact is silently added.\n    basis = [{"actionId":action, "evidenceIds":list(ev)} for action in acts]')
old = 'actionBasis 只使用 assessments 中实际分析过的来源。'
assert source.count(old) == 1
source = source.replace(old, '只选择本方向的 actionIds；程序将候选行动绑定到本方向已校验的 assessments，不重复输出 actionBasis；该关联是宿主来源投影，不是新增个人事实或已执行行动。')
compile(source, str(target), 'exec')
Path('/tmp/provider_before_action_basis_projection_20261014.py').write_bytes(before)
target.write_bytes(source.encode())
try:
    p = importlib.reload(original)
    fixed = copy.deepcopy(obj)
    fixed.pop('actionBasis')
    parsed = p._parse_analyst(json.dumps(fixed), facts, failed['context'])
    assert parsed['actionIds'] == obj['actionIds']
    assert parsed['assessments'] == obj['assessments']
    assert parsed['decisionReason'] == obj['decisionReason']
    assert parsed['actionBasis'] == {a:list(parsed['evidenceIds']) for a in parsed['actionIds']}
    for kind in ('invalid_source','invented_quote','unknown_action','injected_action_basis'):
        bad = copy.deepcopy(fixed)
        if kind == 'invalid_source': bad['assessments'][0]['evidenceId'] = 'foreign'
        if kind == 'invented_quote': bad['assessments'][0]['quote'] = 'invented'
        if kind == 'unknown_action': bad['actionIds'] = ['foreign-action']
        if kind == 'injected_action_basis': bad['actionBasis'] = obj['actionBasis']
        try: p._parse_analyst(json.dumps(bad), facts, failed['context'])
        except p.WorkflowError: pass
        else: raise AssertionError(kind+' accepted')
    assert 'actionBasis' not in p._ANALYST_SCHEMA['properties']
    report = {'status':'PASS_OFFLINE_SAVED_ACTUAL_FAILURE', 'providerCalls':0, 'actualFailureReplayed':True, 'selectedActionsAndPersonalJudgmentsUnchanged':True, 'allActionSourcesActuallyAssessed':True, 'invalidCasesRejected':4, 'projectionKind':'host_validated_direction_assessments_not_new_model_claim', 'providerHash':hashlib.sha256(target.read_bytes()).hexdigest()}
    Path('/tmp/action_basis_projection_offline_eval_20261014.json').write_text(json.dumps(report))
    print(json.dumps(report))
except BaseException:
    target.write_bytes(before)
    raise
