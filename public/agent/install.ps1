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
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ToolArgs)

$ErrorActionPreference = 'Stop'
$BaseUrl = if ($env:TOOLSPEC_BASE_URL) { $env:TOOLSPEC_BASE_URL } else { 'https://toolspec.dev' }
$ConfigDir = if ($env:TOOLSPEC_CONFIG_DIR) { $env:TOOLSPEC_CONFIG_DIR } else { Join-Path $HOME '.toolspec' }
$InstallFile = Join-Path $ConfigDir 'install.json'

$PublicWhitelist = @(
  'anthropic','airtable','asana','aws','azure','bigquery','brave','browserbase','cloudflare','confluence','discord',
  'fetch','figma','filesystem','gcp','github','gitlab','google','hubspot','jira','linear','mongodb','mysql','notion',
  'openai','paypal','postgres','redis','salesforce','serpapi','shopify','slack','snowflake','sqlite','stripe','supabase',
  'tavily','twilio','vercel','zendesk'
)

function Show-Help {
  Write-Output 'ToolSpec CLI'
  Write-Output ''
  Write-Output 'Commands:'
  Write-Output '  toolspec status'
  Write-Output '  toolspec verify'
  Write-Output '  toolspec submit'
  Write-Output '  toolspec submit all'
  Write-Output '  toolspec submit all --yolo'
  Write-Output '  toolspec uninstall'
}

function Get-InstallId {
  if (-not (Test-Path $InstallFile)) {
    return $null
  }

  try {
    $install = Get-Content $InstallFile -Raw | ConvertFrom-Json
    if ($install.install_id) {
      return [string]$install.install_id
    }
  } catch {
  }

  return $null
}

function Get-AccessStatusUri {
  $installId = Get-InstallId
  if ($installId) {
    return "$BaseUrl/api/v1/access-status?install_id=$([uri]::EscapeDataString($installId))"
  }
  return "$BaseUrl/api/v1/access-status"
}

function Parse-CsvList([string]$raw) {
  if (-not $raw) { return @() }

  $seen = @{}
  $items = @()
  foreach ($part in ($raw -split ',')) {
    $value = $part.Trim()
    if ($value -and -not $seen.ContainsKey($value)) {
      $seen[$value] = $true
      $items += $value
    }
  }

  return $items
}

function Get-SlugCandidates([string]$slug) {
  if (-not $slug) { return @() }

  $raw = $slug.Trim().ToLowerInvariant()
  if (-not $raw) { return @() }

  $seen = @{}
  $out = @()

  $out += $raw
  $seen[$raw] = $true

  foreach ($token in ($raw -split '[/:_\-.@]+')) {
    if (-not $token) { continue }
    if (-not $seen.ContainsKey($token)) {
      $seen[$token] = $true
      $out += $token
    }
  }

  if ($raw -match '^mcp__([^_]+)__') {
    $m = $Matches[1]
    if ($m -and -not $seen.ContainsKey($m)) {
      $seen[$m] = $true
      $out += $m
    }
  }

  $idx = $raw.IndexOf('server-')
  if ($idx -ge 0) {
    $tail = $raw.Substring($idx + 7)
    if ($tail -and -not $seen.ContainsKey($tail)) {
      $seen[$tail] = $true
      $out += $tail
    }
  }

  return $out
}

function Test-WhitelistedTool([string]$slug) {
  $whitelistSet = @{}
  foreach ($item in $PublicWhitelist) { $whitelistSet[$item] = $true }

  foreach ($candidate in (Get-SlugCandidates $slug)) {
    if ($whitelistSet.ContainsKey($candidate)) {
      return $true
    }
  }

  return $false
}

function Split-ObservedTools([string[]]$observed) {
  $public = @()
  $unknown = @()

  foreach ($slug in $observed) {
    if (Test-WhitelistedTool $slug) {
      $public += $slug
    } else {
      $unknown += $slug
    }
  }

  return @{ public = $public; unknown = $unknown }
}

function Merge-Unique([string[]]$a, [string[]]$b) {
  $seen = @{}
  $out = @()
  foreach ($item in ($a + $b)) {
    if (-not $item) { continue }
    if ($seen.ContainsKey($item)) { continue }
    $seen[$item] = $true
    $out += $item
  }
  return $out
}

function Test-InteractivePrompt {
  try {
    return (-not [Console]::IsInputRedirected) -and (-not [Console]::IsOutputRedirected)
  } catch {
    return $false
  }
}

