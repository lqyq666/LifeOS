param([string]$ReportPath='.planning/research/agent-workflows/evidence/coze-tasks-skills.json')
$ErrorActionPreference='Stop'
$rows=@()
foreach($projectId in @('7693388932939300905','7693465311558795327')){
 foreach($command in @('message','skill')){
  $cliArgs=if($command -eq 'message'){@('code','message','status','-p',$projectId,'--format','json')}else{@('code','skill','list','-p',$projectId,'--format','json')}
  $raw=(& coze @cliArgs 2>$null | Out-String);$code=$LASTEXITCODE
  try{$data=ConvertFrom-Json $raw}catch{$data=$null}
  $safe=[ordered]@{projectId=$projectId;command=($cliArgs -join ' ');exit=$code;status='READ_NOT_VERIFIED'}
  if($code -eq 0 -and $null -ne $data){
   $safe.status='READ_SUCCEEDED'
   if($command -eq 'message'){
    $safe.task=@{}
    foreach($name in @('status','task_status','message_id','messageId')){if($data.$name -is [string] -or $data.$name -is [ValueType]){$safe.task[$name]=$data.$name}}
   }else{
    $list=if($data -is [array]){@($data)}elseif($data.items){@($data.items)}elseif($data.skills){@($data.skills)}else{@()}
    $safe.skills=@($list | ForEach-Object { @{id=$_.id;name=$_.name;is_installed=$_.is_installed} })
    $safe.shapeRecognized=($data -is [array] -or $null -ne $data.items -or $null -ne $data.skills)
   }
  }
  $rows+=$safe
 }
}
@{at=[DateTime]::UtcNow.ToString('o');scope='READ_ONLY_NO_PAID_MESSAGES';commands=$rows;remoteCandidateWritten=$false;productionReleaseChanged=$false} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReportPath -Encoding utf8
Write-Output 'Saved safe task/Skill metadata; no raw answers, credentials, writes or model invocations.'
