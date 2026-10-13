$ErrorActionPreference = 'Stop'
$Image = 'lifeos:v1.3-fast-launch-candidate'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (git status --porcelain) { throw 'Commit or preserve all changes before building an exact-version image.' }
$sourceCommit = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceCommit -notmatch '^[a-f0-9]{40}$') { throw 'Cannot determine source commit.' }
foreach ($asset in '.local/models/bge-small-zh-v1.5/config.json', '.local/docker-embedding/wheels') {
    if (!(Test-Path -LiteralPath $asset)) { throw "Missing declared offline dependency: $asset" }
}
# Docker must read committed blob bytes. A clean Windows checkout can still
# contain CRLF bytes while another checkout contains LF at the same commit.
# Keep the failed contexts; copy only the two declared public asset directories.
$contextRoot = Join-Path (Get-Location) '.local/image-build-contexts'
New-Item -ItemType Directory -Path $contextRoot -Force | Out-Null
$contextPath = Join-Path $contextRoot ([Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $contextPath | Out-Null
$archivePath = Join-Path $contextRoot ([Guid]::NewGuid().ToString('N') + '.tar')
git archive --format=tar --output=$archivePath $sourceCommit
if ($LASTEXITCODE -ne 0) { throw 'Cannot export committed source.' }
tar -xf $archivePath -C $contextPath
if ($LASTEXITCODE -ne 0) { throw 'Cannot extract committed source.' }
foreach ($privatePath in '.env.server', '.env.production', '.local/v1.3-action-coach/paid/provider-calls.json') {
    if (Test-Path -LiteralPath (Join-Path $contextPath $privatePath)) { throw 'Private runtime data is unexpectedly tracked; build refused.' }
}
foreach ($asset in '.local/models/bge-small-zh-v1.5', '.local/docker-embedding/wheels') {
    $sourcePath = Join-Path (Get-Location) $asset
    if ((Get-Item -LiteralPath $sourcePath).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Public asset symlink refused.' }
    $targetParent = Split-Path (Join-Path $contextPath $asset) -Parent
    New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
    Copy-Item -LiteralPath $sourcePath -Destination $targetParent -Recurse
}
docker build --build-arg "LIFEOS_BUILD_COMMIT=$sourceCommit" -t $Image $contextPath
if ($LASTEXITCODE -ne 0) { throw 'Image build failed; preserve its first output before repairing.' }
Write-Output "BUILT $Image source=$sourceCommit; provider, cloud workflow and release acceptance remain separate."
