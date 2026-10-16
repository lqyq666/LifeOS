"""Apply one hash-bound, lossless cloud serializer repair; no provider calls."""
import asyncio
import hashlib
import json
from pathlib import Path
from unittest.mock import patch


def verify():
    import httpx
    from lifeos_host.http_route import transport_http as t

    body = {"text": "完整依据 中文 🙂", "schema": {"enum": ["a", "b"]}}
    assert json.loads(t.encode_request_body(body)) == body
    assert t.request_body_bytes(body) == len(t.encode_request_body(body))
    assert t.request_body_bytes(body) < len(json.dumps(body, ensure_ascii=False).encode())

    async def boundaries():
        seen = []
        def respond(request):
            seen.append(request.content)
            return httpx.Response(200, json={"id": "mock-no-provider", "choices": [
                {"message": {"content": "{}"}, "finish_reason": "stop"}]})
        transport = t.RealHttpTransport(api_key="synthetic-not-a-key",
                                       transport_impl=httpx.MockTransport(respond))
        try:
            for size in [12000, 12001]:
                sample = {"x": "a" * (size - 8)}
                assert len(t.encode_request_body(sample)) == size
                with patch.object(t, "build_request_body", return_value=sample):
                    try:
                        result = await transport.call_async({}, {}, {}, 1000)
                    except t.WorkflowError:
                        assert size == 12001
                    else:
                        assert size == 12000
                        assert result.promptBytes == size
                        assert seen[-1] == t.encode_request_body(sample)
            assert len(seen) == 1
        finally:
            await transport.close_async()
    asyncio.run(boundaries())
    return {"unicodeRoundtrip": True, "wireMatchesPreflight": True,
            "boundary12000Accepted": True, "boundary12001ZeroDispatch": True,
            "realProviderCalls": 0}


if __name__ == "__main__":
    target = Path("src/lifeos_host/http_route/transport_http.py")
    before = target.read_bytes()
    assert hashlib.sha256(before).hexdigest() == "06d77eba8bcd4494fb34abc7bda44c1092a5d5646ba530e8da85be7de027d5f2"
    source = before.decode()
    old = 'def request_body_bytes(body: Dict[str, Any]) -> int:\n    return len(json.dumps(body, ensure_ascii=False).encode("utf-8"))'
    new = '''def encode_request_body(body: Dict[str, Any]) -> bytes:
    """Lossless JSON bytes shared by preflight and the actual HTTP request."""
    return json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def request_body_bytes(body: Dict[str, Any]) -> int:
    return len(encode_request_body(body))'''
    assert source.count(old) == 1
    source = source.replace(old, new)
    old_payload = '        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")'
    assert source.count(old_payload) == 1
    source = source.replace(old_payload, '        payload = encode_request_body(body)')
    compile(source, str(target), "exec")
    backup = Path("assets/transport_before_compact_wire_20261014.py")
    with backup.open("xb") as f:
        f.write(before)
    target.write_bytes(source.encode())
    try:
        report = verify()
    except BaseException:
        target.write_bytes(before)
        raise
    report["sourceHash"] = hashlib.sha256(target.read_bytes()).hexdigest()
    Path("assets/compact_wire_verification_20261014.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report))
