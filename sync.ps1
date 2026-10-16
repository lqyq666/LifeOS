<# Only sync an explicitly selected safe publication copy; never stage source. #>
param([string]$PublishRepo, [string]$Commit, [string]$ReviewedAssets, [switch]$Push)
$ErrorActionPreference = 'Stop'
if (-not $PublishRepo -or -not $Commit) {
  throw 'Specify -PublishRepo <existing safe publication copy> -Commit <exact commit>. Original history stays local. Add -Push only to publish the verified commit.'
}
$arguments = @((Join-Path $PSScriptRoot 'scripts/safe-sync.mjs'), '--repo', $PublishRepo, '--commit', $Commit)
if ($Push) { $arguments += '--push' }
if ($ReviewedAssets) { $arguments += @('--reviewed-assets', $ReviewedAssets) }
& node @arguments
if ($LASTEXITCODE -ne 0) { throw "Safe sync failed (exit $LASTEXITCODE). No automatic retry." }
