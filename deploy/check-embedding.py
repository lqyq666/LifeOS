"""Synthetic offline encoder smoke and Linux process-memory measurement.

Run inside the release image with --network none, read-only filesystem and a
bounded /tmp. No Provider API or real user data is involved.
"""
import json
import math
import os
import resource
import subprocess
import time

started = time.monotonic()
worker = subprocess.Popen([os.environ["LIFEOS_EMBEDDING_PYTHON"], "-u", "server/coach-embedding-worker.py"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8")
try:
    ready = json.loads(worker.stdout.readline())
    assert ready["ready"] and ready["signature"] == "bge-small-zh-v1.5:7999e1d3359715c523056ef9478215996d62a620:normalized-chunk-mean-v1"
    cold_ms = round((time.monotonic() - started) * 1000)
    batch_start = time.monotonic()
    worker.stdin.write(json.dumps({"id": 1, "texts": ["整理考试资料并通过网盘交付", "考试材料整理后发给同学", "食堂午餐菜单和饭菜价格"], "query": False}, ensure_ascii=False) + "\n")
    worker.stdin.flush()
    result = json.loads(worker.stdout.readline())
    vectors = result["vectors"]
    assert result["id"] == 1 and result["signature"] == ready["signature"] and len(vectors) == 3
    assert all(len(vector) == 512 and all(math.isfinite(value) for value in vector) and abs(sum(value * value for value in vector) - 1) < 0.001 for vector in vectors)
    related = sum(a * b for a, b in zip(vectors[0], vectors[1]))
    unrelated = sum(a * b for a, b in zip(vectors[0], vectors[2]))
    assert related > unrelated, "Semantic ordering failed"
    batch_ms = round((time.monotonic() - batch_start) * 1000)
    worker.stdin.close()
    assert worker.wait(timeout=10) == 0
    with open("/sys/fs/cgroup/memory.peak") as peak:
        container_peak = int(peak.read().strip())
    print(json.dumps({"evidence": "LINUX_CPU_REAL_BGE_SYNTHETIC_TEXT_NO_NETWORK_NO_PROVIDER", "status": "PASS", "coldStartMs": cold_ms, "batchMs": batch_ms, "dimensions": 512, "workerPeakRssKiB": resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss, "containerPeakBytes": container_peak, "relatedScore": related, "unrelatedScore": unrelated}))
finally:
    if worker.poll() is None:
        worker.kill()
        worker.wait(timeout=10)
