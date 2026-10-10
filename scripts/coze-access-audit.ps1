param([string]$ReportPath = '.planning/research/coze-codex/COZE_ACCESS_AUDIT.json')
$ErrorActionPreference = 'Stop'
# Raw CLI responses stay in memory; persist only the explicit fields below.
function Read-CozeJson([string[]]$CommandArgs) {
    $raw = (& coze @CommandArgs --format json 2>$null | Out-String)
    $commandExit = $LASTEXITCODE
    try { $data = ConvertFrom-Json -InputObject $raw }
    catch { return @{ command=('coze ' + ($CommandArgs -join ' ') + ' --format json'); exit=$commandExit; error='NON_JSON_OUTPUT_WITHHELD'; data=$null } }
    return @{ command=('coze ' + ($CommandArgs -join ' ') + ' --format json'); exit=$commandExit; error=if($commandExit -eq 0){$null}else{'CLI_FAILED_DETAILS_WITHHELD'}; data=$data }
}
function Select-Safe($Object, [string[]]$Names) {
    $safe = [ordered]@{}
    foreach ($name in $Names) {
        if ($null -ne $Object.$name -and ($Object.$name -is [string] -or $Object.$name -is [bool] -or $Object.$name -is [ValueType])) { $safe[$name] = $Object.$name }
    }
    return $safe
}
$report = [ordered]@{ checkedAtUtc=[DateTime]::UtcNow.ToString('o'); scope='READ_ONLY_CLOUD_AND_LOCAL_PRESENCE'; cliVersion=(& coze --version | Out-String).Trim(); head=(& git rev-parse HEAD | Out-String).Trim(); branch=(& git branch --show-current | Out-String).Trim(); commands=@(); projects=@() }
$auth = Read-CozeJson @('auth','status')
$report.commands += @{command=$auth.command;exit=$auth.exit;error=$auth.error}
$report.auth = @{ logged_in=($auth.data.logged_in -eq $true); error=$auth.error; validity='Only successful cloud reads below establish current management access; runtime token not exercised.' }
$skills = Read-CozeJson @('self','skill','status')
$report.commands += @{command=$skills.command;exit=$skills.exit;error=$skills.error}
$report.skillStatus = Select-Safe $skills.data @('cliVersion','installedVersion','versionMatch')
$skillRoot = Join-Path $env:USERPROFILE '.agents/skills'
$skillFiles = @('coze-agent-collaboration/SKILL.md','using-coze-cli/SKILL.md','using-coze-cli/coze-claw/MODULE.md','using-coze-cli/coze-code/MODULE.md','using-coze-cli/coze-file/MODULE.md','using-coze-cli/coze-generate/MODULE.md')
$report.skillFiles = @($skillFiles | ForEach-Object { $file=Join-Path $skillRoot $_; @{path=$file;exists=(Test-Path -LiteralPath $file);sha256=if(Test-Path -LiteralPath $file){(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLower()}else{$null}} })
foreach ($projectId in @('7693388932939300905','7693465311558795327')) {
    $project = Read-CozeJson @('code','project','get',$projectId)
    $deploy = Read-CozeJson @('code','deploy','status',$projectId)
    $report.commands += @{command=$project.command;exit=$project.exit;error=$project.error},@{command=$deploy.command;exit=$deploy.exit;error=$deploy.error}
    $entry = @{project=(Select-Safe $project.data @('project_id','name','type','space_id','status'));deploy=(Select-Safe $deploy.data @('projectId','status','commitHash','deployHistoryId'));environments=@()}
    foreach ($environment in @('dev','prod')) {
        $variables = Read-CozeJson @('code','env','list','-p',$projectId,'--env',$environment)
        $report.commands += @{command=$variables.command;exit=$variables.exit;error=$variables.error}
        $rows = @()
        if ($variables.exit -eq 0) {
            if ($null -eq $variables.data) { $rows=@() }
            elseif ($variables.data -is [array]) { $rows=@($variables.data) }
            elseif ($null -ne $variables.data.items) { $rows=@($variables.data.items) }
            else { $rows=@($variables.data); $entry['envShapeUnknown']=$true }
        }
        $entry.environments += @{environment=$environment;exit=$variables.exit;variables=@($rows | ForEach-Object { $variableName=if($_.name){$_.name}elseif($_.key){$_.key}else{'UNKNOWN_NAME'}; @{name=$variableName;configured=$true} })}
    }
    $report.projects += $entry
}
$cozeNames=@('LIFEOS_COZE_KNOWLEDGE','LIFEOS_COZE_TRANSPORT','LIFEOS_COZE_CODE_ENDPOINT','LIFEOS_COZE_CODE_TOKEN','LIFEOS_COZE_CODE_PROJECT_ID','LIFEOS_COZE_CODE_RELEASE','LIFEOS_COZE_PAT','LIFEOS_COZE_WORKFLOW_ID','LIFEOS_COZE_WORKFLOW_VERSION')
$envText=if(Test-Path -LiteralPath '.env.server'){Get-Content -LiteralPath '.env.server' -Raw}else{''}
$report.localEnvironment=@($cozeNames | ForEach-Object {
    $name=$_; $match=[regex]::Match($envText,'(?m)^\s*(?:export\s+)?'+[regex]::Escape($name)+'\s*=\s*(.*)$')
    $processValue=[Environment]::GetEnvironmentVariable($name)
    @{name=$name;fileEntryPresent=$match.Success;fileNonempty=($match.Success -and $match.Groups[1].Value.Trim().Trim('"',"'").Length -gt 0);callerProcessNonempty=(![string]::IsNullOrWhiteSpace($processValue))}
})
$report.runtimeCredentials=@(@('.local/coze-competition/runtime-token.txt','.local/coze-automation/runtime-token.txt') | ForEach-Object { @{path=$_;exists=(Test-Path -LiteralPath $_);nonempty=if(Test-Path -LiteralPath $_){(Get-Item -LiteralPath $_).Length -gt 0}else{$false};used=$false} })
$report.runningProcessEnvironment='Other processes environment not read; caller environment is not evidence of a running service configuration.'
$report.localFingerprints=@()
foreach($port in @(5173,8787)) {
    try {
        $fingerprint=Invoke-RestMethod -Uri ('http://127.0.0.1:'+ $port + '/api/run/version') -TimeoutSec 3
        $report.localFingerprints+=@{port=$port;reachable=$true;fingerprint=(Select-Safe $fingerprint @('service','head','skillVersion','contractGeneration','freezeDigest'))}
    }catch{$report.localFingerprints+=@{port=$port;reachable=$false;error='UNREACHABLE_OR_INVALID_JSON_RESPONSE'}}
}
$report.sideEffects=@{cloudDeployment=$false;cloudResourceWrite=$false;runtimeInvocation=$false;privateUpload=$false;paidDevelopmentMessage=$false}
$directory=Split-Path -Parent $ReportPath
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$report | ConvertTo-Json -Depth 14 | Set-Content -LiteralPath $ReportPath -Encoding utf8
$report | ConvertTo-Json -Depth 14
