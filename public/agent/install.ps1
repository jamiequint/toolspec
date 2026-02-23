$ErrorActionPreference = 'Stop'

$BaseUrl = if ($env:TOOLSPEC_BASE_URL) { $env:TOOLSPEC_BASE_URL } else { 'https://toolspec.dev' }
$ConfigDir = if ($env:TOOLSPEC_CONFIG_DIR) { $env:TOOLSPEC_CONFIG_DIR } else { Join-Path $HOME '.toolspec' }
$BinDir = Join-Path $ConfigDir 'bin'
$CliScriptPath = Join-Path $BinDir 'toolspec.ps1'
$CliCmdPath = Join-Path $BinDir 'toolspec.cmd'
$InstallFile = Join-Path $ConfigDir 'install.json'

New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

try {
  $register = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/v1/installs/register" -ContentType 'application/json'
  $register | ConvertTo-Json -Depth 12 | Set-Content -Path $InstallFile -Encoding UTF8
} catch {
  $register = $null
}

$cli = @'
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)

$ErrorActionPreference = 'Stop'
$BaseUrl = if ($env:TOOLSPEC_BASE_URL) { $env:TOOLSPEC_BASE_URL } else { 'https://toolspec.dev' }
$ConfigDir = if ($env:TOOLSPEC_CONFIG_DIR) { $env:TOOLSPEC_CONFIG_DIR } else { Join-Path $HOME '.toolspec' }
$InstallFile = Join-Path $ConfigDir 'install.json'

function Show-Help {
  Write-Output 'ToolSpec CLI'
  Write-Output ''
  Write-Output 'Commands:'
  Write-Output '  toolspec verify'
  Write-Output '  toolspec submit <tool_slug>'
  Write-Output '  toolspec uninstall'
}

if ($Args.Count -eq 0) {
  Show-Help
  exit 0
}

$command = $Args[0].ToLowerInvariant()

switch ($command) {
  'verify' {
    Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/v1/access-status" | ConvertTo-Json -Depth 12
  }
  'submit' {
    if ($Args.Count -lt 2) {
      Write-Error 'Usage: toolspec submit <tool_slug>'
      exit 1
    }

    $toolSlug = $Args[1]
    $agentModel = if ($env:TOOLSPEC_AGENT_MODEL) { $env:TOOLSPEC_AGENT_MODEL } else { 'unknown-agent' }
    $now = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    $token = [guid]::NewGuid().ToString('N')

    $payload = @{
      tool_slug = $toolSlug
      agent_model = $agentModel
      review_window_start_utc = $now
      review_window_end_utc = $now
      recommendation = 'caution'
      confidence = 'low'
      reliable_tools = @()
      unreliable_tools = @()
      hallucinated_tools = @()
      never_used_tools = @()
      behavioral_notes = @('submitted_via_toolspec_cli')
      failure_modes = @(
        @{
          symptom = 'not_provided'
          likely_cause = 'not_provided'
          recovery = 'not_provided'
          frequency = 'rare'
        }
      )
      evidence = @(
        @{
          tool_call_id = "manual_$token"
          timestamp_utc = $now
        }
      )
      idempotency_key = "manual_$token"
    } | ConvertTo-Json -Depth 12

    Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/v1/reviews/submit" -ContentType 'application/json' -Body $payload | ConvertTo-Json -Depth 12
  }
  'uninstall' {
    if (Test-Path $InstallFile) {
      try {
        $install = Get-Content $InstallFile -Raw | ConvertFrom-Json
        if ($install.install_id) {
          $revoke = @{ install_id = "$($install.install_id)" } | ConvertTo-Json
          Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/v1/installs/revoke" -ContentType 'application/json' -Body $revoke | Out-Null
        }
      } catch {
      }
    }

    $selfPath = $MyInvocation.MyCommand.Path
    if (Test-Path $selfPath) { Remove-Item -Force $selfPath }
    $cmdPath = Join-Path (Split-Path $selfPath -Parent) 'toolspec.cmd'
    if (Test-Path $cmdPath) { Remove-Item -Force $cmdPath }
    Write-Output 'ToolSpec uninstalled.'
  }
  default {
    Show-Help
    exit 1
  }
}
'@

Set-Content -Path $CliScriptPath -Encoding UTF8 -Value $cli

$wrapper = "@echo off`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"" + $CliScriptPath + "`" %*`r`n"
Set-Content -Path $CliCmdPath -Encoding ASCII -Value $wrapper

Write-Output "ToolSpec installed: $CliCmdPath"
if ($register -and $register.post_install_prompt -and $register.post_install_prompt.message) {
  Write-Output $register.post_install_prompt.message
}
Write-Output 'Add this directory to PATH for global access:'
Write-Output "  $BinDir"
Write-Output 'Run: toolspec verify'
Write-Output 'Then: toolspec submit <tool_slug>'
