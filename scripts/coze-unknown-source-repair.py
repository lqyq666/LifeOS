"""Derive unknown source IDs from validated assessments, not duplicate generation."""
import base64
import copy
import hashlib
import json
from pathlib import Path

target = Path("src/lifeos_host/http_route/provider_http.py")
before = target.read_bytes()
assert hashlib.sha256(before).hexdigest() == "8e72647c36c90aada91f2d72b3f6866cf0ef450065e2691dbd92130f24cd24f7"
source = before.decode()
replacements = {
    'for field in ("evidenceIds", "unknownIds"):': 'for field in ("evidenceIds",):',
    '"required": ["evidenceIds", "unknownIds", "tradeoffIds", "actionIds",': '"required": ["evidenceIds", "tradeoffIds", "actionIds",',
    '        "unknownIds": {"type": "array", "items": {"type": "string"}},\n': '',
    'set(obj)!={"evidenceIds","unknownIds","actionIds","tradeoffIds","actionBasis","stageReasonId","stopCondition","weeklyMinutes","assessments","decisionReason"}': 'set(obj)!={"evidenceIds","actionIds","tradeoffIds","actionBasis","stageReasonId","stopCondition","weeklyMinutes","assessments","decisionReason"}',
    'for field in ("evidenceIds","unknownIds","actionIds","tradeoffIds"):': 'for field in ("evidenceIds","actionIds","tradeoffIds"):',
    '    unknown_ids = obj.get("unknownIds") or []': '''    # This is a projection, not a new model judgment. Full assessment shape,
    # authorized source IDs, verbatim quotes and relations are validated below.
    raw_assessments = obj.get("assessments")
    unknown_ids = list(dict.fromkeys(
        item["evidenceId"] for item in raw_assessments
        if isinstance(item, dict) and item.get("relation") == "unknown"
        and isinstance(item.get("evidenceId"), str)
    )) if isinstance(raw_assessments, list) else []''',
    'assessments 必须覆盖 evidenceIds 和 unknownIds；unknownIds 恰好列出 unknown 关系来源。': 'assessments 必须覆盖 evidenceIds；未知直接在对应 assessment 标为 unknown，程序据此汇总未知来源，不重复输出 unknownIds。',
}
for old, new in replacements.items():
    assert source.count(old) == 1, old
    source = source.replace(old, new)
compile(source, str(target), "exec")
with Path("assets/provider_before_unknown_projection_20261014.py").open("xb") as f:
    f.write(before)
target.write_bytes(source.encode())
try:
    from lifeos_host.http_route import provider_http as p

    def sample(prefix, direction):
        w = json.loads(Path(f"assets/{prefix}_direction_three_first_wire.json").read_text())
        payload = json.loads(base64.b64decode(w["payloadB64"]))
        rows = [json.loads(x) for x in Path(f"assets/{prefix}_direction_three_first_nodes.jsonl").read_text().splitlines()]
        row = next(x for x in rows if x["context"]["direction"]["id"] == direction)
        obj = json.loads(row["text"])
        obj.pop("unknownIds")
        return obj, p._facts(payload["evidenceRecords"]), row["context"]

    good, good_facts, good_ctx = sample("bounded", "entrepreneurship")
    previous = p._parse_analyst(json.dumps(good), good_facts, good_ctx)
    actual, facts, ctx = sample("analyst", "postgraduate_exam")
    parsed = p._parse_analyst(json.dumps(actual), facts, ctx)
    expected = list(dict.fromkeys(a["evidenceId"] for a in actual["assessments"] if a["relation"] == "unknown"))
    assert parsed["unknownIds"] == expected and len(expected) == 1
    assert parsed["assessments"] == actual["assessments"]
    assert previous["unknownIds"] == list(dict.fromkeys(a["evidenceId"] for a in good["assessments"] if a["relation"] == "unknown"))

    def rejected(obj):
        try:
            p._parse_analyst(json.dumps(obj), facts, ctx)
        except p.WorkflowError:
            return
        raise AssertionError("invalid source accepted")

    for mutation in ("quote", "source", "relation", "empty", "duplicate", "legacy", "length"):
        bad = copy.deepcopy(actual)
        if mutation == "quote": bad["assessments"][0]["quote"] = "未提供的本人成功创业"
        if mutation == "source": bad["assessments"][0]["evidenceId"] = "message:someone-else#1"
        if mutation == "relation": bad["assessments"][0]["relation"] = "proven"
        if mutation == "empty": bad["assessments"] = []
        if mutation == "duplicate": bad["assessments"].append(copy.deepcopy(bad["assessments"][0]))
        if mutation == "legacy": bad["unknownIds"] = []
        if mutation == "length": bad["decisionReason"] = "核" * 161
        rejected(bad)
    no_unknown = copy.deepcopy(actual)
    for assessment in no_unknown["assessments"]:
        if assessment["relation"] == "unknown": assessment["relation"] = "limit"
    assert p._parse_analyst(json.dumps(no_unknown), facts, ctx)["unknownIds"] == []
    report = {"status": "PASS_OFFLINE_CONTRACT", "realFailureReplayed": True,
              "successfulOutputPreserved": True, "unknownProjectionExact": True,
              "sevenInvalidVariantsRejected": True, "emptyUnknownsPreserved": True,
              "providerCalls": 0, "semanticAcceptance": "PENDING_NEW_VERSION_REAL_REVIEW",
              "sourceHash": hashlib.sha256(target.read_bytes()).hexdigest()}
    Path("assets/unknown_projection_offline_eval_20261014.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report))
except BaseException:
    target.write_bytes(before)
    raise
