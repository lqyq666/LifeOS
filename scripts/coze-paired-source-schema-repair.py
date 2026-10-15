"""Bind analyzer quote choices to their actual source; no calls or deployment."""
import ast
import copy
import hashlib
import json
from pathlib import Path
from lifeos_host.http_route import provider_http as provider

target = Path('src/lifeos_host/http_route/provider_http.py')
before = target.read_bytes()
before_hash = hashlib.sha256(before).hexdigest()
assert before_hash in ('efa91af8587e1c72f606906a2d6bf5356a5e29a4c9a368c6d4a4c77e65561600', 'fc7383b05aeec0b72b8eb774f3fbcb2288e4fc0c502d8d371aed159d3a3cbd53')
source = before.decode()
partial = '        # A globally valid quote can still belong to another source. Constrain\n        # the pair before generation; the strict parser remains authoritative.\n        props["assessments"]["items"]["anyOf"] = [\n            {"properties": {"evidenceId": {"const": fid}, "quote": {"enum": [q for q in quote_choices if q in fact["text"]]}}}\n            for fid, fact in facts.items()\n        ]\n'
if before_hash == 'fc7383b05aeec0b72b8eb774f3fbcb2288e4fc0c502d8d371aed159d3a3cbd53':
    assert source.count(partial) == 1
    source = source.replace(partial, '')
baseline = source
anchor = '        props["assessments"]["items"]["properties"]["quote"]["enum"] = quote_choices\n'
assert source.count(anchor) == 1
source = source.replace(anchor, anchor + '        # Keep complete branches: the provider may ignore shared properties\n        # when decoding a partial anyOf. The strict parser remains unchanged.\n        assessment = props["assessments"]["items"]\n        paired = []\n        for fid, fact in facts.items():\n            branch = json.loads(json.dumps(assessment))\n            branch["properties"]["evidenceId"] = {"type": "string", "const": fid}\n            branch["properties"]["quote"]["enum"] = [q for q in quote_choices if q in fact["text"]]\n            paired.append(branch)\n        assessment["anyOf"] = paired\n')
compile(source, str(target), 'exec')

def context_from(code, minutes):
    tree = ast.parse(code)
    outer = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'run_direction_decision')
    inner = next(n for n in outer.body if isinstance(n, ast.FunctionDef) and n.name == 'analyzer_context')
    records = [
        {'ref': {'type': 'message', 'id': 'synthetic-contact', 'revision': 1}, 'text': 'I sent the campus email.', 'owner': 'synthetic-adult', 'status': 'active'},
        {'ref': {'type': 'message', 'id': 'synthetic-budget', 'revision': 1}, 'text': 'This week has zero available minutes.', 'owner': 'synthetic-adult', 'status': 'active'},
    ]
    facts = provider._facts(records)
    flat = {'budget': {'amountMinutes': minutes}, 'currentIntent': 'Compare unknowns only.', 'canonicalMethods': []}
    env = {**provider.__dict__, 'flat': flat, 'facts': facts, 'skill_text': {}}
    exec(compile(ast.Module(body=[copy.deepcopy(inner)], type_ignores=[]), '<actual-analyzer-context>', 'exec'), env)
    return env['analyzer_context']({'id': 'employment', 'title': 'Employment'}), facts

for minutes in (0, 30, None):
    old, facts = context_from(baseline, minutes)
    ctx, _ = context_from(source, minutes)
    schema = ctx['schema']['properties']['assessments']['items']
    ids = list(facts)
    assessment = {'evidenceId': ids[0], 'quote': facts[ids[0]]['text'], 'relation': 'limit', 'reason': 'Only reported contact is known.', 'nextCheck': 'Response remains unknown.', 'changeCondition': 'A response is reported.'}
    matches = lambda a: any(b['properties']['evidenceId']['const'] == a['evidenceId'] and a['quote'] in b['properties']['quote']['enum'] for b in schema['anyOf'])
    assert matches(assessment)
    mismatched = {**assessment, 'quote': facts[ids[1]]['text']}
    old_props = old['schema']['properties']['assessments']['items']['properties']
    assert mismatched['evidenceId'] in old_props['evidenceId']['enum'] and mismatched['quote'] in old_props['quote']['enum']
    assert not matches(mismatched)
    invalid = {**assessment, 'quote': 'An invented claim.'}
    assert not matches(invalid)
    if minutes == 0:
        assert ctx['actionCatalogue'] == []
        assert ctx['schema']['properties']['actionIds']['maxItems'] == 0
        obj = {'actionIds': [], 'tradeoffIds': [], 'stageReasonId': '', 'stopCondition': next(iter(ctx['stopReasons'].values())), 'weeklyMinutes': 0, 'assessments': [assessment], 'decisionReason': 'No new action is proposed while available time is zero.'}
        provider._parse_analyst(json.dumps(obj), facts, ctx)
        for bad in (mismatched, invalid, {**assessment, 'evidenceId': 'foreign-source'}):
            try:
                provider._parse_analyst(json.dumps({**obj, 'assessments': [bad]}), facts, ctx)
            except provider.WorkflowError:
                pass
            else:
                raise AssertionError('strict source validation was bypassed')
    unchanged = copy.deepcopy(ctx)
    del unchanged['schema']['properties']['assessments']['items']['anyOf']
    assert unchanged == old, 'only the source/quote pair constraint may change'

target.write_bytes(source.encode())
print(json.dumps({'status': 'PASS_OFFLINE_PAIRED_SOURCE_SCHEMA', 'originalFailure': '_parse_analyst:675', 'providerCalls': 0, 'strictParserUnchanged': True, 'budgetsChecked': [0, 30, None], 'sourceHash': hashlib.sha256(target.read_bytes()).hexdigest(), 'deployed': False, 'syntheticAssessmentSchema': schema}))
