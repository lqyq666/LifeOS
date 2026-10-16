"""Constrain generated citations to bounded verbatim source fragments."""
import ast
import base64
import hashlib
import json
from pathlib import Path

target = Path("src/lifeos_host/http_route/provider_http.py")
before = target.read_bytes()
assert hashlib.sha256(before).hexdigest() == "a7a53033ca620e5c391632f1a00a70da7e5fcaf39e99f9270ade8076452d7dfe"
source = before.decode()
anchor = '        props["assessments"]["items"]["properties"]["evidenceId"]["enum"] = list(facts)'
addition = '''
        # A citation is selected from source bytes, never composed by the model.
        # Longer statements are split without normalization, ellipsis or paraphrase.
        quote_choices = []
        for fact in facts.values():
            original = fact["text"]
            segments = [original] if len(original) <= 60 else re.findall(r"[^，。；！？\\n]+[，。；！？]?", original)
            for segment in segments:
                for start in range(0, len(segment), 60):
                    quote = segment[start:start + 60].strip()
                    if quote and quote not in quote_choices:
                        quote_choices.append(quote)
        props["assessments"]["items"]["properties"]["quote"]["enum"] = quote_choices'''
assert source.count(anchor) == 1
source = source.replace(anchor, anchor + addition)
old = 'quote 必须是该来源的短原文，不整段复述。'
new = 'quote 必须从 schema 的原文片段枚举中逐字选择，并匹配 evidenceId；不转述，不拼接，不加省略号。'
assert source.count(old) == 1
source = source.replace(old, new)
compile(source, str(target), "exec")
with Path("assets/provider_before_verbatim_20261014.py").open("xb") as f:
    f.write(before)
target.write_bytes(source.encode())
try:
    from lifeos_host.http_route import provider_http as p, transport_http as t
    w = json.loads(Path("assets/projection_direction_three_first_wire.json").read_text())
    flat = json.loads(base64.b64decode(w["payloadB64"]))
    facts = p._facts(flat["evidenceRecords"])
    tree = ast.parse(source)
    outer = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == "run_direction_decision")
    helper = next(n for n in outer.body if isinstance(n, ast.FunctionDef) and n.name == "analyzer_context")
    namespace = dict(vars(p), flat=flat, facts=facts,
        skill_text={"analyzer": Path("assets/skills/lifeos-direction-analysis.md").read_text()})
    exec(compile(ast.Module(body=[helper], type_ignores=[]), "actual-analyzer-context", "exec"), namespace)
    sizes = []
    for direction in flat["directions"]:
        ctx = namespace["analyzer_context"](direction)
        choices = ctx["schema"]["properties"]["assessments"]["items"]["properties"]["quote"]["enum"]
        assert choices and all(0 < len(q) <= 60 and any(q in f["text"] for f in facts.values()) for q in choices)
        sizes.append(t.request_body_bytes(t.build_request_body(ctx["schema"], ctx)))
    rows = [json.loads(x) for x in Path("assets/projection_direction_three_first_nodes.jsonl").read_text().splitlines()]
    failed = next(x for x in rows if x["context"]["direction"]["id"] == "employment")
    invented = next(a["quote"] for a in json.loads(failed["text"])["assessments"] if "..." in a["quote"])
    assert invented not in choices
    try:
        p._parse_analyst(failed["text"], facts, failed["context"])
    except p.WorkflowError:
        pass
    else:
        raise AssertionError("ellipsized quote accepted")
    for row in rows:
        if row["context"]["direction"]["id"] != "employment":
            p._parse_analyst(row["text"], facts, row["context"])
    for original in ("甲" * 121, " 甲，乙。 丙；丁！", "代码‘引用’与🙂\n下一行", ""):
        namespace["facts"] = {"test": {"text": original, "id": "test", **next(iter(facts.values()))}}
        namespace["facts"]["test"]["text"] = original
        ctx = namespace["analyzer_context"](flat["directions"][0])
        fragments = ctx["schema"]["properties"]["assessments"]["items"]["properties"]["quote"]["enum"]
        assert all(q in original and 0 < len(q) <= 60 for q in fragments)
    assert max(sizes) <= t.MAX_PROMPT_UTF8_BYTES
    report = {"status": "PASS_OFFLINE_CONTRACT", "actualEllipsisRejected": True,
              "twoSuccessfulNodesReused": True, "allChoicesVerbatim": True,
              "sourceBoundaryCases": 4, "requestBytes": sizes, "providerCalls": 0,
              "semanticAcceptance": "PENDING_NEW_VERSION_REAL_REVIEW",
              "sourceHash": hashlib.sha256(target.read_bytes()).hexdigest()}
    Path("assets/verbatim_quote_offline_eval_20261014.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report))
except BaseException:
    target.write_bytes(before)
    raise
