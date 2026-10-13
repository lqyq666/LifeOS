<#
One-click git sync for LifeOS.

Stages all changes, commits them if there is anything to commit, and pushes the
current branch to origin. It NEVER deploys and NEVER merges into main.

Usage:
  - Double-click sync.cmd, or
  - pwsh -File sync.ps1
  - pwsh -File sync.ps1 -Message "feat: xxx"
#>
param(
  [string]$Message
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if (-not $branch -or $branch -eq 'HEAD') { throw 'Cannot sync from a detached HEAD.' }
Write-Host "branch: $branch"

git add -A
$staged = @(git diff --cached --name-only)
if ($staged.Count -eq 0) {
  Write-Host 'nothing to sync (working tree clean).'
  return
}

# Safety: never commit real secret files (templates like *.example are fine).
$danger = $staged | Where-Object { $_ -match '(^|/)\.env($|\.)' -and $_ -notmatch '\.example$' }
if ($danger) {
  throw ("Refusing to sync secret-like files:`n  " + ($danger -join "`n  ") + "`nUnstage them and retry.")
}

if (-not $Message) { $Message = 'sync: ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') }
git commit -m $Message
git push origin $branch
Write-Host "synced -> origin/$branch"
