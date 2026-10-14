// Sync pre-reviewed commits from a separate sanitized repository only.
import {execFileSync} from 'node:child_process';
import {realpathSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const remoteUrl = 'https://github.com/lqyq666/LifeOS.git';
export function validateBlob(name, data, reviewedAssets = {}) {
  const reviewed = reviewedAssets[name] === createHash('sha256').update(data).digest('hex');
  // Runtime evidence requires explicit review, never blanket inclusion.
  if (/(^|\/)(?:\.git|\.local|backups?|logs?|__pycache__|node_modules)(?:\/|$)/i.test(name)
      || (!reviewed && /^(?:\.planning|evidence)\//i.test(name))
      || /(?:^|\/)(?:\.env(?!\.(?:server|production)\.example$)|[^/]*(?:credential|secret|ledger)[^/]*\.(?:jsonl?|ya?ml|txt|csv)$)/i.test(name)
      || /\.(?:pem|key|p12|pfx|dump|sqlite3?|db|zip|tar|gz|pyc|log)$/i.test(name)) {
    throw Error('PRIVATE_OR_UNREVIEWED_PATH: ' + name);
  }
  if (data.includes(0) && !reviewed) throw Error('BINARY_REQUIRES_SEPARATE_REVIEW: ' + name);
  const text = data.toString('utf8');
  const secret = /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|LTAI[A-Za-z0-9]{12,})\b|(?:postgres(?:ql)?|mysql):\/\/[^\s:/]+:[^\s@]+@|(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[=:]\s*["'][A-Za-z0-9+/=_-]{24,}["']/i;
  if (secret.test(text)) throw Error('POSSIBLE_SECRET: ' + name);
}

export function inspectRepository(repo, commit, source = sourceRoot, reviewedAssets = {}) {
  const root = realpathSync(repo), original = realpathSync(source);
  const git = (...args) => execFileSync('git', ['-C', root, ...args], {windowsHide:true, maxBuffer:64*1024*1024});
  if (root.toLowerCase() === original.toLowerCase()) throw Error('SOURCE_HISTORY_MUST_REMAIN_LOCAL');
  if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('EXACT_COMMIT_REQUIRED');
  if (realpathSync(git('rev-parse','--show-toplevel').toString().trim()).toLowerCase() !== root.toLowerCase()) throw Error('REPOSITORY_ROOT_REQUIRED');
  if (git('rev-parse','HEAD').toString().trim() !== commit) throw Error('HEAD_CHANGED');
  if (git('status','--porcelain','--untracked-files=all').length) throw Error('PUBLISH_COPY_HAS_UNFINISHED_CHANGES');
  const branch = git('symbolic-ref','--short','HEAD').toString().trim();
  if (/^(?:main|master)$/i.test(branch)) throw Error('DEFAULT_BRANCH_NOT_ALLOWED');
  const roots = git('rev-list','--max-parents=0',commit).toString().trim().split(/\r?\n/);
  const originalRoots = execFileSync('git',['-C',original,'rev-list','--max-parents=0','--all'],{windowsHide:true}).toString().trim().split(/\r?\n/);
  if (roots.some(root => originalRoots.includes(root))) throw Error('DEVELOPMENT_HISTORY_IN_PUBLICATION_COPY');
  const scanned = new Set();
  // Include history: a later deletion does not make an old secret safe to push.
  for (const revision of git('rev-list',commit).toString().trim().split(/\r?\n/)) {
    for (const entry of git('ls-tree','-rz',revision).toString().split('\0').filter(Boolean)) {
      const match = /^(\d+) (\w+) ([a-f0-9]{40})\t([\s\S]+)$/.exec(entry);
      if (!match || match[2] !== 'blob' || !['100644','100755'].includes(match[1])) throw Error('LINK_OR_SUBMODULE_NOT_ALLOWED');
      const [, , , oid, name] = match, key = oid + ':' + name;
      if (!scanned.has(key)) { validateBlob(name,git('cat-file','blob',oid),reviewedAssets); scanned.add(key); }
    }
  }
  return {root,commit,branch,scannedBlobs:scanned.size};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args=process.argv.slice(2), get=name=>args[args.indexOf(name)+1];
    if (!args.includes('--repo') || !args.includes('--commit')) throw Error('EXPLICIT_REPO_AND_COMMIT_REQUIRED');
    const assets=args.includes('--reviewed-assets')?JSON.parse(readFileSync(get('--reviewed-assets'),'utf8')):{};
    if (!assets || Array.isArray(assets) || typeof assets!=='object' || Object.entries(assets).some(([name,hash])=>!name || !/^[a-f0-9]{64}$/.test(hash))) throw Error('INVALID_REVIEWED_ASSET_MANIFEST');
    const result=inspectRepository(get('--repo'),get('--commit'),sourceRoot,assets);
    if (args.includes('--push')) {
      // Fixed URL/refspec, fast-forward only, no tags, main merge or deployment.
      execFileSync('git',['-C',result.root,'-c','push.followTags=false','push',remoteUrl,result.commit+':refs/heads/'+result.branch],{stdio:'inherit',windowsHide:true});
    }
    console.log(JSON.stringify({...result,status:args.includes('--push')?'PUSHED_SELECTED_COMMIT':'VALIDATED_NOT_PUSHED',runtimeAssets:'REQUIRES_REVIEWED_RUNTIME_ASSET_MANIFEST_BEFORE_BUILD',deployed:false}));
  } catch(error) { console.error(error.message); process.exitCode=1; }
}
