param([string]$Directory='.planning/research/agent-workflows/evidence')
$ErrorActionPreference='Stop'
$directory=$Directory
$files=@('workflow-contracts.test.ts','workflow-action.test.ts','workflow-direction.test.ts','workflow-growth-knowledge.test.ts','workflow-main-entry.test.ts','action-coach-engine.test.ts','action-coach-material-boundary.test.ts','guide-usage-http.test.ts','coze-code-workflow.test.ts')
$results=@()
foreach($file in $files){
 # Withdrawal tests permanently retire fixture sources. Give each suite its own
 # disposable database; never "fix" isolation by reactivating a withdrawn source.
 $log=Join-Path $directory ('verified-'+$file.Replace('.test.ts','.log'))
 & npm run test:backend -- "--file=$file" *> $log
 $testExit=$LASTEXITCODE
 $contents=Get-Content -LiteralPath $log -Raw
 $total=[regex]::Match($contents,'(?:ℹ|#) tests (\d+)')
 $passed=[regex]::Match($contents,'(?:ℹ|#) pass (\d+)')
 $failed=[regex]::Match($contents,'(?:ℹ|#) fail (\d+)')
 $row=@{file=$file;exit=$testExit;total=if($total.Success){[int]$total.Groups[1].Value}else{$null};passed=if($passed.Success){[int]$passed.Groups[1].Value}else{$null};failed=if($failed.Success){[int]$failed.Groups[1].Value}else{$null};evidence=$log;status=if($testExit -eq 0 -and $total.Success -and $failed.Success -and [int]$failed.Groups[1].Value -eq 0){'PASS'}else{'FAIL'}}
 $results+=$row
 Write-Output ($file+' '+$row.status+' '+$row.passed+'/'+$row.total)
}
$report=@{at=[DateTime]::UtcNow.ToString('o');scope='REAL_ISOLATED_PG_PER_SUITE_SIMULATED_PROVIDER';paidCalls=0;primaryDatabaseModified=$false;suites=$results;total=($results | ForEach-Object {$_.total} | Measure-Object -Sum).Sum;passed=($results | ForEach-Object {$_.passed} | Measure-Object -Sum).Sum;failed=($results | ForEach-Object {$_.failed} | Measure-Object -Sum).Sum}
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $directory 'VERIFICATION_REPORT.json') -Encoding utf8
if(@($results | Where-Object {$_.status -ne 'PASS'}).Count -gt 0){exit 1}
