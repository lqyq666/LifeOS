"""Keep one validated source selection and expose non-private gate diagnostics."""
import ast
import base64
import copy
import hashlib
import importlib
import json
from pathlib import Path

target = Path('src/lifeos_host/http_route/provider_http.py')
entry = Path('src/lifeos_host/http_route/entry.py')
before, entry_before = target.read_bytes(), entry.read_bytes()
assert hashlib.sha256(before).hexdigest() == 'f89eb3bda3b73a5a73bbec4599a8e1d601bd93217586e8db8e97b6d67e8e029e'
assert hashlib.sha256(entry_before).hexdigest() == '45517f419a0bd8ec8175bc12cf7cf19ae40939c297015a6433fc43ca60fbeda2'
from lifeos_host.http_route import provider_http as original
wire = json.loads(Path('assets/verbatim_direction_three_first_wire.json').read_text())
flat = json.loads(base64.b64decode(wire['payloadB64']))
facts = original._facts(flat['evidenceRecords'])
nodes = [json.loads(x) for x in Path('assets/verbatim_direction_three_first_nodes.jsonl').read_text().splitlines()]
row = next(n for n in nodes if n['schema'] == 'analyst_schema')
baseline = original._parse_analyst(row['text'], facts, row['context'])
baselines = {n['context']['direction']['id']: original._parse_analyst(n['text'], facts, n['context']) for n in nodes if n['schema'] == 'analyst_schema'}
extra = copy.deepcopy(facts)
for n in range(2):
    extra['extra-'+str(n)] = {**next(iter(facts.values())), 'id':'extra-'+str(n)}
legal_but_uncovered = json.loads(row['text'])
legal_but_uncovered['evidenceIds'] = list(extra)
assert 'maxItems' not in row['context']['schema']['properties']['evidenceIds']
try:
    original._parse_analyst(json.dumps(legal_but_uncovered), extra, row['context'])
except original.WorkflowError:
    pass
else:
    raise AssertionError('old redundant source selection unexpectedly accepted')

source = before.decode()
changes = {
    'import logging\n':'import logging\nimport traceback\n',
    '                 cancelled=False, reviewed_fields=None) -> None:':'                 cancelled=False, reviewed_fields=None, reason=None) -> None:',
    '        self.reviewed_fields = reviewed_fields\n':'        self.reviewed_fields = reviewed_fields\n        self.reason = reason\n',
    '        for field in ("evidenceIds",):\n            props[field]["items"] = {"type": "string", "enum": list(facts)}\n        props["evidenceIds"]["minItems"] = 1\n':'',
    '"required": ["evidenceIds", "tradeoffIds", "actionIds",':'"required": ["tradeoffIds", "actionIds",',
    '        "evidenceIds": {"type": "array", "items": {"type": "string"}},\n':'',
    'set(obj)!={"evidenceIds","actionIds","tradeoffIds","actionBasis","stageReasonId","stopCondition","weeklyMinutes","assessments","decisionReason"}':'set(obj)!={"actionIds","tradeoffIds","actionBasis","stageReasonId","stopCondition","weeklyMinutes","assessments","decisionReason"}',
    'for field in ("evidenceIds","actionIds","tradeoffIds"):':'for field in ("actionIds","tradeoffIds"):',
    '    ev = obj.get("evidenceIds") or []':'    # Source selection has one authority: the fully validated assessments.\n    raw = obj.get("assessments")\n    ev = list(dict.fromkeys(a["evidenceId"] for a in raw if isinstance(a, dict) and isinstance(a.get("evidenceId"), str))) if isinstance(raw, list) else []',
    'assessments 必须覆盖 evidenceIds；未知直接在对应 assessment 标为 unknown，程序据此汇总未知来源，不重复输出 unknownIds。':'每条 assessment 必须对照原始来源，不使用不相关的事实；程序从通过校验的 assessments 汇总 evidenceIds 和 unknownIds，不重复输出这两个选择字段。actionBasis 只使用 assessments 中实际分析过的来源。',
}
for old, new in changes.items():
    assert source.count(old) == 1, old
    source = source.replace(old, new)
