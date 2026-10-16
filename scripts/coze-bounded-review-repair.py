"""Raise the signed review input envelope with matching conservative reserves.

Run in the authorized development project, with a synthetic host-generated
fixture at assets/bounded_review_offline_fixture.json. No real provider calls.
"""
import asyncio
import base64
import hashlib
import hmac
import json
from pathlib import Path
from unittest.mock import patch

targets = {
    "src/lifeos_host/http_route/wire.py": "31a304cabe19730678a03ca63c101eeecd48786e1dad637bbd87ff9a30ea6342",
    "src/lifeos_host/http_route/transport_http.py": "117b90289f9a0b3a7dccbb554eacc67c12c7ce1d54c1c29d56f87014ae78994c",
}
before = {}
for name, expected in targets.items():
    raw = Path(name).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == expected
    before[name] = raw
for name, raw in before.items():
    with Path("assets/before_bounded_review_" + Path(name).name).open("xb") as f:
        f.write(raw)
    source = raw.decode()
    if name.endswith("wire.py"):
        source = source.replace("MAX_PROMPT_UTF8_BYTES = 12000", "MAX_PROMPT_UTF8_BYTES = 32768")
        source = source.replace("16384", "36864")
    else:
        source = source.replace("MAX_PROMPT_UTF8_BYTES = 12000", "from .wire import MAX_PROMPT_UTF8_BYTES")
        source = source.replace("> 12000", "> the signed byte cap").replace("12000-byte", "signed-byte").replace(">12000", ">MAX_PROMPT_UTF8_BYTES")
    compile(source, name, "exec")
    Path(name).write_bytes(source.encode())

try:
    import httpx
    from lifeos_host.http_route import wire as w, transport_http as t
    fixture = json.loads(Path("assets/bounded_review_offline_fixture.json").read_text())
    claims, payload = w.verify_wire(fixture["wire"], fixture["secret"], fixture["binding"], fixture["now"])
    assert claims.maxPromptUtf8Bytes == t.MAX_PROMPT_UTF8_BYTES == 32768
    assert all(s.reservedCostCny >= w.MIN_SLOT_FEE_CNY for s in claims.slots)
    altered = json.loads(base64.b64decode(fixture["wire"]["claimsB64"]))
    for slot in altered["slots"]:
        slot["reservedCostCny"] = .02
    encoded = base64.b64encode(json.dumps(altered).encode()).decode()
    underfunded = dict(fixture["wire"], claimsB64=encoded,
        signature=hmac.new(fixture["secret"].encode(), encoded.encode(), hashlib.sha256).hexdigest())
    try:
        w.verify_wire(underfunded, fixture["secret"], fixture["binding"], fixture["now"])
    except w.WorkflowError:
        pass
    else:
        raise AssertionError("underfunded permit accepted")

    async def check_boundary():
        sent = []
        def reply(request):
            sent.append(request.content)
            return httpx.Response(200, json={"id": "offline", "choices": [{"message": {"content": "{}"}}]})
        transport = t.RealHttpTransport(api_key="synthetic-not-a-key", transport_impl=httpx.MockTransport(reply))
        try:
            for size in (32768, 32769):
                body = {"x": "a" * (size - 8)}
                assert t.request_body_bytes(body) == size
                with patch.object(t, "build_request_body", return_value=body):
                    try:
                        result = await transport.call_async({}, {}, {}, 1000)
                    except t.WorkflowError:
                        assert size == 32769
                    else:
                        assert size == 32768 and result.promptBytes == size
                        assert sent[-1] == t.encode_request_body(body)
            assert len(sent) == 1
        finally:
            await transport.close_async()
    asyncio.run(check_boundary())
    report = {"crossLanguageSignedPermit": True, "underfundedPermitRejected": True,
              "boundary32768Accepted": True, "boundary32769ZeroDispatch": True,
              "realProviderCalls": 0, "sourceHashes": {
                  name: hashlib.sha256(Path(name).read_bytes()).hexdigest() for name in targets}}
    Path("assets/bounded_review_verification.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report))
except BaseException:
    for name, raw in before.items():
        Path(name).write_bytes(raw)
    raise
