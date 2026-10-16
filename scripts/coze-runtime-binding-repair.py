"""Root runtime evidence in the module repository; never trust a cwd fallback.

Run on the original Coze project only. This edits one hash-bound file, makes
no network requests, and does not commit or deploy. Keep the printed hash.
"""
import hashlib
import sys
from pathlib import Path

BEFORE = "c5a437c0b6bf4542e9445945bad8f6094e7ea69ff57eab4beb3c10836a2b4594"


def repair(source):
    assert hashlib.sha256(source.encode()).hexdigest() == BEFORE
    source = source.replace(
        'from ..skills_registry import git_commit as _skills_git_commit',
        '_REPOSITORY_ROOT = os.path.realpath(os.path.join(os.path.dirname(__file__), "../../.."))\n\n\n'
        'def _repository_path(relative: str) -> str:\n'
        '    return os.path.join(_REPOSITORY_ROOT, relative)')
    source = source.replace(
        'os.path.realpath(os.path.join(os.path.dirname(__file__), "../../..")), "rev-parse"',
        '_REPOSITORY_ROOT, "rev-parse"')
    source = source.replace('return _skills_git_commit() or "unknown"', 'return "unknown"')
    source = source.replace('glob.glob(p)', 'glob.glob(_repository_path(p))')
    source = source.replace('out[real] = hash_file(real)',
                            'out[os.path.relpath(real, _REPOSITORY_ROOT).replace(os.sep, "/")] = hash_file(real)')
    source = source.replace('elif os.path.isfile(p):\n                out[p] = hash_file(p)',
                            'elif os.path.isfile(_repository_path(p)):\n                out[p] = hash_file(_repository_path(p))')
    source = source.replace('src = "assets/COZE_CANONICAL_PUBLIC_ASSETS.json"',
                            'src = _repository_path("assets/COZE_CANONICAL_PUBLIC_ASSETS.json")')
    source = source.replace('"assets/COZE_HTTP_HOST_BINDING.json"',
                            '_repository_path("assets/COZE_HTTP_HOST_BINDING.json")')
    source = source.replace('"cloudCommit": self.cloud_commit,',
                            '"cloudCommit": self.cloud_commit,\n'
                            '            "runtimeBindingResolver": "module_repository_v2",')
    compile(source, "runtime_binding.py", "exec")
    return source


def bind_deployment(source):
    """Accept deployment metadata only when it attests the actual source bytes.

    HOST_COMMIT alone is deliberately insufficient. Repository identity remains
    a separate field, and neither value is taken from an incoming request.
    """
    assert hashlib.sha256(source.encode()).hexdigest() == "9238f741f27bcc02f756b4f3c3533b372c6e71ba849d0ddf6713daba9d3bc740"
    source = source.replace(
        'cloudCommit：修改完成后提交的当前真实 40 位 git commit（不读取未知/请求回显，不用 R2/R3 提交号冒充）',
        'cloudCommit：模块仓库提交或经实际源码摘要验证的部署声明；repositoryCommit 独立保留，不读取请求回显')
    source = source.replace(
        '        self.cloud_commit: str = _commit()',
        '        self.repository_commit: str = _commit()\n'
        '        self.cloud_commit: str = self.repository_commit\n'
        '        self.cloud_commit_source = "module_repository" if self.cloud_commit != "unknown" else "unavailable"')
    source = source.replace(
        '        self.cloud_source_digest: str = aggregate_digest(list(self.cloud_source_hashes.values()))',
        '        self.cloud_source_digest: str = aggregate_digest(list(self.cloud_source_hashes.values()))\n'
        '        declared = os.environ.get("HOST_COMMIT", "")\n'
        '        declared_digest = os.environ.get("HOST_SOURCE_DIGEST", "")\n'
        '        if (len(declared) == 40 and all(c in "0123456789abcdef" for c in declared)\n'
        '                and declared_digest == self.cloud_source_digest):\n'
        '            self.cloud_commit = declared\n'
        '            self.cloud_commit_source = "deployment_source_digest"')
    source = source.replace(
        '            "runtimeBindingResolver": "module_repository_v2",',
        '            "runtimeBindingResolver": "source_bound_deployment_v3",\n'
        '            "repositoryCommit": self.repository_commit,\n'
        '            "cloudCommitSource": self.cloud_commit_source,')
    compile(source, "runtime_binding.py", "exec")
    return source


if __name__ == "__main__":
    target = Path("src/lifeos_host/http_route/runtime_binding.py")
    before = target.read_bytes()
    deployment = sys.argv[1:] == ["--deployment"]
    if sys.argv[1:] and not deployment:
        raise SystemExit("Use no arguments for repository repair or --deployment for source-bound metadata")
    after = (bind_deployment if deployment else repair)(before.decode("utf-8")).encode("utf-8")
    backup = Path("assets/runtime_binding_before_deployment_v3.py" if deployment else "assets/runtime_binding_before_repository_v2.py")
    with backup.open("xb") as stream:
        stream.write(before)
    target.write_bytes(after)
    print("runtimeBindingSha256=" + hashlib.sha256(after).hexdigest())
