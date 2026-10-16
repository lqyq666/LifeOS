"""Offline, persistent JSON-lines encoder. Stdout contains protocol data only."""
import os
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"

import hashlib
import json
from pathlib import Path
import sys
import numpy as np
import torch
from sentence_transformers import SentenceTransformer

MODEL = Path(__file__).resolve().parents[1] / ".local" / "models" / "bge-small-zh-v1.5"
REVISION = "7999e1d3359715c523056ef9478215996d62a620"
SIGNATURE = "bge-small-zh-v1.5:" + REVISION + ":normalized-chunk-mean-v1"
INSTRUCTION = "为这个句子生成表示以用于检索相关文章："

class Encoder:
    def __init__(self):
        manifest = json.loads((MODEL / "manifest.json").read_text(encoding="utf-8"))
        if manifest["revision"] != REVISION:
            raise RuntimeError("Embedding revision mismatch")
        for name, entry in manifest["files"].items():
            if hashlib.sha256((MODEL / name).read_bytes()).hexdigest() != entry["sha256"]:
                raise RuntimeError("Embedding file changed")
        torch.set_num_threads(4)
        self.model = SentenceTransformer(str(MODEL), device="cpu", local_files_only=True, trust_remote_code=False)
        self.model.eval()

    def encode(self, texts, query=False):
        if not isinstance(texts, list) or not 1 <= len(texts) <= 32:
            raise ValueError("Embedding batch limit")
        if any(not isinstance(text, str) or not text.strip() or len(text) > 16000 for text in texts):
            raise ValueError("Embedding text limit")
        chunks, ranges = [], []
        for text in texts:
            tokens = self.model.tokenizer.encode((INSTRUCTION if query else "") + text, add_special_tokens=False)
            start = len(chunks)
            width = self.model.max_seq_length - 2
            for offset in range(0, len(tokens), width):
                chunks.append(self.model.tokenizer.decode(tokens[offset:offset+width], skip_special_tokens=True))
            ranges.append((start, len(chunks)))
        encoded = self.model.encode(chunks, batch_size=16, normalize_embeddings=True, show_progress_bar=False)
        result = []
        for start, end in ranges:
            vector = np.mean(encoded[start:end], axis=0)
            vector = vector / max(float(np.linalg.norm(vector)), 1e-12)
            result.append(vector.tolist())
        return result

def main():
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    encoder = Encoder()
    print(json.dumps({"ready": True, "signature": SIGNATURE}), flush=True)
    for line in sys.stdin:
        request = None
        try:
            request = json.loads(line)
            vectors = encoder.encode(request["texts"], request.get("query", False))
            response = {"id": request["id"], "signature": SIGNATURE, "vectors": vectors}
        except Exception:
            # No input, model output or credentials in diagnostic messages.
            response = {"id": request.get("id") if isinstance(request, dict) else None, "error": "LOCAL_EMBEDDING_FAILED"}
        print(json.dumps(response, ensure_ascii=False), flush=True)

if __name__ == "__main__":
    main()
