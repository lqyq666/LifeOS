"""Fetch the pinned Linux CPU wheel from PyTorch's official hash-bearing index.

Preparation only; never used by the running service. TLS verification stays on.
"""
import hashlib
import html
from pathlib import Path
import re
from urllib.parse import urljoin, urlparse, unquote
import requests

INDEX = "https://download.pytorch.org/whl/cpu/torch/"
NAME = "torch-2.11.0+cpu-cp312-cp312-manylinux_2_28_x86_64.whl"
DEST = Path(__file__).resolve().parents[1] / ".local/docker-embedding/wheels"

def main():
    response = requests.get(INDEX, timeout=60)
    response.raise_for_status()
    candidates = [urljoin(INDEX, html.unescape(link)) for link in re.findall(r'href="([^"]+)"', response.text)]
    links = [link for link in candidates if unquote(urlparse(link).path).endswith("/" + NAME)]
    if len(links) != 1 or not re.fullmatch(r"sha256=[0-9a-f]{64}", urlparse(links[0]).fragment):
        raise RuntimeError("Official wheel identity or hash missing")
    link = links[0]
    if urlparse(link).scheme != "https" or urlparse(link).hostname not in {"download.pytorch.org", "download-r2.pytorch.org"}:
        raise RuntimeError("Unexpected wheel origin")
    expected = urlparse(link).fragment.split("=", 1)[1]
    DEST.mkdir(parents=True, exist_ok=True)
    target = DEST / NAME
    if target.exists() and hashlib.file_digest(target.open("rb"), "sha256").hexdigest() == expected:
        print("CPU wheel already verified: " + expected)
        return
    temporary = target.with_suffix(".download")
    digest = hashlib.sha256()
    with requests.get(link.split("#", 1)[0], stream=True, timeout=(30, 120)) as download:
        download.raise_for_status()
        with temporary.open("wb") as output:
            for chunk in download.iter_content(1024 * 1024):
                output.write(chunk)
                digest.update(chunk)
    if digest.hexdigest() != expected:
        raise RuntimeError("CPU wheel checksum mismatch; unverified download preserved")
    temporary.replace(target)
    print("CPU wheel verified: " + expected)

if __name__ == "__main__":
    main()
