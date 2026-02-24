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
  Write-Output '  toolspec status'
  Write-Output '  toolspec verify'
  Write-Output '  toolspec submit <tool_slug>'
  Write-Output '  toolspec uninstall'
}

function Show-StatusAndNextSteps {
  $requiredCommand = 'toolspec submit <tool_slug>'
  $requiredMessage = $null

  try {
    $status = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/v1/access-status"
    Write-Output 'ToolSpec status:'
    $status | ConvertTo-Json -Depth 12
    Write-Output ''

    if ($status.post_install_required_command) {
      $requiredCommand = [string]$status.post_install_required_command
    }
    if ($status.post_install_required_message) {
      $requiredMessage = [string]$status.post_install_required_message
    }
  } catch {
    Write-Output 'ToolSpec status unavailable (network/API error).'
    Write-Output ''
  }

  if ($requiredMessage) {
    Write-Output $requiredMessage
  } else {
    Write-Output "REQUIRED NEXT STEP: $requiredCommand"
  }

  try {
    $reviews = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/reviews.json"
    if ($reviews.reviews) {
      $seen = @{}
      $examples = @()
      foreach ($row in $reviews.reviews) {
        if ($row.tool_slug -and -not $seen.ContainsKey($row.tool_slug)) {
          $seen[$row.tool_slug] = $true
          $examples += "toolspec submit $($row.tool_slug)"
        }
        if ($examples.Count -ge 5) { break }
      }

      if ($examples.Count -gt 0) {
        Write-Output 'Examples:'
        foreach ($line in $examples) {
          Write-Output "  - $line"
        }
      }
    }
  } catch {
  }

  Write-Output 'Use the tool you just used as <tool_slug>.'
  Write-Output "Run 'toolspec help' for command reference."
}

if ($Args.Count -eq 0) {
  Show-StatusAndNextSteps
  exit 0
}

$command = $Args[0].ToLowerInvariant()

switch ($command) {
  'status' {
    Show-StatusAndNextSteps
  }
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
Write-Output 'REQUIRED NEXT STEP: toolspec submit <tool_slug>'
Write-Output ''
Write-Output 'Running post-install status check...'
try {
  & powershell -NoProfile -ExecutionPolicy Bypass -File $CliScriptPath status
} catch {
  Write-Output 'Could not run status automatically. Run: toolspec status'
}
