"""Publish static competition materials through the existing Nginx site.

Run on the existing Linux host after the paired product release has reopened:
  python3 publish-competition.py --source /opt/lifeos/material-releases/RELEASE \
      --expected-head FULL_PRODUCT_COMMIT --install

Default is read-only preflight. Preserves a byte-exact configuration backup.
Never starts/restarts application containers, changes data, or dispatches models.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--source', required=True)
parser.add_argument('--expected-head', required=True)
parser.add_argument('--install', action='store_true')
args = parser.parse_args()
root = Path(args.source)
assert root.is_absolute() and root.resolve() == root
assert root.parent == Path('/opt/lifeos/material-releases')
assert re.fullmatch(r'[A-Za-z0-9_-]+', root.name)
assert re.fullmatch(r'[a-f0-9]{40}', args.expected_head)
assert root.stat().st_uid == 0 and not root.stat().st_mode & 0o022
assert (root/'index.html').is_file()
allowed = {'index.html', 'guide.html', 'DELIVERY_STATUS.md', 'SHA256SUMS.txt',
    'LifeOS_User_Guide_and_Submission_Checklist_20261023.pdf',
    'LifeOS_User_Guide_and_Submission_Checklist_20261023.md', 'build_user_guide.py',
    'LifeOS_Product_Design_20261023.pdf', 'LifeOS_Functional_Validation_Evidence_20261023.pdf'}
files = sorted(root.iterdir())
assert {p.name for p in files} == allowed, 'EXACT_PUBLIC_MATERIAL_SET_REQUIRED'
for p in files:
    assert p.is_file() and p.resolve() == p and p.stat().st_uid == 0 and not p.stat().st_mode & 0o022
    if p.suffix == '.pdf':
        assert p.read_bytes().startswith(b'%PDF-')

def version(origin):
    with urllib.request.urlopen(origin+'/api/run/version', timeout=15) as response:
        value = json.load(response)
    assert value['head'] == args.expected_head, 'PUBLIC_PRODUCT_VERSION_MUST_MATCH'
    return value['head']

version('http://127.0.0.1:8787')
version('https://lqynb.xyz')
# Access policy is public and blocked by the maintenance fence, while version
# may remain readable. Require a public non-mutating policy read as well.
with urllib.request.urlopen('https://lqynb.xyz/api/access-policy', timeout=15) as response:
    assert response.status == 200

site = Path('/etc/nginx/sites-available/lqynb.xyz')
assert site.resolve() == site and site.stat().st_uid == 0
original = site.read_bytes()
text = original.decode()
assert not re.search(r'return\s+503|http_x_lifeos_release', text, re.I), 'DO_NOT_EDIT_ACTIVE_RELEASE_FENCE'
assert '# LifeOS competition materials' not in text, 'MATERIALS_ALREADY_CONFIGURED_REVIEW_BEFORE_REPLACE'
needle = '    location / {\n        proxy_pass http://127.0.0.1:8787;'
assert text.count(needle) == 1, 'EXACT_EXISTING_PROXY_BLOCK_REQUIRED'
guide_link = '<a id="lifeos-user-guide" href="/competition/" style="position:fixed;right:16px;bottom:14px;z-index:30;padding:6px 10px;border:1px solid #d5d5d5;border-radius:8px;background:#fff;color:#245ac8;font:13px sans-serif;text-decoration:none">使用说明</a>'
fragment = f'''    # LifeOS competition materials: static-only, public, independent of login.
    location = /competition {{ return 301 /competition/; }}
    location ^~ /competition/ {{
        alias {root}/;
        index index.html;
        autoindex off;
        add_header X-Content-Type-Options nosniff always;
        add_header Cache-Control "no-cache" always;
        types {{ text/html html; text/plain md py txt; application/pdf pdf; application/json json; }}
    }}

'''
replacement = fragment + needle + '''
        proxy_set_header Accept-Encoding "";
        sub_filter_once on;
        sub_filter '</body>' 'INJECTED_GUIDE_LINK</body>';'''.replace('INJECTED_GUIDE_LINK', guide_link)
updated = text.replace(needle, replacement).encode()
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
report = {'status':'PREFLIGHT_ONLY','productHead':args.expected_head,'at':stamp,
    'source':str(root),'oldNginxSha256':hashlib.sha256(original).hexdigest(),
    'newNginxSha256':hashlib.sha256(updated).hexdigest(),'providerCalls':0,
    'files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in files}}
if args.install:
    backup_root = Path('/opt/lifeos/material-publish-backups')
    backup_root.mkdir(mode=0o700, exist_ok=True)
    assert backup_root.resolve()==backup_root and backup_root.stat().st_uid==0 and not backup_root.stat().st_mode & 0o077
    backup = backup_root/(stamp+'-'+report['oldNginxSha256'][:12]+'.conf')
    with backup.open('xb') as out:
        os.chmod(backup,0o600)
        out.write(original)
    assert site.read_bytes()==original, 'CONCURRENT_NGINX_CHANGE'
    try:
        site.write_bytes(updated)
        subprocess.run(['nginx','-t'], check=True, capture_output=True, timeout=15)
        subprocess.run(['nginx','-s','reload'], check=True, capture_output=True, timeout=15)
    except BaseException:
        site.write_bytes(original)
        subprocess.run(['nginx','-t'], check=True, capture_output=True, timeout=15)
        subprocess.run(['nginx','-s','reload'], check=True, capture_output=True, timeout=15)
        raise
    report.update(status='STATIC_MATERIALS_DEPLOYED_PENDING_DOWNLOAD_VERIFICATION',backup=str(backup))
    with (backup_root/(stamp+'-publish.json')).open('x') as out:
        json.dump(report,out,indent=2)
print(json.dumps(report))