function Show-StatusAndNextSteps {
  $requiredCommand = 'toolspec submit'
  $requiredMessage = $null

  try {
    $status = Invoke-RestMethod -Method Get -Uri (Get-AccessStatusUri)
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

  $observed = Parse-CsvList $env:TOOLSPEC_OBSERVED_TOOLS
  if ($observed.Count -gt 0) {
    $split = Split-ObservedTools -observed $observed
    Write-Output ("Observed tools: {0} ({1} public, {2} non-whitelist)" -f $observed.Count, $split.public.Count, $split.unknown.Count)
    Write-Output 'Default mode: toolspec submit'
    Write-Output 'All mode: toolspec submit all'
    Write-Output 'All mode, no prompts: toolspec submit all --yolo'
  }

  Write-Output "Run 'toolspec help' for command reference."
}

function Build-Evidence([string]$token, [string]$now, [string[]]$submittedTools) {
  if ($submittedTools.Count -eq 0) {
    return @(@{ tool_call_id = "session_$token"; timestamp_utc = $now })
  }

  $evidence = @()
  $max = [Math]::Min($submittedTools.Count, 50)
  for ($i = 0; $i -lt $max; $i++) {
    $slug = $submittedTools[$i]
    $evidence += @{ tool_call_id = "session_${token}_$($i + 1)_$slug"; timestamp_utc = $now }
  }

  return $evidence
}

function Submit-Review([string[]]$argsForSubmit) {
  $allMode = $false
  $yoloMode = $false

  foreach ($arg in $argsForSubmit) {
    if ($arg -eq 'all') {
      $allMode = $true
      continue
    }
    if ($arg -eq '--yolo') {
      $yoloMode = $true
      continue
    }

    throw "Unknown option for submit: $arg`nUsage: toolspec submit [all] [--yolo]"
  }

  if ($yoloMode -and -not $allMode) {
    throw '--yolo requires all'
  }

  $modeLabel = if ($allMode) { 'all' } else { 'whitelist' }

  $observed = Parse-CsvList $env:TOOLSPEC_OBSERVED_TOOLS
  $split = Split-ObservedTools -observed $observed
  $public = $split.public
  $unknown = $split.unknown

  $included = @($public)
  $redacted = @($unknown)

  if ($allMode) {
    if ($yoloMode) {
      $included = Merge-Unique $public $unknown
      $redacted = @()
    } elseif ($unknown.Count -gt 0) {
      if (Test-InteractivePrompt) {
        $includeUnknown = @()
        $redactUnknown = @()

        foreach ($slug in $unknown) {
          $answer = Read-Host "Include non-whitelist tool '$slug'? [y/N]"
          if ($answer -and $answer.ToLowerInvariant() -in @('y', 'yes')) {
            $includeUnknown += $slug
          } else {
            $redactUnknown += $slug
          }
        }

        $included = Merge-Unique $public $includeUnknown
        $redacted = $redactUnknown
      } else {
        throw "Unknown non-whitelist tools require explicit choice. Use 'toolspec submit all --yolo' to include all unknown tools, or run 'toolspec submit' for whitelist-only."
      }
    }
  }

  $agentModel = if ($env:TOOLSPEC_AGENT_MODEL) { $env:TOOLSPEC_AGENT_MODEL } else { 'unknown-agent' }
  $now = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  $token = [guid]::NewGuid().ToString('N')
  $installId = Get-InstallId

  $payload = @{
    install_id = $installId
    submission_scope = 'all_observed'
    tool_slug = '__session__'
    agent_model = $agentModel
    review_window_start_utc = $now
    review_window_end_utc = $now
    recommendation = 'caution'
    confidence = 'low'
    observed_tool_slugs = $observed
    redacted_tool_slugs = $redacted
    reliable_tools = $included
    unreliable_tools = @()
    hallucinated_tools = @()
    never_used_tools = $redacted
    behavioral_notes = @(
      'submitted_via_toolspec_cli',
      'submission_scope=all_observed',
      "submit_mode=$modeLabel",
      "submit_yolo=$yoloMode",
      "whitelist_tools=$($public.Count)",
      "unknown_tools=$($unknown.Count)",
      "observed_tools=$($observed.Count)",
      "redacted_tools=$($redacted.Count)"
    )
    failure_modes = @(
      @{
        symptom = 'not_provided'
        likely_cause = 'not_provided'
        recovery = 'not_provided'
        frequency = 'rare'
      }
    )
    evidence = Build-Evidence -token $token -now $now -submittedTools $included
    idempotency_key = "session_$token"
  } | ConvertTo-Json -Depth 12

  Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/v1/reviews/submit" -ContentType 'application/json' -Body $payload | ConvertTo-Json -Depth 12

  $modeDisplay = if ($allMode -and $yoloMode) { 'all (yolo)' } else { $modeLabel }
  Write-Output ("Submitted tools: {0} | Redacted tools: {1} | Mode: {2}" -f $included.Count, $redacted.Count, $modeDisplay)

  if ($redacted.Count -gt 0) {
    Write-Output ("Redacted tool slugs: " + ($redacted -join ', '))
  }
}

if ($ToolArgs.Count -eq 0) {
  Show-StatusAndNextSteps
  exit 0
}

$command = $ToolArgs[0].ToLowerInvariant()

switch ($command) {
  'status' {
    Show-StatusAndNextSteps
  }
  'verify' {
    Invoke-RestMethod -Method Get -Uri (Get-AccessStatusUri) | ConvertTo-Json -Depth 12
  }
  'submit' {
    $submitArgs = @()
    if ($ToolArgs.Count -gt 1) {
      $submitArgs = $ToolArgs[1..($ToolArgs.Count - 1)]
    }
    Submit-Review -argsForSubmit $submitArgs
  }
  'uninstall' {
    $installId = Get-InstallId
    if ($installId) {
      try {
        $revoke = @{ install_id = $installId } | ConvertTo-Json
        Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/v1/installs/revoke" -ContentType 'application/json' -Body $revoke | Out-Null
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
Write-Output 'REQUIRED NEXT STEP: toolspec submit'
Write-Output ''
Write-Output 'Running post-install status check...'
try {
  & powershell -NoProfile -ExecutionPolicy Bypass -File $CliScriptPath status
} catch {
  Write-Output 'Could not run status automatically. Run: toolspec status'
}
