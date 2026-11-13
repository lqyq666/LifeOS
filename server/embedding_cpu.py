"""Bound CPU inference threads to the container's actual capacity."""
import os
from pathlib import Path


def inference_threads():
    threads = min(4, os.cpu_count() or 1)
    try:
        threads = min(threads, len(os.sched_getaffinity(0)))
    except (AttributeError, OSError):
        pass
    try:
        quota, period = Path("/sys/fs/cgroup/cpu.max").read_text().split()
        if quota != "max":
            threads = min(threads, max(1, int(quota) // int(period)))
    except (OSError, ValueError, ZeroDivisionError):
        pass
    return max(1, threads)