catch = '        return HttpDirectionResult(failure=we.code, cancelled=we.code == "cancelled")'
assert source.count(catch) == 3
# Only the analyzer group path: metadata is a public function name and line,
# never exception text, provider output, a source quote, or credentials.
source = source.replace(catch, '        frames = traceback.extract_tb(we.__traceback__)\n        gate = frames[-1] if frames else None\n        reason = "provider_validation:" + gate.name + ":" + str(gate.lineno) if gate else None\n        return HttpDirectionResult(failure=we.code, cancelled=we.code == "cancelled", reason=reason)', 1)
entry_source = entry_before.decode()
anchor = '        base["failure"] = result.failure\n'
assert entry_source.count(anchor) == 1
entry_source = entry_source.replace(anchor, anchor+'        if result.failure and getattr(result, "reason", None):\n            base["reason"] = result.reason\n')
compile(source, str(target), 'exec')
compile(entry_source, str(entry), 'exec')
Path('/tmp/provider_before_assessment_selection_20261014.py').write_bytes(before)
Path('/tmp/entry_before_assessment_selection_20261014.py').write_bytes(entry_before)
target.write_bytes(source.encode())
entry.write_bytes(entry_source.encode())
try:
    p = importlib.reload(original)
    checked = []
    for n in nodes:
        if n['schema'] != 'analyst_schema':
            continue
        obj = json.loads(n['text'])
        obj.pop('evidenceIds')
        parsed = p._parse_analyst(json.dumps(obj), facts, n['context'])
        assert parsed == baselines[n['context']['direction']['id']]
        assert set(parsed['evidenceIds']) == {a['evidenceId'] for a in parsed['assessments']}
        checked.append(obj)
    modified = copy.deepcopy(checked[0])
    result = p._parse_analyst(json.dumps(modified), extra, row['context'])
    assert result == baseline
    for corrupt in ('unowned_source', 'invented_quote', 'unknown_relation', 'unassessed_action_source'):
        bad = copy.deepcopy(modified)
        if corrupt == 'unowned_source': bad['assessments'][0]['evidenceId'] = 'foreign-source'
        if corrupt == 'invented_quote': bad['assessments'][0]['quote'] = 'Fabricated source'
        if corrupt == 'unknown_relation': bad['assessments'][0]['relation'] = 'confirmed'
        if corrupt == 'unassessed_action_source': bad['actionBasis'][0]['evidenceIds'] = ['extra-0']
        try: p._parse_analyst(json.dumps(bad), extra, row['context'])
        except p.WorkflowError: pass
        else: raise AssertionError(corrupt+' accepted')
    tree = ast.parse(source)
    outer = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'run_direction_decision')
    helper = next(n for n in outer.body if isinstance(n, ast.FunctionDef) and n.name == 'analyzer_context')
    namespace = dict(vars(p), flat=flat, facts=extra, skill_text={'analyzer':Path('assets/skills/lifeos-direction-analysis.md').read_text()})
    exec(compile(ast.Module(body=[helper], type_ignores=[]), 'actual-analyzer-context', 'exec'), namespace)
    ctx = namespace['analyzer_context'](flat['directions'][0])
    assert 'evidenceIds' not in ctx['schema']['properties']
    assert ctx['schema']['properties']['assessments']['maxItems'] == 3
    report = {'status':'PASS_OFFLINE_CONTRACT', 'providerCalls':0, 'actualSuccessfulAnalyzersReused':len(checked), 'oldSchemaRedundantSelectionReproduced':True, 'derivedSourceSelectionSameAsBaseline':True, 'invalidSourceCasesRejected':4, 'priorPublicFailureExactCause':'not proven; next actual receipt exposes public gate location', 'providerHash':hashlib.sha256(target.read_bytes()).hexdigest(), 'entryHash':hashlib.sha256(entry.read_bytes()).hexdigest()}
    Path('/tmp/assessment_selection_offline_eval_20261014.json').write_text(json.dumps(report))
    print(json.dumps(report))
except BaseException:
    target.write_bytes(before)
    entry.write_bytes(entry_before)
    raise
