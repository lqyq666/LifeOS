"""Candidate instruction delta driven by preserved actual cloud failures.

Offline replay checks format/source gates; semantic promotion still requires
the new version's actual reviewed proposal. No paid requests in this script.
"""
import ast
import base64
import hashlib
import json
from pathlib import Path

target = Path("src/lifeos_host/http_route/provider_http.py")
before = target.read_bytes()
assert hashlib.sha256(before).hexdigest() == "eaecde0f313e8e485af9c450d52aceee2fbb3e19a198e6ec7355ca6b53ecbc22"
old = 'ctx["analysisRules"] = "最多3条简洁关系，'
new = 'ctx["analysisRules"] = "decisionReason 用40至80字说明当前取舍，绝不超过160字；不复述内部ID、代码字段或整段行动目录。support 表示本人事实支持投入本方向，不表示支持暂停本方向；未开始、时间不足或优先其他方向应归入 limit 或 unknown，不能当成本方向的优点。愿望最多支持探索意愿，不代表已有实践或能力。最多3条简洁关系，'
source = before.decode()
assert source.count(old) == 1
changed = source.replace(old, new)
compile(changed, str(target), "exec")
# The existing parsers, source gates, other workflows and output schema stay exact.
trees = [ast.parse(x) for x in (source, changed)]
for name in ("_parse_analyst", "_parse_critic", "_build_proposal", "run_other_mode"):
    nodes = [next(n for n in t.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name) for t in trees]
    assert ast.dump(nodes[0]) == ast.dump(nodes[1])
with Path("assets/provider_before_analyst_contract_20261014.py").open("xb") as f:
    f.write(before)
target.write_bytes(changed.encode())
try:
    from lifeos_host.http_route import provider_http as p
    wire = json.loads(Path("assets/bounded_direction_three_first_wire.json").read_text())
    payload = json.loads(base64.b64decode(wire["payloadB64"]))
    facts = p._facts(payload["evidenceRecords"])
    rows = [json.loads(x) for x in Path("assets/bounded_direction_three_first_nodes.jsonl").read_text().splitlines()]
    successful = next(x for x in rows if x["context"]["direction"]["id"] == "entrepreneurship")
    failed = next(x for x in rows if x["context"]["direction"]["id"] == "postgraduate_exam")
    p._parse_analyst(successful["text"], facts, successful["context"])

    def rejected(text, ctx):
        try:
            p._parse_analyst(text, facts, ctx)
        except p.WorkflowError:
            return
        raise AssertionError("invalid result accepted")

    rejected(failed["text"], failed["context"])
    valid = json.loads(successful["text"])
    valid["decisionReason"] = "核" * 160
    p._parse_analyst(json.dumps(valid), facts, successful["context"])
    valid["decisionReason"] += "核"
    rejected(json.dumps(valid), successful["context"])
    invalid_source = json.loads(successful["text"])
    invalid_source["assessments"][0]["quote"] = "从未提供的本人已成功创业事实"
    rejected(json.dumps(invalid_source), successful["context"])
    report = {"status": "TEST_MORE", "actualSuccessfulOutputReused": True,
              "actual198CharacterFailureStillRejected": True,
              "length160Pass161Reject": True, "inventedSourceStillRejected": True,
              "parsersAndOtherModesUnchanged": True, "realProviderCalls": 0,
              "semanticAcceptance": "PENDING_NEW_VERSION_REAL_REVIEW",
              "sourceHash": hashlib.sha256(target.read_bytes()).hexdigest()}
    Path("assets/analyst_contract_offline_eval_20261014.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report))
except BaseException:
    target.write_bytes(before)
    raise
