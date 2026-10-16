"""Turn the Linux pip resolution into a hash-locked offline wheelhouse.

Run after the documented Linux resolver. Fetches public package files only.
"""
import hashlib
import json
from pathlib import Path
from urllib.parse import urlparse, unquote, quote
import requests

ROOT = Path(__file__).resolve().parents[1]
WHEELS = ROOT / ".local/docker-embedding/wheels"

def file_hash(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()

def main():
    manifest = ROOT / "deploy/embedding-wheels.json"
    report_path = manifest if manifest.exists() else ROOT / ".local/docker-embedding/resolution.json"
    report = json.loads(report_path.read_text())
    if report["environment"]["sys_platform"] != "linux" or report["environment"]["python_version"] != "3.12" or report["environment"]["platform_machine"] != "x86_64":
        raise RuntimeError("Linux amd64 Python 3.12 resolution required")
    lines = ["# Linux amd64 / Python 3.12. All wheels are pinned by SHA256.", "# Prepare with deploy/lock-embedding.py; runtime/build installation is offline."]
    WHEELS.mkdir(parents=True, exist_ok=True)
    public_items = []
    for item in sorted(report["install"], key=lambda entry: entry["metadata"]["name"].lower()):
        name, version = item["metadata"]["name"], item["metadata"]["version"]
        if name.lower().startswith("nvidia-") or (name.lower() == "torch" and version != "2.11.0+cpu"):
            raise RuntimeError("GPU dependency rejected")
        info = item["download_info"]
        expected = info["archive_info"]["hashes"]["sha256"]
        parsed = urlparse(info["url"])
        filename = Path(unquote(parsed.path)).name
        if not filename.endswith(".whl") or len(expected) != 64:
            raise RuntimeError("Wheel digest required")
        url = info["url"]
        if parsed.scheme == "file" and name.lower() == "torch":
            url = "https://download.pytorch.org/whl/cpu/" + quote(filename, safe="")
        parsed = urlparse(url)
        public_items.append({"metadata": {"name": name, "version": version}, "download_info": {"url": url, "archive_info": {"hashes": {"sha256": expected}}}})
        target = WHEELS / filename
        if not target.exists() or file_hash(target) != expected:
            if parsed.scheme != "https" or parsed.hostname not in {"files.pythonhosted.org", "download.pytorch.org", "download-r2.pytorch.org"}:
                raise RuntimeError("Unexpected package origin")
            temporary = target.with_suffix(".download")
            with requests.get(url, stream=True, timeout=(30, 120)) as response:
                response.raise_for_status()
                with temporary.open("wb") as output:
                    for chunk in response.iter_content(1024 * 1024):
                        output.write(chunk)
            if file_hash(temporary) != expected:
                raise RuntimeError("Package digest mismatch: " + filename)
            temporary.replace(target)
        lines.append(f"{name}=={version} --hash=sha256:{expected}")
        print("verified " + filename, flush=True)
    (ROOT / "deploy/requirements-embedding.lock").write_text("\n".join(lines) + "\n", encoding="utf-8")
    environment = {key: report["environment"][key] for key in ["sys_platform", "python_version", "platform_machine"]}
    manifest.write_text(json.dumps({"environment": environment, "install": public_items}, indent=2) + "\n", encoding="utf-8")
    print(f"Locked {len(report['install'])} CPU packages")

if __name__ == "__main__":
    main()
