"""Constrain the existing direction schema to its actual zero-time contract.

Run inside the original Coze development checkout. No model calls or deploys.
The strict parser remains unchanged; old source is restored on verification failure.
"""
import ast
import copy
import hashlib
import json
from pathlib import Path
from lifeos_host.http_route import provider_http as provider

target = Path('src/lifeos_host/http_route/provider_http.py')
before = target.read_bytes()
assert hashlib.sha256(before).hexdigest() == '0da022a32bb2b4b04e742020118e844fd73567a165bf7b0fcc3ac6856f49fe1f'
source = before.decode()

def context_from(code, minutes):
    tree = ast.parse(code)
    outer = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'run_direction_decision')
    inner = next(n for n in outer.body if isinstance(n, ast.FunctionDef) and n.name == 'analyzer_context')
    record = {'ref': {'type': 'message', 'id': 'synthetic-source', 'revision': 1}, 'text': '本周没有可投入时间', 'owner': 'synthetic-adult', 'status': 'active'}
    facts = provider._facts([record])
    flat = {'budget': {'amountMinutes': minutes}, 'currentIntent': '只比较未知，不安排新行动', 'canonicalMethods': []}
    env = {**provider.__dict__, 'flat': flat, 'facts': facts, 'skill_text': {}}
    exec(compile(ast.Module(body=[copy.deepcopy(inner)], type_ignores=[]), '<actual-analyzer-context>', 'exec'), env)
    return env['analyzer_context']({'id': 'employment', 'title': '就业'}), facts

old, facts = context_from(source, 0)
assert old['actionCatalogue'] and old['schema']['properties']['actionIds'].get('maxItems') != 0
anchor = '        props["actionIds"]["items"] = {"type": "string", "enum": action_ids}\n'
assert source.count(anchor) == 1
source = source.replace(anchor, anchor + '''        if _structured_budget == 0:
            # Zero time forbids actions, including untimed methods; avoid empty enum.
            ctx["actionCatalogue"] = []
            props["actionIds"] = {"type": "array", "items": {"type": "string"}, "maxItems": 0}
            ctx["analysisRules"] += " Current time budget is zero: actionIds must be []; compare directions and unknowns only."
''')
assert 'if not synthesis_schema["properties"]["actionIds"]["items"]["enum"]:' in source
compile(source, str(target), 'exec')
zero, facts = context_from(source, 0)
assert zero['actionCatalogue'] == []
assert zero['schema']['properties']['actionIds'] == {'type':'array','items':{'type':'string'},'maxItems':0}
for minutes in (30, None):
    old_ctx, _ = context_from(before.decode(), minutes)
    new_ctx, _ = context_from(source, minutes)
    assert old_ctx == new_ctx, 'nonzero and unknown behavior must remain unchanged'
eid = next(iter(facts))
obj = {'actionIds': [], 'tradeoffIds': [], 'stageReasonId': '', 'stopCondition': next(iter(zero['stopReasons'].values())), 'weeklyMinutes': 0, 'assessments': [{'evidenceId':eid,'quote':facts[eid]['text'],'relation':'limit','reason':'本周暂停投入','nextCheck':'下周可用时间','changeCondition':'有可用时间后再评估'}], 'decisionReason':'当前只保留方向比较，本周没有投入时间，不新增行动。'}
provider._parse_analyst(json.dumps(obj), facts, zero)
for bad in ('positive_action', 'invented_source', 'invented_quote'):
    invalid = copy.deepcopy(obj)
    if bad == 'positive_action': invalid['actionIds'] = [old['actionCatalogue'][0]['id']]
    if bad == 'invented_source': invalid['assessments'][0]['evidenceId'] = 'foreign-source'
    if bad == 'invented_quote': invalid['assessments'][0]['quote'] = '尚有九十分钟'
    try:
        provider._parse_analyst(json.dumps(invalid), facts, zero)
    except provider.WorkflowError:
        pass
    else:
        raise AssertionError(bad + ' accepted')
Path('/tmp/provider-before-zero-time-schema.py').write_bytes(before)
target.write_bytes(source.encode())
report = {'status':'PASS_OFFLINE_ZERO_TIME_SCHEMA','providerCalls':0,'actualFailureGate':'_parse_analyst:726','oldSchemaAllowedPositiveActions':True,'zeroTimeHasNoSelectableActions':True,'nonzeroAndUnknownUnchanged':True,'strictInvalidCasesRejected':3,'sourceHash':hashlib.sha256(target.read_bytes()).hexdigest(),'deployed':False}
Path('/tmp/zero-time-schema-check.json').write_text(json.dumps(report))
print(json.dumps(report))
