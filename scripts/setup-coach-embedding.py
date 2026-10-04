"""Download one pinned public model; no user data or provider calls are sent."""
import hashlib
import json
from pathlib import Path
import requests

REPO = "BAAI/bge-small-zh-v1.5"
REVISION = "7999e1d3359715c523056ef9478215996d62a620"
DEST = Path(__file__).resolve().parents[1] / ".local" / "models" / "bge-small-zh-v1.5"
FILES = ["config.json", "config_sentence_transformers.json", "modules.json",
         "sentence_bert_config.json", "special_tokens_map.json", "tokenizer.json",
         "tokenizer_config.json", "vocab.txt", "1_Pooling/config.json", "model.safetensors", "README.md"]

def verified(data, metadata):
    if metadata.get("lfs"):
        return hashlib.sha256(data).hexdigest() == metadata["lfs"]["sha256"]
    blob = b"blob " + str(len(data)).encode("ascii") + b"\0" + data
    return hashlib.sha1(blob).hexdigest() == metadata["blobId"]

def main():
    response = requests.get(f"https://huggingface.co/api/models/{REPO}/revision/{REVISION}?blobs=true", timeout=30)
    response.raise_for_status()
    info = response.json()
    if info["sha"] != REVISION:
        raise RuntimeError("Model revision mismatch")
    metadata = {item["rfilename"]: item for item in info["siblings"]}
    manifest = {"repo": REPO, "revision": REVISION, "license": "MIT", "files": {}}
    for name in FILES:
        target = DEST / name
        data = target.read_bytes() if target.exists() else b""
        if not verified(data, metadata[name]):
            download = requests.get(f"https://huggingface.co/{REPO}/resolve/{REVISION}/{name}", timeout=(30, 120))
            download.raise_for_status()
            data = download.content
            if not verified(data, metadata[name]):
                raise RuntimeError("Model file digest mismatch: " + name)
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_name(target.name + ".download")
            temporary.write_bytes(data)
            temporary.replace(target)
        manifest["files"][name] = {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
        print(json.dumps({"file": name, "verified": True, "bytes": len(data)}), flush=True)
    (DEST / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

if __name__ == "__main__":
    main()
