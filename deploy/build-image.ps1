$ErrorActionPreference = 'Stop'
$Image = 'lifeos:v1.3-fast-launch-candidate'
function Get-RelativeAssetPath {
    param([string]$Root, [string]$Path)
    if ([IO.Path].GetMethod('GetRelativePath', [type[]]@([string], [string]))) {
        return [IO.Path]::GetRelativePath($Root, $Path)
    }
    # Windows PowerShell 5.1 has no Path.GetRelativePath. Resolve through URI
    # so the same containment check remains usable on the project's Windows host.
    $base = [Uri](([IO.Path]::GetFullPath($Root).TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar))
    $target = [Uri]([IO.Path]::GetFullPath($Path))
    $relative = [Uri]::UnescapeDataString($base.MakeRelativeUri($target).ToString()).Replace('/', '\')
    if (!$relative) { return '.' }
    return $relative
}
function Assert-NoReparsePath {
    param([string]$Root, [string]$Path, [switch]$AllowMissing)
    $checkedRoot = [IO.Path]::GetFullPath($Root)
    $checkedPath = [IO.Path]::GetFullPath($Path)
    $relative = Get-RelativeAssetPath $checkedRoot $checkedPath
    if ([IO.Path]::IsPathRooted($relative) -or $relative -eq '..' -or $relative -match '^\.\.[\\/]') { throw 'Asset path escapes the intended workspace.' }
    $ancestor = $checkedRoot
    while ($ancestor) {
        $entry = Get-Item -LiteralPath $ancestor -Force -ErrorAction Stop
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Workspace ancestor reparse point refused.' }
        $parent = Split-Path $ancestor -Parent
        if ($parent -eq $ancestor) { break }
        $ancestor = $parent
    }
    $cursor = $checkedRoot
    foreach ($segment in ($relative -split '[\\/]')) {
        if ($segment -eq '.') { continue }
        $cursor = Join-Path $cursor $segment
        try { $entry = Get-Item -LiteralPath $cursor -Force -ErrorAction Stop }
        catch [System.Management.Automation.ItemNotFoundException] {
            if ($AllowMissing) { return }
            throw 'Missing declared public asset path.'
        }
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Public asset or context ancestor reparse point refused.' }
    }
}
function Assert-PublicAssetTree {
    param([string]$Root, [string]$Path)
    Assert-NoReparsePath -Root $Root -Path $Path
    $pending = [Collections.Generic.Stack[string]]::new()
    $pending.Push([IO.Path]::GetFullPath($Path))
    while ($pending.Count) {
        $entry = Get-Item -LiteralPath $pending.Pop() -Force
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Nested public asset reparse point refused.' }
        if ($entry.PSIsContainer) {
            foreach ($child in (Get-ChildItem -LiteralPath $entry.FullName -Force)) { $pending.Push($child.FullName) }
        }
    }
}
Set-Location (Split-Path $PSScriptRoot -Parent)
if (git status --porcelain) { throw 'Commit or preserve all changes before building an exact-version image.' }
$sourceCommit = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceCommit -notmatch '^[a-f0-9]{40}$') { throw 'Cannot determine source commit.' }
foreach ($asset in '.local/models/bge-small-zh-v1.5/config.json', '.local/docker-embedding/wheels') {
    if (!(Test-Path -LiteralPath $asset)) { throw "Missing declared offline dependency: $asset" }
}
$taskWorkspaceRoot = (Get-Location).Path
foreach ($asset in '.local/models/bge-small-zh-v1.5', '.local/docker-embedding/wheels') {
    Assert-PublicAssetTree -Root $taskWorkspaceRoot -Path (Join-Path $taskWorkspaceRoot $asset)
}
# Docker must read committed blob bytes. A clean Windows checkout can still
# contain CRLF bytes while another checkout contains LF at the same commit.
# Keep the failed contexts; copy only the two declared public asset directories.
$contextRoot = Join-Path (Get-Location) '.local/image-build-contexts'
Assert-NoReparsePath -Root $taskWorkspaceRoot -Path $contextRoot -AllowMissing
New-Item -ItemType Directory -Path $contextRoot -Force | Out-Null
$contextPath = Join-Path $contextRoot ([Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $contextPath | Out-Null
$archivePath = Join-Path $contextRoot ([Guid]::NewGuid().ToString('N') + '.tar')
git -c core.autocrlf=false -c core.eol=lf archive --format=tar --output=$archivePath $sourceCommit
if ($LASTEXITCODE -ne 0) { throw 'Cannot export committed source.' }
tar -xf $archivePath -C $contextPath
if ($LASTEXITCODE -ne 0) { throw 'Cannot extract committed source.' }
foreach ($privatePath in '.env.server', '.env.production', '.local', '.local/v1.3-action-coach/paid/provider-calls.json') {
    Assert-NoReparsePath -Root $contextPath -Path (Join-Path $contextPath $privatePath) -AllowMissing
    if (Get-Item -LiteralPath (Join-Path $contextPath $privatePath) -Force -ErrorAction SilentlyContinue) { throw 'Private runtime data is unexpectedly tracked; build refused.' }
}
foreach ($asset in '.local/models/bge-small-zh-v1.5', '.local/docker-embedding/wheels') {
    $sourcePath = Join-Path (Get-Location) $asset
    Assert-PublicAssetTree -Root $taskWorkspaceRoot -Path $sourcePath
    $targetParent = Split-Path (Join-Path $contextPath $asset) -Parent
    New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
    Copy-Item -LiteralPath $sourcePath -Destination $targetParent -Recurse
}
docker build --build-arg "LIFEOS_BUILD_COMMIT=$sourceCommit" -t $Image $contextPath
if ($LASTEXITCODE -ne 0) { throw 'Image build failed; preserve its first output before repairing.' }
Write-Output "BUILT $Image source=$sourceCommit; provider, cloud workflow and release acceptance remain separate."
