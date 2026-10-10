param([string]$Tag = 'lifeos:coze-core-candidate')
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (git status --porcelain) { throw 'Commit or preserve all changes before building an exact-version image.' }
$sourceCommit = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceCommit -notmatch '^[a-f0-9]{40}$') { throw 'Cannot determine source commit.' }
foreach ($asset in '.local/models/bge-small-zh-v1.5/config.json', '.local/docker-embedding/wheels') {
    if (!(Test-Path -LiteralPath $asset)) { throw "Missing declared offline dependency: $asset" }
}
docker build --build-arg "LIFEOS_BUILD_COMMIT=$sourceCommit" -t $Tag .
if ($LASTEXITCODE -ne 0) { throw 'Image build failed; preserve its first output before repairing.' }
Write-Output "BUILT $Tag source=$sourceCommit; provider, cloud workflow and release acceptance remain separate."
